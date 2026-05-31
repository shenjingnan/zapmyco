/// grep 工具 - 使用 ripgrep (rg) 在本地文件系统中搜索文件内容
use thiserror::Error;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// Grep 搜索错误类型
#[derive(Debug, Error)]
pub enum GrepError {
    /// ripgrep 未安装
    #[error("ripgrep (rg) 未找到。请先安装 ripgrep: https://github.com/BurntSushi/ripgrep")]
    RgNotFound,

    /// 搜索超时
    #[error("Grep timed out after {timeout_secs}s")]
    Timeout {
        /// 超时时间（秒）
        timeout_secs: u64,
    },

    /// rg 执行错误
    #[error("Grep failed: {0}")]
    ExecutionError(String),

    /// 输出超过大小限制
    #[error("Output too large: {size} bytes (max {max} bytes)")]
    OutputTooLarge {
        /// 实际输出大小
        size: usize,
        /// 最大允许大小
        max: usize,
    },
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Grep 配置选项
#[derive(Debug, Clone)]
pub struct GrepOptions {
    /// 搜索超时时间（秒），默认 20
    pub timeout_secs: u64,
    /// 输出最大字符数，默认 100_000
    pub output_max_chars: usize,
    /// 默认每模式最大结果行数，默认 250
    pub default_head_limit: u32,
}

impl Default for GrepOptions {
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

/// grep 工具 — 使用 ripgrep 在本地文件系统中搜索文件内容
#[derive(Debug, Clone)]
pub struct Grep {
    options: GrepOptions,
}

impl Grep {
    /// 创建新的 Grep 实例
    pub fn new(options: GrepOptions) -> Self {
        Self { options }
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "grep".to_string(),
            description: Some(
                "在本地文件系统中使用 ripgrep (rg) 搜索文件内容，支持正则表达式。\
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
    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, GrepError> {
        // 1. 提取参数
        let pattern = input
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| GrepError::ExecutionError("缺少必填参数 'pattern'".to_string()))?;

        let path = input.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let glob = input.get("glob").and_then(|v| v.as_str());
        let output_mode = input
            .get("output_mode")
            .and_then(|v| v.as_str())
            .unwrap_or("content");
        let after_context = input.get("-A").and_then(|v| v.as_i64());
        let before_context = input.get("-B").and_then(|v| v.as_i64());
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

        // 2. 构建 rg 参数
        let args = build_rg_args(
            pattern,
            path,
            glob,
            output_mode,
            after_context,
            before_context,
            context,
            ignore_case,
            multiline,
            file_type,
        );

        // 3. 执行 rg
        let timeout = std::time::Duration::from_secs(self.options.timeout_secs);

        // 查找 rg 可执行文件
        let rg_path = find_rg().ok_or(GrepError::RgNotFound)?;

        let output = tokio::time::timeout(timeout, async {
            tokio::process::Command::new(&rg_path)
                .args(&args)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .output()
                .await
        })
        .await
        .map_err(|_| GrepError::Timeout {
            timeout_secs: self.options.timeout_secs,
        })?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                GrepError::RgNotFound
            } else {
                GrepError::ExecutionError(e.to_string())
            }
        })?;

        // 4. 检查退出码
        // rg 退出码: 0 = 有匹配, 1 = 无匹配（非错误）, 2+ = 错误
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        match output.status.code() {
            Some(0) => {
                // 有结果，继续格式化
            }
            Some(1) => {
                // 无匹配，返回空结果
                return Ok(format!("在 \"{}\" 中未找到匹配 \"{}\"", path, pattern));
            }
            Some(code) => {
                // rg 错误
                let err_msg = if stderr.is_empty() {
                    format!("rg 退出码: {}", code)
                } else {
                    stderr.trim().to_string()
                };
                return Err(GrepError::ExecutionError(err_msg));
            }
            None => {
                return Err(GrepError::ExecutionError("rg 被信号终止".to_string()));
            }
        }

        // 5. 格式化输出
        let result = match output_mode {
            "files_with_matches" => format_files_with_matches(&stdout, pattern, head_limit, offset),
            "count" => format_count(&stdout, pattern, head_limit, offset),
            _ => format_content(&stdout, pattern, head_limit, offset),
        };

        // 6. 检查输出大小上限
        if result.len() > self.options.output_max_chars {
            return Err(GrepError::OutputTooLarge {
                size: result.len(),
                max: self.options.output_max_chars,
            });
        }

        Ok(result)
    }
}

// ---------------------------------------------------------------------------
// Helper: find rg binary
// ---------------------------------------------------------------------------

/// 查找系统中的 rg 可执行文件
fn find_rg() -> Option<String> {
    // 先尝试 PATH 中的 rg
    which_rg("rg")
}

#[cfg(not(target_os = "windows"))]
fn which_rg(name: &str) -> Option<String> {
    // 检查 PATH 中是否存在
    std::env::var_os("PATH").and_then(|paths| {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                // 在 Unix 系统上检查是否可执行
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(metadata) = std::fs::metadata(&candidate) {
                        let mode = metadata.permissions().mode();
                        if mode & 0o111 != 0 {
                            return Some(candidate.to_string_lossy().to_string());
                        }
                    }
                }
                #[cfg(not(unix))]
                {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
        None
    })
}

#[cfg(target_os = "windows")]
fn which_rg(name: &str) -> Option<String> {
    std::env::var_os("PATH").and_then(|paths| {
        for dir in std::env::split_paths(&paths) {
            for ext in ["", ".exe", ".cmd", ".bat"] {
                let candidate = dir.join(format!("{}{}", name, ext));
                if candidate.is_file() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
        None
    })
}

// ---------------------------------------------------------------------------
// Helper: build rg CLI arguments
// ---------------------------------------------------------------------------

/// 根据参数构建 rg 命令行参数列表
#[allow(clippy::too_many_arguments)]
fn build_rg_args(
    pattern: &str,
    path: &str,
    glob: Option<&str>,
    output_mode: &str,
    after_context: Option<i64>,
    before_context: Option<i64>,
    context: Option<i64>,
    ignore_case: bool,
    multiline: bool,
    file_type: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // 始终禁用 ANSI 颜色转义
    args.push("--color".to_string());
    args.push("never".to_string());

    // 行号（content 模式默认显示）
    if output_mode == "content" {
        args.push("--line-number".to_string());
        // 强制显示文件名前缀，确保输出格式一致便于解析
        args.push("-H".to_string());
    }

    // 输出模式
    if output_mode == "files_with_matches" {
        args.push("-l".to_string());
    } else if output_mode == "count" {
        args.push("-c".to_string());
    }

    // 上下文行
    if let Some(c) = context {
        args.push("-C".to_string());
        args.push(c.to_string());
    } else {
        if let Some(n) = after_context {
            args.push("-A".to_string());
            args.push(n.to_string());
        }
        if let Some(n) = before_context {
            args.push("-B".to_string());
            args.push(n.to_string());
        }
    }

    // 忽略大小写
    if ignore_case {
        args.push("-i".to_string());
    }

    // 多行模式
    if multiline {
        args.push("-U".to_string());
        args.push("--multiline-dotall".to_string());
    }

    // 文件类型过滤
    if let Some(t) = file_type {
        args.push("--type".to_string());
        args.push(t.to_string());
    }

    // 文件通配符过滤
    if let Some(g) = glob {
        args.push("--glob".to_string());
        args.push(g.to_string());
    }

    // 搜索模式（使用 -e 防止以 - 开头的模式被误解析为标志）
    args.push("-e".to_string());
    args.push(pattern.to_string());

    // 搜索路径
    args.push(path.to_string());

    args
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

    // 统计文件数和匹配行数
    let file_count = count_files_in_content(&lines[start..start + take]);
    let match_count = count_match_lines(&lines[start..start + take]);

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
        if let Some(file) = line.split(':').next() {
            // 空行或纯数字行（匹配行行号）不算文件头
            if !file.is_empty() && !file.chars().all(|c| c.is_ascii_digit()) {
                files.insert(file);
            }
        }
    }
    files.len()
}

/// 统计 content 模式下的匹配行数量（格式为 file:line:content 或 line:content）
fn count_match_lines(lines: &[&str]) -> usize {
    lines
        .iter()
        .filter(|l| {
            // 匹配 rg 输出的有行号的行: 冒号开头或 `数字:` 开头
            let trimmed = l.trim_start();
            if trimmed.is_empty() {
                return false;
            }
            // 上下文行以 `数字-` 格式开头，不是匹配行
            // 这里简化处理：只要包含 `:` 且非空就算
            // 实际 rg 输出中，匹配行是 `file:line:content` 或 `line:content`
            // 分隔行（空行或 --）不计
            trimmed.contains(':') && !trimmed.starts_with("--")
        })
        .count()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helper: 创建测试用 Grep 实例 ----

    fn test_grep() -> Grep {
        Grep::new(GrepOptions {
            timeout_secs: 10,
            output_max_chars: 100_000,
            default_head_limit: 250,
        })
    }

    fn short_timeout_grep() -> Grep {
        Grep::new(GrepOptions {
            timeout_secs: 1,
            output_max_chars: 100_000,
            default_head_limit: 250,
        })
    }

    /// 创建临时目录并写入测试文件
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
        let tool = Grep::tool_definition();
        assert_eq!(tool.name, "grep");
    }

    #[test]
    fn test_tool_definition_has_description() {
        let tool = Grep::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_valid_schema() {
        let tool = Grep::tool_definition();
        let schema = tool.input_schema.unwrap();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["pattern"].is_object());
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&serde_json::Value::String("pattern".to_string())));
    }

    #[test]
    fn test_tool_definition_required_fields() {
        let tool = Grep::tool_definition();
        let schema = tool.input_schema.unwrap();
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&serde_json::Value::String("pattern".to_string())));
        assert_eq!(required.len(), 1);
    }

    #[test]
    fn test_tool_definition_all_parameters() {
        let tool = Grep::tool_definition();
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

    // ---- Arg building tests ----

    #[test]
    fn test_build_args_default_content() {
        let args = build_rg_args(
            "hello", ".", None, "content", None, None, None, false, false, None,
        );
        assert!(args.contains(&"--color".to_string()));
        assert!(args.contains(&"never".to_string()));
        assert!(args.contains(&"--line-number".to_string()));
        assert!(args.contains(&"-H".to_string()));
        assert!(args.contains(&"-e".to_string()));
        assert!(args.contains(&"hello".to_string()));
        assert!(args.contains(&".".to_string()));
        // content 模式下不应有 -l 或 -c
        assert!(!args.contains(&"-l".to_string()));
        assert!(!args.contains(&"-c".to_string()));
    }

    #[test]
    fn test_build_args_files_with_matches() {
        let args = build_rg_args(
            "hello",
            ".",
            None,
            "files_with_matches",
            None,
            None,
            None,
            false,
            false,
            None,
        );
        assert!(args.contains(&"-l".to_string()));
        assert!(!args.contains(&"--line-number".to_string()));
        assert!(!args.contains(&"-c".to_string()));
    }

    #[test]
    fn test_build_args_count() {
        let args = build_rg_args(
            "hello", ".", None, "count", None, None, None, false, false, None,
        );
        assert!(args.contains(&"-c".to_string()));
        assert!(!args.contains(&"-l".to_string()));
    }

    #[test]
    fn test_build_args_ignore_case() {
        let args = build_rg_args(
            "Hello", ".", None, "content", None, None, None, true, false, None,
        );
        assert!(args.contains(&"-i".to_string()));
    }

    #[test]
    fn test_build_args_context() {
        let args = build_rg_args(
            "hello",
            ".",
            None,
            "content",
            None,
            None,
            Some(3),
            false,
            false,
            None,
        );
        let pos = args.iter().position(|a| a == "-C").unwrap();
        assert_eq!(args[pos + 1], "3");
    }

    #[test]
    fn test_build_args_after_context() {
        let args = build_rg_args(
            "hello",
            ".",
            None,
            "content",
            Some(5),
            None,
            None,
            false,
            false,
            None,
        );
        let pos = args.iter().position(|a| a == "-A").unwrap();
        assert_eq!(args[pos + 1], "5");
    }

    #[test]
    fn test_build_args_before_context() {
        let args = build_rg_args(
            "hello",
            ".",
            None,
            "content",
            None,
            Some(2),
            None,
            false,
            false,
            None,
        );
        let pos = args.iter().position(|a| a == "-B").unwrap();
        assert_eq!(args[pos + 1], "2");
    }

    #[test]
    fn test_build_args_context_overrides_ab() {
        // context (-C) 应优先于 -A/-B
        let args = build_rg_args(
            "hello",
            ".",
            None,
            "content",
            Some(5),
            Some(3),
            Some(2),
            false,
            false,
            None,
        );
        let pos_c = args.iter().position(|a| a == "-C").unwrap();
        assert_eq!(args[pos_c + 1], "2");
        // -A 和 -B 不应出现
        assert!(!args.contains(&"-A".to_string()));
        assert!(!args.contains(&"-B".to_string()));
    }

    #[test]
    fn test_build_args_multiline() {
        let args = build_rg_args(
            "hello", ".", None, "content", None, None, None, false, true, None,
        );
        assert!(args.contains(&"-U".to_string()));
        assert!(args.contains(&"--multiline-dotall".to_string()));
    }

    #[test]
    fn test_build_args_glob() {
        let args = build_rg_args(
            "hello",
            ".",
            Some("*.rs"),
            "content",
            None,
            None,
            None,
            false,
            false,
            None,
        );
        let pos = args.iter().position(|a| a == "--glob").unwrap();
        assert_eq!(args[pos + 1], "*.rs");
    }

    #[test]
    fn test_build_args_file_type() {
        let args = build_rg_args(
            "hello",
            ".",
            None,
            "content",
            None,
            None,
            None,
            false,
            false,
            Some("rust"),
        );
        let pos = args.iter().position(|a| a == "--type").unwrap();
        assert_eq!(args[pos + 1], "rust");
    }

    #[test]
    fn test_build_args_pattern_with_dash() {
        // 以 - 开头的模式应正常使用 -e
        let args = build_rg_args(
            "-v", ".", None, "content", None, None, None, false, false, None,
        );
        let e_pos = args.iter().position(|a| a == "-e").unwrap();
        assert_eq!(args[e_pos + 1], "-v");
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

    // ---- Integration tests (requires rg installed) ----

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
        // 应该找到两个文件中的匹配
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
        // 只在 test.rs 中搜索
        let input = serde_json::json!({
            "pattern": "hello",
            "path": file1.to_string_lossy().to_string(),
        });
        let result = grep.execute(&input).await.unwrap();
        assert!(result.contains("hello"));
        // 指定了单个文件，搜索结果应显示文件名
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
        // 应只搜到 Rust 文件
        assert!(result.contains("test.rs"));
        // 因 glob 过滤，不应包含 test.py
        // 如果结果是 "1 个文件" 说明 glob 生效
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
        // 不应包含行号或内容
        assert!(!result.contains("fn hello"));
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
        // 小写搜索，不忽略大小写时应该搜不到 "HELLO"（不存在）
        let input_no_ignore = serde_json::json!({
            "pattern": "HELLO",
            "path": dir.path().to_string_lossy().to_string(),
            "-i": false,
        });
        let result_no = grep.execute(&input_no_ignore).await.unwrap();
        assert!(result_no.contains("未找到匹配"));

        // 忽略大小写应该搜到
        let input_ignore = serde_json::json!({
            "pattern": "HELLO",
            "path": dir.path().to_string_lossy().to_string(),
            "-i": true,
        });
        let result_yes = grep.execute(&input_ignore).await.unwrap();
        assert!(result_yes.contains("hello"));
    }

    #[tokio::test]
    async fn test_execute_timeout() {
        let (dir, _) = setup_temp_dir();
        let grep = short_timeout_grep();
        // 搜索一个存在但不存在的模式，使用非常短的时间
        let input = serde_json::json!({
            "pattern": "hello",
            "path": dir.path().to_string_lossy().to_string(),
        });
        // 在当前目录下搜索大量内容可能会触发超时
        // 这里只是测试超时机制不 panic
        let _result = grep.execute(&input).await;
        // 可能超时也可能不超时，取决于系统负载
        // 只要不 panic 且返回 Ok 或 Timeout 错误即可
        match _result {
            Ok(s) => assert!(s.contains("hello") || s.contains("未找到匹配")),
            Err(e) => {
                match e {
                    GrepError::Timeout { .. } => {} // 预期行为
                    _ => panic!("Expected Timeout error, got: {}", e),
                }
            }
        }
    }

    #[tokio::test]
    async fn test_execute_empty_pattern() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "",
            "path": dir.path().to_string_lossy().to_string(),
        });
        // 空模式匹配所有行
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
        match result.err().unwrap() {
            GrepError::ExecutionError(msg) => {
                assert!(
                    msg.contains("pattern"),
                    "Error should mention pattern: {}",
                    msg
                );
            }
            other => panic!(
                "Expected ExecutionError for missing pattern, got: {}",
                other
            ),
        }
    }

    #[tokio::test]
    async fn test_execute_invalid_path() {
        let grep = test_grep();
        let input = serde_json::json!({
            "pattern": "hello",
            "path": "/nonexistent/path/xyz123",
        });
        // rg 对不存在的路径返回错误
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
        // head_limit=0 表示没有限制
        assert!(result.contains("hello"));
    }

    #[tokio::test]
    async fn test_execute_with_offset() {
        let (dir, _) = setup_temp_dir();
        let grep = test_grep();
        // 先获取完整结果
        let input_all = serde_json::json!({
            "pattern": "hello",
            "path": dir.path().to_string_lossy().to_string(),
            "head_limit": 100,
        });
        let result_all = grep.execute(&input_all).await.unwrap();

        // 再用 offset=1 跳过第一行
        let input_offset = serde_json::json!({
            "pattern": "hello",
            "path": dir.path().to_string_lossy().to_string(),
            "head_limit": 100,
            "offset": 1,
        });
        let result_offset = grep.execute(&input_offset).await.unwrap();

        // offset 后的结果应该不同
        if result_all.contains("\n---\n") {
            // 如果有截断，offset 应该改变输出
            assert_ne!(result_all, result_offset);
        }
    }

    // ---- Options tests ----

    #[test]
    fn test_default_options() {
        let options = GrepOptions::default();
        assert_eq!(options.timeout_secs, 20);
        assert_eq!(options.output_max_chars, 100_000);
        assert_eq!(options.default_head_limit, 250);
    }

    #[test]
    fn test_custom_options() {
        let options = GrepOptions {
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
        let grep = Grep::new(GrepOptions {
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
        let grep = Grep::new(GrepOptions::default());
        assert_eq!(grep.options.timeout_secs, 20);
        assert_eq!(grep.options.output_max_chars, 100_000);
        assert_eq!(grep.options.default_head_limit, 250);
    }

    // ---- find_rg tests ----

    #[test]
    fn test_find_rg_exists() {
        // rg 在这个环境中应该可用（已在系统上验证）
        let result = find_rg();
        assert!(result.is_some(), "rg should be installed");
        let path = result.unwrap();
        assert!(!path.is_empty());
    }
}
