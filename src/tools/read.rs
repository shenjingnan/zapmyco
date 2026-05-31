// Read 工具 — 读取本地文件系统中的文件内容，支持指定行号范围
//
// 本文件是 Anthropic Tool 的集成层，负责：
// - 定义 Tool JSON Schema（tool_definition）
// - 从 LLM 参数提取读取配置（execute）
// - 安全校验（路径、大小、二进制检测）
// - 格式化行号输出

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Read 配置选项
#[derive(Debug, Clone)]
pub struct FileReadOptions {
    /// 最大文件大小（字节），默认 262144 (256KB)
    pub max_size_bytes: u64,
    /// 输出最大字符数，默认 100_000
    pub output_max_chars: usize,
    /// 默认最大读取行数，默认 2000
    pub default_max_lines: u32,
}

impl Default for FileReadOptions {
    fn default() -> Self {
        Self {
            max_size_bytes: 262_144,
            output_max_chars: 100_000,
            default_max_lines: 2000,
        }
    }
}

// ---------------------------------------------------------------------------
// Core struct
// ---------------------------------------------------------------------------

/// Read 工具 — 读取本地文件系统中的文件内容
#[derive(Debug, Clone)]
pub struct FileRead {
    options: FileReadOptions,
}

impl FileRead {
    /// 创建新的 FileRead 实例
    pub fn new(options: FileReadOptions) -> Self {
        Self { options }
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "read".to_string(),
            description: Some(
                "读取本地文件系统中的文件内容，支持指定行号范围读取。\
                 适用于查看源代码、读取配置、分析日志文件等场景。\
                 此工具可直接读取任何本地文件，输出附带行号，比使用 cat/head/tail 更高效。\
                 对于大型文件请使用 offset 和 limit 参数分段读取。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "要读取的文件的绝对路径"
                    },
                    "offset": {
                        "type": "integer",
                        "description": "起始行号（从 1 开始），仅大文件需要分段读取时使用",
                        "minimum": 1
                    },
                    "limit": {
                        "type": "integer",
                        "description": "要读取的行数，仅大文件需要分段读取时使用",
                        "minimum": 1,
                        "maximum": 2000
                    }
                },
                "required": ["file_path"]
            })),
            ..Default::default()
        }
    }

    /// 执行文件读取
    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        // 1. 提取参数
        let file_path = input
            .get("file_path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'file_path'".to_string())?;

        let offset = input
            .get("offset")
            .and_then(|v| v.as_u64())
            .unwrap_or(1)
            .max(1) as usize;

        let limit = input
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(self.options.default_max_lines as usize);

        // 2. 路径校验
        let path = std::path::Path::new(file_path);

        if !path.exists() {
            return Err(format!("File not found: {}", file_path));
        }

        let metadata = tokio::fs::metadata(path)
            .await
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        if metadata.is_dir() {
            return Err(format!(
                "Is a directory: {}. Use `ls` command to list directory contents.",
                file_path
            ));
        }

        if cfg!(unix) && is_device_file(&metadata) {
            return Err(format!("Device file not allowed: {}", file_path));
        }

        let file_size = metadata.len();
        if file_size > self.options.max_size_bytes {
            return Err(format!(
                "File too large: {} bytes (max {} bytes). Use offset and limit to read specific portions.",
                file_size, self.options.max_size_bytes
            ));
        }

        // 3. 读取文件（原始字节）
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|e| format!("Read error: {}", e))?;

        // 4. 二进制检测：前 8KB 中是否有 null byte
        let check_len = bytes.len().min(8192);
        if bytes[..check_len].contains(&0x00) {
            return Err(format!(
                "Binary file: {}. Only text files are supported.",
                file_path
            ));
        }

        // 5. UTF-8 解码
        let content_string = String::from_utf8(bytes)
            .map_err(|_| format!("File is not valid UTF-8 text: {}", file_path))?;

        // BOM 剥离（UTF-8 BOM: U+FEFF, 编码为 3 字节 EF BB BF）
        let content: &str = content_string.trim_start_matches('\u{feff}');

        // 6. 行切片（str::lines() 自动处理 \n 和 \r\n）
        let total_lines = content.lines().count();

        let start = (offset - 1).min(total_lines);
        let end = (start + limit).min(total_lines);

        if start >= total_lines && total_lines > 0 {
            return Ok(format!(
                "文件 {} (共 {} 行)\n\nOffset {} 超出文件末尾。",
                file_path, total_lines, offset
            ));
        }

        // 7. 格式化输出
        let selected: Vec<&str> = content.lines().skip(start).take(end - start).collect();

        let mut result = if end > start {
            format!(
                "文件 {} (共 {} 行, 显示 {}-{} 行)\n\n",
                file_path,
                total_lines,
                start + 1,
                end
            )
        } else {
            format!("文件 {} (共 {} 行)\n\n", file_path, total_lines)
        };

        for (i, line) in selected.iter().enumerate() {
            result.push_str(&format!("{}\t{}\n", start + i + 1, line));
        }

        if end < total_lines {
            result.push_str(&format!(
                "\n---\n[显示 {}/{} 行，使用 offset={} 查看后续内容]\n",
                end - start,
                total_lines,
                end + 1
            ));
        }

        // 8. 输出上限检查
        if result.len() > self.options.output_max_chars {
            return Err(format!(
                "Output too large ({} chars, max {} chars)",
                result.len(),
                self.options.output_max_chars
            ));
        }

        Ok(result)
    }
}

// ---------------------------------------------------------------------------
// Device file detection
// ---------------------------------------------------------------------------

/// 检测是否为设备文件（字符设备或块设备）
#[cfg(unix)]
fn is_device_file(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;
    let ft = metadata.file_type();
    ft.is_char_device() || ft.is_block_device()
}

#[cfg(not(unix))]
fn is_device_file(_metadata: &std::fs::Metadata) -> bool {
    false
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helpers ----

    fn test_reader() -> FileRead {
        FileRead::new(FileReadOptions {
            max_size_bytes: 10_485_760, // 10 MB for tests
            output_max_chars: 100_000,
            default_max_lines: 2000,
        })
    }

    fn setup_temp_file(content: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.txt");
        std::fs::write(&file, content).unwrap();
        (dir, file)
    }

    // ---- Tool definition tests ----

    #[test]
    fn test_tool_definition_name() {
        let tool = FileRead::tool_definition();
        assert_eq!(tool.name, "read");
    }

    #[test]
    fn test_tool_definition_has_description() {
        let tool = FileRead::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_valid_schema() {
        let tool = FileRead::tool_definition();
        let schema = tool.input_schema.unwrap();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["file_path"].is_object());
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&serde_json::Value::String("file_path".to_string())));
    }

    #[test]
    fn test_tool_definition_all_parameters() {
        let tool = FileRead::tool_definition();
        let schema = tool.input_schema.unwrap();
        let props = schema["properties"].as_object().unwrap();

        let expected_params = ["file_path", "offset", "limit"];
        for param in &expected_params {
            assert!(props.contains_key(*param), "Missing parameter: {}", param);
        }
    }

    // ---- Execute tests ----

    #[tokio::test]
    async fn test_execute_basic() {
        let (_dir, file) = setup_temp_file("line1\nline2\nline3\n");
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
        });
        let result = reader.execute(&input).await.unwrap();
        assert!(result.contains("共 3 行"));
        assert!(result.contains("1\tline1"));
        assert!(result.contains("2\tline2"));
        assert!(result.contains("3\tline3"));
    }

    #[tokio::test]
    async fn test_execute_with_offset() {
        let (_dir, file) = setup_temp_file("line1\nline2\nline3\nline4\n");
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
            "offset": 3,
        });
        let result = reader.execute(&input).await.unwrap();
        assert!(!result.contains("line1"));
        assert!(!result.contains("line2"));
        assert!(result.contains("3\tline3"));
        assert!(result.contains("4\tline4"));
    }

    #[tokio::test]
    async fn test_execute_with_limit() {
        let (_dir, file) = setup_temp_file("line1\nline2\nline3\nline4\n");
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
            "limit": 2,
        });
        let result = reader.execute(&input).await.unwrap();
        assert!(result.contains("共 4 行"));
        assert!(result.contains("1\tline1"));
        assert!(result.contains("2\tline2"));
        assert!(!result.contains("3\tline3"));
        assert!(result.contains("offset=3"));
    }

    #[tokio::test]
    async fn test_execute_offset_and_limit() {
        let (_dir, file) = setup_temp_file("line1\nline2\nline3\nline4\nline5\n");
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
            "offset": 2,
            "limit": 2,
        });
        let result = reader.execute(&input).await.unwrap();
        assert!(!result.contains("line1"));
        assert!(result.contains("2\tline2"));
        assert!(result.contains("3\tline3"));
        assert!(!result.contains("line4"));
    }

    #[tokio::test]
    async fn test_execute_file_not_found() {
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": "/nonexistent/path/file.txt",
        });
        let result = reader.execute(&input).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("not found"));
    }

    #[tokio::test]
    async fn test_execute_directory() {
        let dir = tempfile::tempdir().unwrap();
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": dir.path().to_string_lossy().to_string(),
        });
        let result = reader.execute(&input).await;
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(
            err.contains("directory") || err.contains("Is a"),
            "Error: {}",
            err
        );
    }

    #[tokio::test]
    async fn test_execute_empty_file() {
        let (_dir, file) = setup_temp_file("");
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
        });
        let result = reader.execute(&input).await.unwrap();
        assert!(result.contains("共 0 行"));
    }

    #[tokio::test]
    async fn test_execute_binary_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("binary.bin");
        std::fs::write(&file, &[0x00, 0x01, 0x02, 0x03]).unwrap();
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
        });
        let result = reader.execute(&input).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("Binary file"));
    }

    #[tokio::test]
    async fn test_execute_bom_stripping() {
        // UTF-8 BOM: 0xEF 0xBB 0xBF = U+FEFF
        let (_dir, file) = setup_temp_file("\u{feff}hello\nworld\n");
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
        });
        let result = reader.execute(&input).await.unwrap();
        assert!(
            result.contains("1\thello"),
            "BOM should be stripped, got: {}",
            result
        );
        assert!(result.contains("2\tworld"));
    }

    #[tokio::test]
    async fn test_execute_crlf() {
        let (_dir, file) = setup_temp_file("line1\r\nline2\r\nline3\r\n");
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
        });
        let result = reader.execute(&input).await.unwrap();
        assert!(result.contains("1\tline1"));
        assert!(result.contains("2\tline2"));
        assert!(result.contains("3\tline3"));
        assert!(!result.contains("line1\r"));
    }

    #[tokio::test]
    async fn test_execute_offset_beyond_end() {
        let (_dir, file) = setup_temp_file("line1\nline2\n");
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
            "offset": 100,
        });
        let result = reader.execute(&input).await.unwrap();
        assert!(result.contains("超出文件末尾"));
    }

    #[tokio::test]
    async fn test_execute_missing_file_path() {
        let reader = test_reader();
        let input = serde_json::json!({
            "limit": 10,
        });
        let result = reader.execute(&input).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("file_path"));
    }

    #[tokio::test]
    async fn test_execute_file_too_large() {
        let reader = FileRead::new(FileReadOptions {
            max_size_bytes: 10,
            output_max_chars: 100_000,
            default_max_lines: 2000,
        });
        let (_dir, file) = setup_temp_file("this is more than 10 bytes of content\n");
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
        });
        let result = reader.execute(&input).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("too large"));
    }

    #[tokio::test]
    async fn test_execute_no_newline_at_end() {
        let (_dir, file) = setup_temp_file("line1\nline2\nline3");
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
        });
        let result = reader.execute(&input).await.unwrap();
        assert!(result.contains("共 3 行"));
        assert!(result.contains("3\tline3"));
    }

    #[tokio::test]
    async fn test_execute_not_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("invalid.txt");
        // Write invalid UTF-8 bytes (0xFF is not valid in UTF-8)
        std::fs::write(&file, &[0xff, 0xfe, 0x00]).unwrap();
        let reader = test_reader();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
        });
        let result = reader.execute(&input).await;
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(
            err.contains("UTF-8") || err.contains("Binary"),
            "Error: {}",
            err
        );
    }

    // ---- Options tests ----

    #[test]
    fn test_default_options() {
        let options = FileReadOptions::default();
        assert_eq!(options.max_size_bytes, 262_144);
        assert_eq!(options.output_max_chars, 100_000);
        assert_eq!(options.default_max_lines, 2000);
    }

    #[test]
    fn test_custom_options() {
        let options = FileReadOptions {
            max_size_bytes: 1024,
            output_max_chars: 5000,
            default_max_lines: 100,
        };
        assert_eq!(options.max_size_bytes, 1024);
        assert_eq!(options.output_max_chars, 5000);
        assert_eq!(options.default_max_lines, 100);
    }

    #[test]
    fn test_new_custom() {
        let reader = FileRead::new(FileReadOptions {
            max_size_bytes: 512,
            output_max_chars: 10_000,
            default_max_lines: 500,
        });
        assert_eq!(reader.options.max_size_bytes, 512);
        assert_eq!(reader.options.output_max_chars, 10_000);
        assert_eq!(reader.options.default_max_lines, 500);
    }
}
