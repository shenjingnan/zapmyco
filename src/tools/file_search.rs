// file_search 工具 — 基于 zapmyco-grep 在本地文件系统中搜索文件内容
//
// 本文件是 Anthropic Tool 的集成层，负责：
// - 定义 Tool JSON Schema（tool_definition）
// - 从 LLM 参数提取搜索配置（execute）
// - 调用 zapmyco-grep 搜索引擎
// - 格式化输出并应用分页

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// FileSearch 配置选项
#[derive(Debug, Clone)]
pub struct FileSearchOptions {
    /// 搜索超时时间（秒），默认 20
    pub timeout_secs: u64,
    /// 输出最大字符数，默认 100_000
    pub output_max_chars: usize,
    /// 默认每模式最大结果行数，默认 250
    pub default_head_limit: u32,
}

impl Default for FileSearchOptions {
    fn default() -> Self {
        Self {
            timeout_secs: 20,
            output_max_chars: 100_000,
            default_head_limit: 250,
        }
    }
}

// ---------------------------------------------------------------------------
// Core struct
// ---------------------------------------------------------------------------

/// file_search 工具 — 在本地文件系统中搜索文件内容
#[derive(Debug, Clone)]
pub struct FileSearch {
    options: FileSearchOptions,
}

impl FileSearch {
    /// 创建新的 FileSearch 实例
    pub fn new(options: FileSearchOptions) -> Self {
        Self { options }
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "file_search".to_string(),
            description: Some(
                "在本地文件系统中搜索文件内容，支持正则表达式。\
                 适用于查找代码定义、搜索关键词、分析项目结构等场景。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "搜索模式（正则表达式）"
                    },
                    "path": {
                        "type": "string",
                        "description": "搜索路径（目录或文件），默认当前目录"
                    },
                    "glob": {
                        "type": "string",
                        "description": "文件通配符过滤，例如 \"*.rs\" 只搜索 Rust 文件"
                    },
                    "output_mode": {
                        "type": "string",
                        "enum": ["content", "files_with_matches", "count"],
                        "description": "输出模式：content（显示匹配行及行号，默认）、files_with_matches（仅显示文件名）、count（显示每个文件的匹配数）"
                    },
                    "-A": {
                        "type": "integer",
                        "description": "匹配行后显示的上下文行数"
                    },
                    "-B": {
                        "type": "integer",
                        "description": "匹配行前显示的上下文行数"
                    },
                    "-C": {
                        "type": "integer",
                        "description": "匹配行前后显示的上下文行数"
                    },
                    "-i": {
                        "type": "boolean",
                        "description": "忽略大小写"
                    },
                    "head_limit": {
                        "type": "integer",
                        "description": "最大结果行数，默认 250"
                    },
                    "offset": {
                        "type": "integer",
                        "description": "跳过前 N 条结果"
                    },
                    "multiline": {
                        "type": "boolean",
                        "description": "启用多行模式（让 . 匹配换行符）"
                    },
                    "type": {
                        "type": "string",
                        "description": "文件类型过滤，例如 \"rust\"、\"py\"、\"js\"、\"md\""
                    }
                },
                "required": ["pattern"]
            })),
            ..Default::default()
        }
    }

    /// 执行文件内容搜索
    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        // 1. 提取参数
        let pattern = input
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'pattern'".to_string())?;

        let path = input.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let glob = input.get("glob").and_then(|v| v.as_str());
        let output_mode = input
            .get("output_mode")
            .and_then(|v| v.as_str())
            .unwrap_or("content");
        let after_context = input.get("-A").and_then(|v| v.as_i64()).unwrap_or(0);
        let before_context = input.get("-B").and_then(|v| v.as_i64()).unwrap_or(0);
        let context = input.get("-C").and_then(|v| v.as_i64());
        let ignore_case = input.get("-i").and_then(|v| v.as_bool()).unwrap_or(false);
        let head_limit = input
            .get("head_limit")
            .and_then(|v| v.as_u64())
            .unwrap_or(self.options.default_head_limit as u64);
        let offset = input.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);
        let multiline = input
            .get("multiline")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let file_type = input.get("type").and_then(|v| v.as_str());

        // -C 优先级高于 -A/-B
        let (after_ctx, before_ctx) = if let Some(c) = context {
            (c as usize, c as usize)
        } else {
            (after_context as usize, before_context as usize)
        };

        // 2. 构建搜索选项
        let search_options = zapmyco_grep::SearchOptions {
            pattern: pattern.to_string(),
            path: path.to_string(),
            glob: glob.map(|s| s.to_string()),
            ignore_case,
            multiline,
            file_type: file_type.map(|s| s.to_string()),
            after_context: after_ctx,
            before_context: before_ctx,
        };

        // 3. 执行搜索（在 spawn_blocking 中执行同步搜索）
        let timeout = std::time::Duration::from_secs(self.options.timeout_secs);
        let search_handle =
            tokio::task::spawn_blocking(move || zapmyco_grep::search(search_options));

        let search_result = tokio::time::timeout(timeout, search_handle)
            .await
            .map_err(|_| format!("FileSearch 搜索超时 (超过 {}s)", self.options.timeout_secs))?
            .map_err(|e| format!("FileSearch 搜索被中断: {}", e))?;

        let results = search_result.map_err(|e| format!("FileSearch 搜索失败: {}", e))?;

        // 4. 无匹配时快速返回
        if results.matches.is_empty() {
            return Ok(format!("在 \"{}\" 中未找到匹配 \"{}\"", path, pattern));
        }

        // 5. 将结构化结果转为 stdout 格式（与现有格式化函数兼容）
        let stdout = build_stdout(&results, output_mode);

        // 6. 格式化输出并应用分页
        let result = match output_mode {
            "files_with_matches" => format_files_with_matches(&stdout, pattern, head_limit, offset),
            "count" => format_count(&stdout, pattern, head_limit, offset),
            _ => format_content(&stdout, pattern, head_limit, offset),
        };

        // 7. 检查输出上限
        if result.len() > self.options.output_max_chars {
            return Err(format!(
                "FileSearch 输出过大 ({} 字符，上限 {})",
                result.len(),
                self.options.output_max_chars
            ));
        }

        Ok(result)
    }
}

// ---------------------------------------------------------------------------
// Structured results → stdout format
// ---------------------------------------------------------------------------

/// 将 SearchResults 转换为与旧版格式化函数兼容的 stdout 字符串
fn build_stdout(results: &zapmyco_grep::SearchResults, output_mode: &str) -> String {
    match output_mode {
        "files_with_matches" => {
            // 去重文件路径
            let mut files: Vec<&str> = results
                .matches
                .iter()
                .map(|m| m.path.as_str())
                .collect::<std::collections::BTreeSet<&str>>()
                .into_iter()
                .collect();
            files.sort();
            files.join("\n")
        }
        "count" => {
            // 按文件统计匹配数
            let mut counts: std::collections::BTreeMap<&str, usize> =
                std::collections::BTreeMap::new();
            for m in &results.matches {
                *counts.entry(m.path.as_str()).or_insert(0) += 1;
            }
            counts
                .iter()
                .map(|(path, count)| format!("{}:{}", path, count))
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => {
            // content 模式：path:line:content
            results
                .matches
                .iter()
                .map(|m| format!("{}:{}:{}", m.path, m.line_number, m.content.trim_end()))
                .collect::<Vec<_>>()
                .join("\n")
        }
    }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/// 格式化 content 模式输出
fn format_content(stdout: &str, pattern: &str, head_limit: u64, offset: u64) -> String {
    let lines: Vec<&str> = stdout.lines().collect();
    let total_lines = lines.len();

    let start = (offset as usize).min(total_lines);
    let available = total_lines - start;
    let take = (head_limit as usize).min(available);
    let truncated = take < available;

    let file_count = count_files_in_content(&lines[start..start + take]);
    let match_count = take; // 每行一条匹配

    let mut out = String::new();
    out.push_str(&format!(
        "匹配 \"{}\" 于 {} 个文件 ({} 处匹配)\n\n",
        pattern, file_count, match_count
    ));

    for line in &lines[start..start + take] {
        out.push_str(line);
        out.push('\n');
    }

    if truncated {
        out.push_str(&format!(
            "\n---\n[显示 {} / {} 行，使用 offset={} 和 head_limit 进行分页]\n",
            take,
            total_lines,
            start + take
        ));
    }

    out
}

/// 格式化 files_with_matches 模式输出
fn format_files_with_matches(stdout: &str, pattern: &str, head_limit: u64, offset: u64) -> String {
    let files: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();
    let total_files = files.len();

    let start = (offset as usize).min(total_files);
    let available = total_files - start;
    let take = (head_limit as usize).min(available);
    let truncated = take < available;

    let mut out = String::new();
    out.push_str(&format!(
        "匹配 \"{}\" 于 {} 个文件:\n",
        pattern, total_files
    ));

    for f in &files[start..start + take] {
        out.push_str(f);
        out.push('\n');
    }

    if truncated {
        out.push_str(&format!(
            "\n---\n[显示 {} / {} 个文件]\n",
            take, total_files
        ));
    }

    out
}

/// 格式化 count 模式输出
fn format_count(stdout: &str, pattern: &str, head_limit: u64, offset: u64) -> String {
    let lines: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();
    let total_files = lines.len();

    let start = (offset as usize).min(total_files);
    let available = total_files - start;
    let take = (head_limit as usize).min(available);
    let truncated = take < available;

    // 统计所有文件中的匹配总数
    let total_matches: u64 = lines[start..start + take]
        .iter()
        .filter_map(|l| {
            let parts: Vec<&str> = l.split(':').collect();
            if parts.len() >= 2 {
                parts.last().and_then(|s| s.trim().parse::<u64>().ok())
            } else {
                None
            }
        })
        .sum();

    let mut out = String::new();
    out.push_str(&format!(
        "匹配 \"{}\" 于 {} 个文件 (共 {} 处匹配):\n",
        pattern, total_files, total_matches
    ));

    for l in &lines[start..start + take] {
        out.push_str(&format!("  {}\n", l));
    }

    if truncated {
        out.push_str(&format!(
            "\n---\n[显示 {} / {} 个文件]\n",
            take, total_files
        ));
    }

    out
}

/// 统计 content 模式下行中有多少个不同文件
fn count_files_in_content(lines: &[&str]) -> usize {
    let mut files = std::collections::BTreeSet::new();
    for line in lines {
        if let Some(file) = line.split(':').next()
            && !file.is_empty()
            && !file.chars().all(|c| c.is_ascii_digit())
        {
            files.insert(file);
        }
    }
    files.len()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helper ----

    fn test_grep() -> FileSearch {
        FileSearch::new(FileSearchOptions {
            timeout_secs: 10,
            output_max_chars: 100_000,
            default_head_limit: 250,
        })
    }

    fn setup_temp_dir() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let file1 = dir.path().join("test.rs");
        std::fs::write(
            &file1,
            "fn hello() {\n    println!(\"hello world\");\n}\n\nfn world() {\n    println!(\"hello again\");\n}\n",
        )
        .unwrap();

        let file2 = dir.path().join("test.py");
        std::fs::write(
            &file2,
            "def hello():\n    print(\"hello world\")\n\ndef world():\n    print(\"hello again\")\n",
        )
        .unwrap();

        (dir, file1)
    }

    // ---- Tool definition tests ----

    #[test]
    fn test_tool_definition_name() {
        let tool = FileSearch::tool_definition();
        assert_eq!(tool.name, "file_search");
    }

    #[test]
    fn test_tool_definition_has_description() {
        let tool = FileSearch::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_valid_schema() {
        let tool = FileSearch::tool_definition();
        let schema = tool.input_schema.unwrap();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["pattern"].is_object());
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&serde_json::Value::String("pattern".to_string())));
    }

    #[test]
    fn test_tool_definition_required_fields() {
        let tool = FileSearch::tool_definition();
        let schema = tool.input_schema.unwrap();
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&serde_json::Value::String("pattern".to_string())));
        assert_eq!(required.len(), 1);
    }

    #[test]
    fn test_tool_definition_all_parameters() {
        let tool = FileSearch::tool_definition();
        let schema = tool.input_schema.unwrap();
        let props = schema["properties"].as_object().unwrap();

        let expected_params = [
            "pattern",
            "path",
            "glob",
            "output_mode",
            "-A",
            "-B",
            "-C",
            "-i",
            "head_limit",
            "offset",
            "multiline",
            "type",
        ];
        for param in &expected_params {
            assert!(props.contains_key(*param), "Missing parameter: {}", param);
        }
    }

    // ---- Output formatting tests ----

    #[test]
    fn test_format_content_basic() {
        let stdout = "test.rs:1:fn hello() {\ntest.rs:5:fn world() {\n";
        let result = format_content(stdout, "fn", 250, 0);
        assert!(result.contains("匹配 \"fn\" 于 1 个文件"));
        assert!(result.contains("test.rs:1:fn hello()"));
        assert!(result.contains("test.rs:5:fn world()"));
        assert!(!result.contains("分页"));
    }

    #[test]
    fn test_format_content_with_limit() {
        let stdout = "a:1:line1\na:2:line2\na:3:line3\n";
        let result = format_content(stdout, "line", 2, 0);
        assert!(result.contains("显示 2 / 3 行"));
        assert!(result.contains("line1"));
        assert!(result.contains("line2"));
        assert!(!result.contains("line3"));
    }

    #[test]
    fn test_format_content_with_offset() {
        let stdout = "a:1:line1\na:2:line2\na:3:line3\n";
        let result = format_content(stdout, "line", 250, 1);
        assert!(!result.contains("line1"));
        assert!(result.contains("line2"));
        assert!(result.contains("line3"));
    }

    #[test]
    fn test_format_content_with_offset_and_limit() {
        let stdout = "a:1:line1\na:2:line2\na:3:line3\na:4:line4\n";
        let result = format_content(stdout, "line", 2, 1);
        assert!(result.contains("显示 2"));
        assert!(!result.contains("line1"));
        assert!(result.contains("line2"));
        assert!(result.contains("line3"));
        assert!(!result.contains("line4"));
    }

    #[test]
    fn test_format_content_no_matches() {
        let result = format_content("", "fn", 250, 0);
        assert!(result.contains("0 个文件"));
        assert!(result.contains("0 处匹配"));
    }

    #[test]
    fn test_format_files_with_matches_basic() {
        let stdout = "file1.rs\nfile2.rs\n";
        let result = format_files_with_matches(stdout, "fn", 250, 0);
        assert!(result.contains("匹配 \"fn\" 于 2 个文件"));
        assert!(result.contains("file1.rs"));
        assert!(result.contains("file2.rs"));
    }

    #[test]
    fn test_format_files_with_matches_limit() {
        let stdout = "a.rs\nb.rs\nc.rs\n";
        let result = format_files_with_matches(stdout, "fn", 2, 0);
        assert!(result.contains("显示 2 / 3 个文件"));
        assert!(result.contains("a.rs"));
        assert!(result.contains("b.rs"));
        assert!(!result.contains("c.rs"));
    }

    #[test]
    fn test_format_files_with_matches_empty() {
        let result = format_files_with_matches("", "fn", 250, 0);
        assert!(result.contains("0 个文件"));
    }

    #[test]
    fn test_format_count_basic() {
        let stdout = "file1.rs:3\nfile2.rs:5\n";
        let result = format_count(stdout, "fn", 250, 0);
        assert!(result.contains("匹配 \"fn\" 于 2 个文件"));
        assert!(result.contains("共 8 处匹配"));
        assert!(result.contains("file1.rs:3"));
    }

    #[test]
    fn test_format_count_empty() {
        let result = format_count("", "fn", 250, 0);
        assert!(result.contains("0 个文件"));
        assert!(result.contains("0 处匹配"));
    }

    // ---- Integration tests (use internal search) ----

    #[tokio::test]
    async fn test_execute_basic_search() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "hello",
            "path": dir.path().to_string_lossy().to_string(),
        });
        let result = grep.execute(&input).await.unwrap();
        assert!(result.contains("hello"));
        assert!(result.contains("test.rs") || result.contains("test.py"));
    }

    #[tokio::test]
    async fn test_execute_no_matches() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "nonexistent_pattern_xyz",
            "path": dir.path().to_string_lossy().to_string(),
        });
        let result = grep.execute(&input).await.unwrap();
        assert!(result.contains("未找到匹配"));
    }

    #[tokio::test]
    async fn test_execute_with_path() {
        let (_dir, file1) = setup_temp_dir();
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "hello",
            "path": file1.to_string_lossy().to_string(),
        });
        let result = grep.execute(&input).await.unwrap();
        assert!(result.contains("hello"));
        assert!(result.contains("test.rs") || result.contains("1 个文件"));
    }

    #[tokio::test]
    async fn test_execute_with_glob() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "hello",
            "path": dir.path().to_string_lossy().to_string(),
            "glob": "*.rs",
        });
        let result = grep.execute(&input).await.unwrap();
        assert!(result.contains("hello"));
        assert!(result.contains("test.rs"));
    }

    #[tokio::test]
    async fn test_execute_files_with_matches_mode() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "hello",
            "path": dir.path().to_string_lossy().to_string(),
            "output_mode": "files_with_matches",
        });
        let result = grep.execute(&input).await.unwrap();
        assert!(result.contains("个文件"));
        assert!(result.contains("test.rs") || result.contains("test.py"));
    }

    #[tokio::test]
    async fn test_execute_count_mode() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "hello",
            "path": dir.path().to_string_lossy().to_string(),
            "output_mode": "count",
        });
        let result = grep.execute(&input).await.unwrap();
        assert!(result.contains("个文件"));
        assert!(result.contains("处匹配"));
    }

    #[tokio::test]
    async fn test_execute_ignore_case() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input_no_ignore = serde_json::json!({
            "pattern": "HELLO",
            "path": dir.path().to_string_lossy().to_string(),
            "-i": false,
        });
        let result_no = grep.execute(&input_no_ignore).await.unwrap();
        assert!(result_no.contains("未找到匹配"));

        let input_ignore = serde_json::json!({
            "pattern": "HELLO",
            "path": dir.path().to_string_lossy().to_string(),
            "-i": true,
        });
        let result_yes = grep.execute(&input_ignore).await.unwrap();
        assert!(result_yes.contains("hello"));
    }

    #[tokio::test]
    async fn test_execute_empty_pattern() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "",
            "path": dir.path().to_string_lossy().to_string(),
        });
        let result = grep.execute(&input).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("匹配"));
    }

    #[tokio::test]
    async fn test_execute_missing_pattern() {
        let grep = test_grep();
        let input = serde_json::json!({
            "path": ".",
        });
        let result = grep.execute(&input).await;
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(
            err.contains("pattern"),
            "Error should mention pattern: {}",
            err
        );
    }

    #[tokio::test]
    async fn test_execute_invalid_path() {
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "hello",
            "path": "/nonexistent/path/xyz123",
        });
        let result = grep.execute(&input).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_execute_multiple_files() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "hello world",
            "path": dir.path().to_string_lossy().to_string(),
        });
        let result = grep.execute(&input).await.unwrap();
        assert!(result.contains("hello world"));
        assert!(
            result.contains("test.rs") || result.contains("test.py") || result.contains("个文件")
        );
    }

    #[tokio::test]
    async fn test_execute_head_limit() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "hello",
            "path": dir.path().to_string_lossy().to_string(),
            "head_limit": 0,
        });
        let result = grep.execute(&input).await.unwrap();
        assert!(result.contains("hello"));
    }

    #[tokio::test]
    async fn test_execute_with_offset() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input_all = serde_json::json!({
            "pattern": "hello",
            "path": dir.path().to_string_lossy().to_string(),
            "head_limit": 100,
        });
        let result_all = grep.execute(&input_all).await.unwrap();

        let input_offset = serde_json::json!({
            "pattern": "hello",
            "path": dir.path().to_string_lossy().to_string(),
            "head_limit": 100,
            "offset": 1,
        });
        let result_offset = grep.execute(&input_offset).await.unwrap();

        if result_all.contains("\n---\n") {
            assert_ne!(result_all, result_offset);
        }
    }

    // ---- Options tests ----

    #[test]
    fn test_default_options() {
        let options = FileSearchOptions::default();
        assert_eq!(options.timeout_secs, 20);
        assert_eq!(options.output_max_chars, 100_000);
        assert_eq!(options.default_head_limit, 250);
    }

    #[test]
    fn test_custom_options() {
        let options = FileSearchOptions {
            timeout_secs: 60,
            output_max_chars: 50_000,
            default_head_limit: 100,
        };
        assert_eq!(options.timeout_secs, 60);
        assert_eq!(options.output_max_chars, 50_000);
        assert_eq!(options.default_head_limit, 100);
    }

    #[test]
    fn test_new_custom() {
        let grep = FileSearch::new(FileSearchOptions {
            timeout_secs: 30,
            output_max_chars: 200_000,
            default_head_limit: 500,
        });
        assert_eq!(grep.options.timeout_secs, 30);
        assert_eq!(grep.options.output_max_chars, 200_000);
        assert_eq!(grep.options.default_head_limit, 500);
    }

    #[test]
    fn test_new_default() {
        let grep = FileSearch::new(FileSearchOptions::default());
        assert_eq!(grep.options.timeout_secs, 20);
        assert_eq!(grep.options.output_max_chars, 100_000);
        assert_eq!(grep.options.default_head_limit, 250);
    }
}
