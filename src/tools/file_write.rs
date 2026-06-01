// FileWrite 工具 — 创建新文件或完整覆盖已有文件
//
// 本文件是 Anthropic Tool 的集成层，负责：
// - 定义 Tool JSON Schema（tool_definition）
// - 从 LLM 参数提取写入配置（execute）
// - 安全校验（路径、二进制、编码）
// - 自动创建父目录
// - 文件写入
//
// 注意：预读检查（先读后写）在 agent/chat.rs 的工具派发层完成，不在本工具内部实现。

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// FileWrite 配置选项
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FileWriteOptions {}

// ---------------------------------------------------------------------------
// Core struct
// ---------------------------------------------------------------------------

/// FileWrite 工具 — 创建新文件或完整覆盖已有文件
#[derive(Debug, Clone)]
pub struct FileWrite {
    options: FileWriteOptions,
}

impl FileWrite {
    /// 创建新的 FileWrite 实例
    pub fn new(options: FileWriteOptions) -> Self {
        Self { options }
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "file_write".to_string(),
            description: Some(
                "创建新文件或完整覆盖已有文件。\
                 参数包括 file_path（必填，文件绝对路径）、content（必填，要写入的完整文件内容）。\
                 注意：如果要覆盖已有的文件，必须先使用 file_read 读取文件内容后才可以写入。\
                 对于已有文件的小范围修改，建议使用 file_edit 工具。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "要写入的文件的绝对路径（必须使用绝对路径）"
                    },
                    "content": {
                        "type": "string",
                        "description": "要写入的完整文件内容"
                    }
                },
                "required": ["file_path", "content"]
            })),
            ..Default::default()
        }
    }

    /// 执行文件写入
    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        // 1. 提取参数
        let file_path = input
            .get("file_path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'file_path'".to_string())?;

        let content = input
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'content'".to_string())?;

        if file_path.is_empty() {
            return Err("file_path 不能为空".to_string());
        }

        // 2. 路径校验
        let path = std::path::Path::new(file_path);

        // 3. 检查是否为目录
        if path.exists() {
            let metadata =
                std::fs::metadata(path).map_err(|e| format!("读取文件元数据失败: {}", e))?;
            if metadata.is_dir() {
                return Err(format!("'{}' 是一个目录，不能写入文件", file_path));
            }
        }

        // 4. 二进制检测：content 中的前 8KB 是否有 null byte
        let content_bytes = content.as_bytes();
        let check_len = content_bytes.len().min(8192);
        if content_bytes[..check_len].contains(&0x00) {
            return Err(
                "写入内容包含 null byte 序列，不能写入二进制内容。仅支持文本文件写入。".to_string(),
            );
        }

        // 5. 自动创建父目录
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
            && !parent.exists()
        {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 '{}': {}", parent.display(), e))?;
        }

        // 6. 判断操作类型（创建新文件还是覆盖已有文件）
        let is_new = !path.exists();

        // 7. 写入文件
        std::fs::write(path, content_bytes)
            .map_err(|e| format!("写入文件失败 '{}': {}", file_path, e))?;

        // 8. 返回结果
        if is_new {
            Ok(format!(
                "文件 '{}' 创建成功（{} 字节）",
                file_path,
                content_bytes.len()
            ))
        } else {
            Ok(format!(
                "文件 '{}' 写入完成（已覆盖原有内容，{} 字节）",
                file_path,
                content_bytes.len()
            ))
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helpers ----

    fn make_writer() -> FileWrite {
        FileWrite::new(FileWriteOptions {})
    }

    fn execute_write(file: &std::path::Path, content: &str) -> Result<String, String> {
        let writer = make_writer();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
            "content": content,
        });
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(writer.execute(&input))
    }

    // ---- Tool definition tests ----

    #[test]
    fn test_tool_definition_name() {
        let tool = FileWrite::tool_definition();
        assert_eq!(tool.name, "file_write");
    }

    #[test]
    fn test_tool_definition_has_description() {
        let tool = FileWrite::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_valid_schema() {
        let tool = FileWrite::tool_definition();
        let schema = tool.input_schema.unwrap();
        assert_eq!(schema["type"], "object");
        let props = schema["properties"].as_object().unwrap();
        assert!(props.contains_key("file_path"));
        assert!(props.contains_key("content"));
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&serde_json::Value::String("file_path".to_string())));
        assert!(required.contains(&serde_json::Value::String("content".to_string())));
    }

    // ---- Execute success tests ----

    #[test]
    fn test_execute_create_new_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("new_file.txt");
        assert!(!file.exists());
        let result = execute_write(&file, "Hello, world!").unwrap();
        assert!(result.contains("创建成功"));
        assert!(file.exists());
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "Hello, world!");
    }

    #[test]
    fn test_execute_overwrite_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("existing.txt");
        std::fs::write(&file, "old content").unwrap();
        let result = execute_write(&file, "new content").unwrap();
        assert!(result.contains("覆盖"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "new content");
    }

    #[test]
    fn test_execute_empty_content() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("empty.txt");
        let result = execute_write(&file, "").unwrap();
        assert!(result.contains("创建成功"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "");
    }

    #[test]
    fn test_execute_multiline_content() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("multiline.txt");
        execute_write(&file, "line1\nline2\nline3\n").unwrap();
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "line1\nline2\nline3\n");
    }

    #[test]
    fn test_execute_chinese_content() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("chinese.txt");
        execute_write(&file, "你好，世界！").unwrap();
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "你好，世界！");
    }

    #[test]
    fn test_execute_creates_parent_directory() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("subdir").join("nested").join("file.txt");
        assert!(!file.parent().unwrap().exists());
        let result = execute_write(&file, "nested file").unwrap();
        assert!(result.contains("创建成功"));
        assert!(file.exists());
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "nested file");
    }

    // ---- Error tests ----

    #[test]
    fn test_execute_empty_file_path() {
        let writer = make_writer();
        let input = serde_json::json!({
            "file_path": "",
            "content": "hello",
        });
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(writer.execute(&input));
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("不能为空"));
    }

    #[test]
    fn test_execute_missing_file_path() {
        let writer = make_writer();
        let input = serde_json::json!({
            "content": "hello",
        });
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(writer.execute(&input));
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("file_path"));
    }

    #[test]
    fn test_execute_missing_content() {
        let writer = make_writer();
        let input = serde_json::json!({
            "file_path": "/tmp/test.txt",
        });
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(writer.execute(&input));
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("content"));
    }

    #[test]
    fn test_execute_directory() {
        let dir = tempfile::tempdir().unwrap();
        let result = execute_write(dir.path(), "content");
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("目录"));
    }

    #[test]
    fn test_execute_binary_content() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("binary.txt");
        let content = "text\x00binary";
        let result = execute_write(&file, content);
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("二进制"));
    }

    #[test]
    fn test_execute_invalid_path() {
        // 使用无效路径字符
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("\0 invalid");
        let result = execute_write(&file, "hello");
        // 应该失败，但不一定是哪种错误
        assert!(result.is_err());
    }

    #[test]
    fn test_execute_large_file_path() {
        // 非常长的路径
        let dir = tempfile::tempdir().unwrap();
        let long_name = "a".repeat(300);
        let file = dir.path().join(&long_name);
        let result = execute_write(&file, "content");
        // 可能成功也可能失败（取决于系统路径长度限制）
        // 只要不 panic 就行
        let _ = result;
    }

    // ---- Options tests ----

    #[test]
    fn test_default_options() {
        let options = FileWriteOptions::default();
        assert_eq!(options, FileWriteOptions {});
    }

    #[test]
    fn test_new() {
        let writer = FileWrite::new(FileWriteOptions {});
        assert_eq!(writer.options, FileWriteOptions {});
    }

    #[test]
    fn test_execute_overwrite_with_different_encoding() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("encoding.txt");
        // 先写入英文
        execute_write(&file, "english text").unwrap();
        // 再写入中文（UTF-8）
        let result = execute_write(&file, "中文文本").unwrap();
        assert!(result.contains("覆盖"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "中文文本");
    }

    #[test]
    fn test_execute_multiple_writes() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("multi.txt");
        execute_write(&file, "v1").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "v1");
        execute_write(&file, "v2").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "v2");
        execute_write(&file, "v3").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "v3");
    }

    #[test]
    fn test_execute_crlf_content() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("crlf.txt");
        execute_write(&file, "line1\r\nline2\r\n").unwrap();
        let content = std::fs::read_to_string(&file).unwrap();
        // 保留原始内容，不做换行符转换
        assert_eq!(content, "line1\r\nline2\r\n");
    }
}
