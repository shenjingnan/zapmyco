// Glob 工具 — 基于 ignore + globset 在本地文件系统中按文件名模式查找文件
//
// 本文件是 Anthropic Tool 的集成层，负责：
// - 定义 Tool JSON Schema（tool_definition）
// - 从 LLM 参数提取搜索配置（execute）
// - 使用 ignore::WalkBuilder + globset::GlobMatcher 遍历和过滤文件
// - 按修改时间排序输出
//
// 底层使用与 ripgrep 相同的 ignore 和 globset crate，行为一致。

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Glob 配置选项
#[derive(Debug, Clone)]
pub struct GlobOptions {
    /// 搜索超时时间（秒），默认 20
    pub timeout_secs: u64,
    /// 输出最大字符数，默认 100_000
    pub output_max_chars: usize,
    /// 默认最大结果数，默认 100
    pub default_head_limit: u32,
}

impl Default for GlobOptions {
    fn default() -> Self {
        Self {
            timeout_secs: 20,
            output_max_chars: 100_000,
            default_head_limit: 100,
        }
    }
}

// ---------------------------------------------------------------------------
// Core struct
// ---------------------------------------------------------------------------

/// Glob 工具 — 在本地文件系统中按文件名模式匹配查找文件
#[derive(Debug, Clone)]
pub struct Glob {
    options: GlobOptions,
}

impl Glob {
    /// 创建新的 Glob 实例
    pub fn new(options: GlobOptions) -> Self {
        Self { options }
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "glob".to_string(),
            description: Some(
                "在本地文件系统中按文件名模式匹配快速查找文件。\
                 支持 glob 通配符模式（如 **/*.rs、src/**/*.ts）。\
                 适用于查找特定类型的文件、按名称搜索文件等场景。\
                 与 grep 不同，glob 只匹配文件名而非文件内容。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "glob 通配符模式，例如 \"**/*.rs\" 查找所有 Rust 文件"
                    },
                    "path": {
                        "type": "string",
                        "description": "搜索路径（目录），默认为当前工作目录"
                    },
                    "head_limit": {
                        "type": "integer",
                        "description": "最大结果数量，默认 100"
                    },
                    "offset": {
                        "type": "integer",
                        "description": "跳过前 N 条结果，用于分页"
                    }
                },
                "required": ["pattern"]
            })),
            ..Default::default()
        }
    }

    /// 执行 Glob 文件查找
    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        // 1. 提取参数
        let pattern = input
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'pattern'".to_string())?;

        let path = input.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let head_limit = input
            .get("head_limit")
            .and_then(|v| v.as_u64())
            .unwrap_or(self.options.default_head_limit as u64);
        let offset = input.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);

        // 2. 在 spawn_blocking 中执行文件遍历（避免阻塞异步运行时）
        let path_owned = path.to_string();
        let pattern_owned = pattern.to_string();
        let timeout = std::time::Duration::from_secs(self.options.timeout_secs);

        let handle = tokio::task::spawn_blocking(move || {
            // 编译 glob 模式（literal_separator=true 使 * 不匹配 /，与 ripgrep 行为一致）
            let compiled = globset::GlobBuilder::new(&pattern_owned)
                .literal_separator(true)
                .build()
                .map_err(|e| format!("无效的 glob 模式 '{}': {}", pattern_owned, e))?;
            let matcher = compiled.compile_matcher();

            let mut results: Vec<(String, Option<std::time::SystemTime>)> = Vec::new();

            // 使用 WalkBuilder 遍历目录
            let mut walker_builder = ignore::WalkBuilder::new(&path_owned);
            walker_builder.standard_filters(true).hidden(false); // 包含隐藏文件（同 rg --hidden）

            // 用 filter_entry 过滤文件（放行目录以遍历子目录，只对文件做 glob 匹配）
            let search_root = std::path::Path::new(&path_owned).to_path_buf();
            walker_builder.filter_entry(move |entry| {
                // 总是放行目录，以便进入子目录
                if entry.file_type().is_some_and(|t| t.is_dir()) {
                    return true;
                }
                // 将路径转为相对于搜索根的路径进行匹配
                let rel_path = entry
                    .path()
                    .strip_prefix(&search_root)
                    .unwrap_or(entry.path());
                matcher.is_match(rel_path)
            });

            for result in walker_builder.build() {
                let entry = match result {
                    Ok(e) => e,
                    Err(_) => continue, // 跳过无法访问的条目
                };

                if !entry.file_type().is_some_and(|t| t.is_file()) {
                    continue;
                }

                let mtime = entry.metadata().ok().and_then(|m| m.modified().ok());
                results.push((entry.path().to_string_lossy().to_string(), mtime));
            }

            // 按 mtime 降序排列（最新修改的在前）
            // None（无法获取 mtime）排在最后
            results.sort_by(|a, b| match (&a.1, &b.1) {
                (Some(a_time), Some(b_time)) => b_time.cmp(a_time),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            });

            Ok::<_, String>(results)
        });

        let results = tokio::time::timeout(timeout, handle)
            .await
            .map_err(|_| format!("Glob 搜索超时 (超过 {}s)", self.options.timeout_secs))?
            .map_err(|e| format!("Glob 搜索被中断: {}", e))?;

        let results = results?;

        // 3. 应用 offset 和 head_limit
        let total = results.len();
        let start = (offset as usize).min(total);
        let take = (head_limit as usize).min(total.saturating_sub(start));
        let truncated = start + take < total;

        // 4. 格式化输出
        let mut out = String::new();
        out.push_str(&format!("匹配模式 \"{}\" 于 {} 个文件", pattern, total));
        if truncated {
            out.push_str(&format!(" (显示 {} 个)", take));
        }
        out.push('\n');
        out.push('\n');

        // 去重显示
        let mut seen = std::collections::HashSet::new();
        for (path_str, _) in results.iter().skip(start).take(take) {
            if seen.insert(path_str.clone()) {
                out.push_str(path_str);
                out.push('\n');
            }
        }

        if truncated {
            out.push_str(&format!(
                "\n---\n[显示 {} / {} 个文件，使用 offset={} 查看后续]\n",
                take,
                total,
                start + take
            ));
        }

        // 5. 检查输出上限
        if out.len() > self.options.output_max_chars {
            return Err(format!(
                "Glob 输出过大 ({} 字符，上限 {})",
                out.len(),
                self.options.output_max_chars
            ));
        }

        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helpers ----

    fn test_glob() -> Glob {
        Glob::new(GlobOptions {
            timeout_secs: 10,
            output_max_chars: 100_000,
            default_head_limit: 100,
        })
    }

    fn setup_temp_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();

        // test.rs
        std::fs::write(dir.path().join("test.rs"), "fn hello() {}\n").unwrap();

        // test.py
        std::fs::write(dir.path().join("test.py"), "def hello(): pass\n").unwrap();

        // main.rs
        std::fs::write(dir.path().join("main.rs"), "fn main() {}\n").unwrap();

        // style.css
        std::fs::write(dir.path().join("style.css"), "body {}\n").unwrap();

        // README.md
        std::fs::write(dir.path().join("README.md"), "# Test\n").unwrap();

        // subdir/mod.rs
        std::fs::create_dir(dir.path().join("subdir")).unwrap();
        std::fs::write(
            dir.path().join("subdir").join("mod.rs"),
            "pub fn foo() {}\n",
        )
        .unwrap();

        // subdir/helper.py
        std::fs::write(
            dir.path().join("subdir").join("helper.py"),
            "def helper(): pass\n",
        )
        .unwrap();

        // .hidden_file (隐藏文件)
        std::fs::write(dir.path().join(".hidden_file"), "hidden content\n").unwrap();

        dir
    }

    // ---- Tool definition tests ----

    #[test]
    fn test_tool_definition_name() {
        let tool = Glob::tool_definition();
        assert_eq!(tool.name, "glob");
    }

    #[test]
    fn test_tool_definition_has_description() {
        let tool = Glob::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_valid_schema() {
        let tool = Glob::tool_definition();
        let schema = tool.input_schema.unwrap();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["pattern"].is_object());
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&serde_json::Value::String("pattern".to_string())));
    }

    #[test]
    fn test_tool_definition_all_parameters() {
        let tool = Glob::tool_definition();
        let schema = tool.input_schema.unwrap();
        let props = schema["properties"].as_object().unwrap();

        let expected_params = ["pattern", "path", "head_limit", "offset"];
        for param in &expected_params {
            assert!(props.contains_key(*param), "Missing parameter: {}", param);
        }
    }

    // ---- Execute tests ----

    #[tokio::test]
    async fn test_execute_basic_glob() {
        let dir = setup_temp_dir();
        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": "*.rs",
            "path": dir.path().to_string_lossy().to_string(),
        });
        let result = glob.execute(&input).await.unwrap();
        assert!(
            result.contains("test.rs"),
            "Result should contain test.rs: {}",
            result
        );
        assert!(
            result.contains("main.rs"),
            "Result should contain main.rs: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_execute_with_path() {
        let dir = setup_temp_dir();
        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": "*.py",
            "path": dir.path().to_string_lossy().to_string(),
        });
        let result = glob.execute(&input).await.unwrap();
        assert!(
            result.contains("test.py"),
            "Result should contain test.py: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_execute_nested_glob() {
        let dir = setup_temp_dir();
        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": "**/*.rs",
            "path": dir.path().to_string_lossy().to_string(),
        });
        let result = glob.execute(&input).await.unwrap();
        assert!(result.contains("test.rs"));
        assert!(result.contains("main.rs"));
        assert!(
            result.contains("mod.rs"),
            "Should find mod.rs in subdir: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_execute_no_matches() {
        let dir = setup_temp_dir();
        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": "*.java",
            "path": dir.path().to_string_lossy().to_string(),
        });
        let result = glob.execute(&input).await.unwrap();
        assert!(
            result.contains("0 个文件"),
            "Should report 0 files: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_execute_with_head_limit() {
        let dir = setup_temp_dir();
        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": "*",
            "path": dir.path().to_string_lossy().to_string(),
            "head_limit": 2,
        });
        let result = glob.execute(&input).await.unwrap();
        // 找到至少 2 个文件，但只显示 2 个
        assert!(result.contains("显示 2 个") || result.contains("2 个文件"));
    }

    #[tokio::test]
    async fn test_execute_with_offset() {
        let dir = setup_temp_dir();
        let glob = test_glob();

        // 获取全部结果
        let input_all = serde_json::json!({
            "pattern": "*",
            "path": dir.path().to_string_lossy().to_string(),
            "head_limit": 100,
        });
        let result_all = glob.execute(&input_all).await.unwrap();

        // 获取 offset=1 的结果
        let input_offset = serde_json::json!({
            "pattern": "*",
            "path": dir.path().to_string_lossy().to_string(),
            "head_limit": 100,
            "offset": 1,
        });
        let result_offset = glob.execute(&input_offset).await.unwrap();

        // 如果总结果 > 1，两个输出应该不同
        if result_all.lines().count() > 2 {
            assert_ne!(result_all, result_offset, "Offset should change results");
        }
    }

    #[tokio::test]
    async fn test_execute_invalid_pattern() {
        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": "[invalid", // 未闭合的字符类
        });
        let result = glob.execute(&input).await;
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.contains("无效的 glob 模式"), "Error: {}", err);
    }

    #[tokio::test]
    async fn test_execute_invalid_path() {
        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": "*.rs",
            "path": "/nonexistent/path/xyz123",
        });
        let result = glob.execute(&input).await;
        // WalkBuilder 对不存在的路径会静默返回空结果
        assert!(result.is_ok());
        let out = result.unwrap();
        assert!(out.contains("0 个文件"), "Should find 0 files: {}", out);
    }

    #[tokio::test]
    async fn test_execute_brace_pattern() {
        let dir = setup_temp_dir();
        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": "*.{rs,py}",
            "path": dir.path().to_string_lossy().to_string(),
        });
        let result = glob.execute(&input).await.unwrap();
        assert!(result.contains("test.rs"));
        assert!(result.contains("test.py"));
    }

    #[tokio::test]
    async fn test_execute_empty_pattern() {
        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": "",
        });
        let result = glob.execute(&input).await;
        // 空 pattern 匹配所有文件
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_execute_missing_pattern() {
        let glob = test_glob();
        let input = serde_json::json!({
            "path": ".",
        });
        let result = glob.execute(&input).await;
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(
            err.contains("pattern"),
            "Error should mention 'pattern': {}",
            err
        );
    }

    #[tokio::test]
    async fn test_execute_path_is_file() {
        let dir = setup_temp_dir();
        let file_path = dir.path().join("test.rs");
        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": "*",
            "path": file_path.to_string_lossy().to_string(),
        });
        // 当 path 指向文件时，WalkBuilder 应该能找到文件自身
        let result = glob.execute(&input).await.unwrap();
        assert!(
            result.contains("1 个文件"),
            "Should find 1 file: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_execute_hidden_file() {
        // 隐藏文件需要用单独的 tempdir 测试，规避 gitignore 影响
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".hidden_file"), "hidden content\n").unwrap();

        let glob = test_glob();
        let input = serde_json::json!({
            "pattern": ".hidden*",
            "path": dir.path().to_string_lossy().to_string(),
        });
        let result = glob.execute(&input).await.unwrap();
        assert!(
            result.contains("1 个文件"),
            "Should find 1 file: {}",
            result
        );
        assert!(
            result.contains(".hidden_file"),
            "Should find hidden file: {}",
            result
        );
    }

    // ---- Options tests ----

    #[test]
    fn test_default_options() {
        let options = GlobOptions::default();
        assert_eq!(options.timeout_secs, 20);
        assert_eq!(options.output_max_chars, 100_000);
        assert_eq!(options.default_head_limit, 100);
    }

    #[test]
    fn test_custom_options() {
        let options = GlobOptions {
            timeout_secs: 60,
            output_max_chars: 50_000,
            default_head_limit: 50,
        };
        assert_eq!(options.timeout_secs, 60);
        assert_eq!(options.output_max_chars, 50_000);
        assert_eq!(options.default_head_limit, 50);
    }

    #[test]
    fn test_new_custom() {
        let glob = Glob::new(GlobOptions {
            timeout_secs: 30,
            output_max_chars: 200_000,
            default_head_limit: 500,
        });
        assert_eq!(glob.options.timeout_secs, 30);
        assert_eq!(glob.options.output_max_chars, 200_000);
        assert_eq!(glob.options.default_head_limit, 500);
    }
}
