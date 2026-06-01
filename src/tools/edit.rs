// Edit 工具 — 使用 old_string/new_string 模式修改本地文件内容
//
// 本文件是 Anthropic Tool 的集成层，负责：
// - 定义 Tool JSON Schema（tool_definition）
// - 从 LLM 参数提取编辑配置（execute）
// - 安全校验（路径、二进制、编码）
// - 引号归一化（处理 Claude 模型的 smart quotes 问题）
// - 精确字符串替换

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Edit 配置选项
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EditOptions {}

// ---------------------------------------------------------------------------
// Core struct
// ---------------------------------------------------------------------------

/// Edit 工具 — 使用 old_string/new_string 模式精确替换文件内容
#[derive(Debug, Clone)]
pub struct Edit {
    options: EditOptions,
}

impl Edit {
    /// 创建新的 Edit 实例
    pub fn new(options: EditOptions) -> Self {
        Self { options }
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "edit".to_string(),
            description: Some(
                "修改本地文件系统中的文件内容。\
                 使用 old_string/new_string 模式进行精确替换，\
                 比 sed 命令更安全可靠。\
                 参数包括 file_path（必填，文件路径）、old_string（必填，要被替换的文本）、\
                 new_string（必填，替换后的文本）、replace_all（可选，是否替换所有匹配项）。\
                 注意：需要确保 old_string 在文件中出现且唯一，否则会报错。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "要修改的文件的绝对路径"
                    },
                    "old_string": {
                        "type": "string",
                        "description": "要被替换的文本，必须在文件中精确匹配"
                    },
                    "new_string": {
                        "type": "string",
                        "description": "替换后的文本（必须与 old_string 不同）"
                    },
                    "replace_all": {
                        "type": "boolean",
                        "description": "是否替换所有匹配项（默认 false）",
                        "default": false
                    }
                },
                "required": ["file_path", "old_string", "new_string"]
            })),
            ..Default::default()
        }
    }

    /// 执行文件编辑
    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        // 1. 提取参数
        let file_path = input
            .get("file_path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'file_path'".to_string())?;

        let old_string = input
            .get("old_string")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'old_string'".to_string())?;

        let new_string = input
            .get("new_string")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'new_string'".to_string())?;

        let replace_all = input
            .get("replace_all")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // 2. 校验参数
        if old_string == new_string {
            return Err("old_string 和 new_string 相同，没有需要修改的内容".to_string());
        }

        if old_string.is_empty() {
            return Err("old_string 不能为空（暂不支持创建新文件）".to_string());
        }

        // 3. 路径校验
        let path = std::path::Path::new(file_path);

        if !path.exists() {
            return Err(format!("文件不存在: {}", file_path));
        }

        let metadata = std::fs::metadata(path).map_err(|e| format!("读取文件元数据失败: {}", e))?;

        if metadata.is_dir() {
            return Err(format!("'{}' 是一个目录，不能编辑", file_path));
        }

        // 4. 检查 .ipynb 文件
        if file_path.ends_with(".ipynb") {
            return Err(format!(
                "'{}' 是 Jupyter Notebook 文件，不支持编辑此格式",
                file_path
            ));
        }

        // 5. 读取文件（原始字节）
        let bytes = std::fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;

        // 6. 二进制检测：前 8KB 中是否有 null byte
        let check_len = bytes.len().min(8192);
        if bytes[..check_len].contains(&0x00) {
            return Err(format!("二进制文件: {}。仅支持文本文件编辑。", file_path));
        }

        // 7. UTF-8 解码
        let content_string = String::from_utf8(bytes)
            .map_err(|_| format!("文件不是有效的 UTF-8 编码: {}", file_path))?;

        // BOM 剥离（UTF-8 BOM: U+FEFF），记录是否含有 BOM 以便写回时保留
        let has_bom = content_string.starts_with('\u{feff}');
        let content: &str = content_string.trim_start_matches('\u{feff}');

        // 检测行尾风格（用于写回时保留原格式），并归一化到 \n
        let line_endings = detect_line_endings(&content_string);
        let content = content.replace("\r\n", "\n");

        // 查找 old_string 并验证
        let (match_pos, actual_old) =
            find_old_string_in_content(&content, old_string).ok_or_else(|| {
                format!(
                    "在文件 '{}' 中未找到指定的 old_string。\
                 请确认文件内容后重试。",
                    file_path
                )
            })?;

        // 检查匹配次数
        if !replace_all {
            let count = if actual_old == old_string {
                count_occurrences(&content, old_string)
            } else {
                // 如果用了引号归一化，按归一化后的计算
                let normalized_content = normalize_quotes(&content);
                count_occurrences(&normalized_content, &normalize_quotes(old_string))
            };

            if count > 1 {
                return Err(format!(
                    "old_string 在文件中出现了 {} 次。请提供更多上下文使匹配唯一，或设置 replace_all=true。",
                    count
                ));
            }
        }

        // 如果文件使用了弯引号，将 new_string 中的直引号也转为弯引号以保持风格一致
        let actual_new = preserve_quote_style(&actual_old, new_string);

        // 执行替换
        let new_content = if replace_all {
            content.replace(&actual_old, &actual_new)
        } else {
            // 只替换第一次出现
            let (before, after) = content.split_at(match_pos);
            let after_rest = &after[actual_old.len()..];
            format!("{}{}{}", before, actual_new, after_rest)
        };

        // 写回文件（保留原始 BOM 和行尾风格）
        let mut write_content = if line_endings == LineEnding::Crlf {
            new_content.replace('\n', "\r\n")
        } else {
            new_content
        };

        if has_bom {
            write_content.insert(0, '\u{feff}');
        }

        std::fs::write(path, write_content.as_bytes())
            .map_err(|e| format!("写入文件失败: {}", e))?;

        // 12. 返回结果
        let action = if replace_all {
            "全部替换"
        } else {
            "替换"
        };
        Ok(format!(
            "文件 '{}' 编辑完成（{} {} 处）",
            file_path,
            action,
            if replace_all { "所有匹配" } else { "1" }
        ))
    }
}

// ---------------------------------------------------------------------------
// Line ending detection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
enum LineEnding {
    Lf,
    Crlf,
}

/// 检测文件的行尾风格，读取前 4KB 的内容判断
fn detect_line_endings(content: &str) -> LineEnding {
    let check_len = content.len().min(4096);
    // 使用 floor_char_boundary 确保不切到 UTF-8 多字节字符中间
    let head = &content[..content.floor_char_boundary(check_len)];

    let mut crlf_count = 0usize;
    let mut lf_count = 0usize;
    let mut chars = head.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\r' && chars.peek() == Some(&'\n') {
            crlf_count += 1;
            chars.next(); // 跳过 \n，避免重复计数
        } else if c == '\n' {
            lf_count += 1;
        }
    }

    if crlf_count > lf_count {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    }
}

// ---------------------------------------------------------------------------
// Quote normalization
// ---------------------------------------------------------------------------

/// 将 curly quotes（smart quotes）替换为 straight quotes
///
/// 处理 Unicode 中的弯引号字符，使其与 ASCII 直引号匹配。
/// 这是为了解决 Claude 模型在生成 JSON 时可能输出弯引号的问题。
fn normalize_quotes(s: &str) -> String {
    s.replace(['\u{2018}', '\u{2019}'], "'") // LEFT and RIGHT SINGLE QUOTATION MARK
        .replace(['\u{201C}', '\u{201D}'], "\"") // LEFT and RIGHT DOUBLE QUOTATION MARK
}

/// 如果文件中使用了弯引号，将 new_string 中的直引号也转为弯引号以保持风格一致
///
/// 例如文件中的 old_string 是 `println!(‘hello’)`（弯引号），
/// 而 new_string 是 `println!(‘world’)`（弯引号）或 `println!('world')`（直引号），
/// 此函数会确保输出 `println!(‘world’)`（匹配文件的弯引号风格）。
fn preserve_quote_style(actual_old: &str, new_string: &str) -> String {
    // 检测 actual_old 中使用的引号类型
    let has_curly_single = actual_old.contains('\u{2018}') || actual_old.contains('\u{2019}');
    let has_curly_double = actual_old.contains('\u{201C}') || actual_old.contains('\u{201D}');

    let mut result = new_string.to_string();

    if has_curly_single {
        // 将直单引号转为弯单引号
        let left_single = result.replacen('\'', "\u{2018}", 1);
        // 替换剩余的单引号为右弯引号
        result = left_single.replacen('\'', "\u{2019}", 1);
        // 如果还有更多单引号，交替使用左右（处理嵌套情况）
        let mut is_left = true;
        while result.contains('\'') {
            result = if is_left {
                result.replacen('\'', "\u{2018}", 1)
            } else {
                result.replacen('\'', "\u{2019}", 1)
            };
            is_left = !is_left;
        }
    }

    if has_curly_double {
        let left_double = result.replacen('"', "\u{201C}", 1);
        result = left_double.replacen('"', "\u{201D}", 1);
        let mut is_left = true;
        while result.contains('"') {
            result = if is_left {
                result.replacen('"', "\u{201C}", 1)
            } else {
                result.replacen('"', "\u{201D}", 1)
            };
            is_left = !is_left;
        }
    }

    result
}

/// 先精确匹配 old_string，失败后做引号归一化再匹配
///
/// 返回 (匹配位置, 文件中实际的字符串)。
/// 匹配过程基于字符级别，避免因弯引号多字节编码导致的字节边界问题。
fn find_old_string_in_content(content: &str, old_string: &str) -> Option<(usize, String)> {
    // 1. 精确字节匹配（快速路径）
    if let Some(pos) = content.find(old_string) {
        return Some((pos, old_string.to_string()));
    }

    // 2. 字符级匹配：将 content 和 old_string 都做引号归一化后逐字符比较
    let content_chars: Vec<char> = content.chars().collect();
    let normalized_old: Vec<char> = normalize_quotes(old_string).chars().collect();

    if normalized_old.is_empty() || content_chars.len() < normalized_old.len() {
        return None;
    }

    for start in 0..=content_chars.len() - normalized_old.len() {
        let mut matched = true;
        for (i, &old_c) in normalized_old.iter().enumerate() {
            let c = content_chars[start + i];
            let norm_c = match c {
                '\u{2018}' | '\u{2019}' => '\'',
                '\u{201C}' | '\u{201D}' => '"',
                other => other,
            };
            if norm_c != old_c {
                matched = false;
                break;
            }
        }

        if matched {
            // 将 char 索引映射回字节位置
            let byte_pos: usize = content_chars[..start].iter().map(|c| c.len_utf8()).sum();
            let end_pos: usize = content_chars[..start + normalized_old.len()]
                .iter()
                .map(|c| c.len_utf8())
                .sum();
            let actual = content[byte_pos..end_pos].to_string();
            return Some((byte_pos, actual));
        }
    }

    None
}

/// 计算字符串中某个子串出现的次数
fn count_occurrences(content: &str, pattern: &str) -> usize {
    if pattern.is_empty() {
        return 0;
    }
    content.matches(pattern).count()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helpers ----

    fn make_editor() -> Edit {
        Edit::new(EditOptions {})
    }

    fn setup_temp_file(content: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.txt");
        std::fs::write(&file, content).unwrap();
        (dir, file)
    }

    fn execute_edit(
        file: &std::path::Path,
        old: &str,
        new: &str,
        replace_all: bool,
    ) -> Result<String, String> {
        let editor = make_editor();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
            "old_string": old,
            "new_string": new,
            "replace_all": replace_all,
        });
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(editor.execute(&input))
    }

    // ---- Tool definition tests ----

    #[test]
    fn test_tool_definition_name() {
        let tool = Edit::tool_definition();
        assert_eq!(tool.name, "edit");
    }

    #[test]
    fn test_tool_definition_has_description() {
        let tool = Edit::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_valid_schema() {
        let tool = Edit::tool_definition();
        let schema = tool.input_schema.unwrap();
        assert_eq!(schema["type"], "object");
        let props = schema["properties"].as_object().unwrap();
        assert!(props.contains_key("file_path"));
        assert!(props.contains_key("old_string"));
        assert!(props.contains_key("new_string"));
        assert!(props.contains_key("replace_all"));
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&serde_json::Value::String("file_path".to_string())));
        assert!(required.contains(&serde_json::Value::String("old_string".to_string())));
        assert!(required.contains(&serde_json::Value::String("new_string".to_string())));
        assert!(!required.contains(&serde_json::Value::String("replace_all".to_string())));
    }

    // ---- Execute success tests ----

    #[test]
    fn test_execute_basic_replace() {
        let (_dir, file) = setup_temp_file("Hello, world!");
        let result = execute_edit(&file, "world", "Rust", false).unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "Hello, Rust!");
    }

    #[test]
    fn test_execute_multiline_replace() {
        let (_dir, file) = setup_temp_file("line1\nline2\nline3\n");
        let result = execute_edit(&file, "line2", "modified", false).unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "line1\nmodified\nline3\n");
    }

    #[test]
    fn test_execute_replace_all() {
        let (_dir, file) = setup_temp_file("foo foo foo");
        let result = execute_edit(&file, "foo", "bar", true).unwrap();
        assert!(result.contains("编辑完成"));
        assert!(result.contains("所有匹配"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "bar bar bar");
    }

    #[test]
    fn test_execute_single_unique_replaces_first() {
        // 仅出现一次时，不设置 replace_all 也能正确替换
        let (_dir, file) = setup_temp_file("foo bar baz");
        let result = execute_edit(&file, "bar", "qux", false).unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "foo qux baz");
    }

    #[test]
    fn test_execute_empty_new_string() {
        let (_dir, file) = setup_temp_file("Hello, world!");
        let result = execute_edit(&file, ", world", "", false).unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "Hello!");
    }

    #[test]
    fn test_execute_chinese_content() {
        let (_dir, file) = setup_temp_file("你好，世界！");
        let result = execute_edit(&file, "世界", "Rust", false).unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "你好，Rust！");
    }

    #[test]
    fn test_execute_crlf_preserved() {
        let (_dir, file) = setup_temp_file("line1\r\nline2\r\nline3\r\n");
        let result = execute_edit(&file, "line2", "modified", false).unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        // 行尾风格应保留 CRLF
        assert!(content.contains("\r\n"));
        assert_eq!(content, "line1\r\nmodified\r\nline3\r\n");
    }

    #[test]
    fn test_execute_bom_preserved() {
        let (_dir, file) = setup_temp_file("\u{feff}hello\nworld\n");
        let result = execute_edit(&file, "hello", "hi", false).unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert!(content.starts_with('\u{feff}'));
        assert_eq!(content, "\u{feff}hi\nworld\n");
    }

    #[test]
    fn test_execute_adjacent_replacements() {
        // 替换后不产生冲突
        let (_dir, file) = setup_temp_file("aaa bbb ccc");
        let result = execute_edit(&file, "bbb", "bbb bbb", false).unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "aaa bbb bbb ccc");
    }

    // ---- Quote normalization tests ----

    #[test]
    fn test_execute_curly_quotes_single() {
        // 文件使用弯引号，模型提交的 old_string 使用直引号
        let content = "println!(\u{2018}hello\u{2019});";
        let (_dir, file) = setup_temp_file(content);
        let result = execute_edit(&file, "println!('hello');", "println!('hi');", false).unwrap();
        assert!(result.contains("编辑完成"));
        let new_content = std::fs::read_to_string(&file).unwrap();
        // 文件中应保留弯引号风格
        assert_eq!(new_content, "println!(\u{2018}hi\u{2019});");
    }

    #[test]
    fn test_execute_curly_quotes_double() {
        // 文件使用弯双引号，模型提交的 old_string 使用直双引号
        let content = "let s = \u{201C}hello\u{201D};";
        let (_dir, file) = setup_temp_file(content);
        let result = execute_edit(&file, "let s = \"hello\";", "let s = \"hey\";", false).unwrap();
        assert!(result.contains("编辑完成"));
        let new_content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(new_content, "let s = \u{201C}hey\u{201D};");
    }

    #[test]
    fn test_normalize_quotes_curly_to_straight() {
        let input = "\u{2018}a\u{2019} \u{201C}b\u{201D}";
        let result = normalize_quotes(input);
        assert_eq!(result, "'a' \"b\"");
    }

    #[test]
    fn test_normalize_quotes_no_change() {
        let input = "hello 'world' \"123\"";
        let result = normalize_quotes(input);
        assert_eq!(result, input);
    }

    // ---- Error tests ----

    #[test]
    fn test_execute_file_not_found() {
        let editor = make_editor();
        let input = serde_json::json!({
            "file_path": "/nonexistent/path/file.txt",
            "old_string": "foo",
            "new_string": "bar",
        });
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(editor.execute(&input));
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("不存在"));
    }

    #[test]
    fn test_execute_directory() {
        let dir = tempfile::tempdir().unwrap();
        let editor = make_editor();
        let input = serde_json::json!({
            "file_path": dir.path().to_string_lossy().to_string(),
            "old_string": "foo",
            "new_string": "bar",
        });
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(editor.execute(&input));
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("目录"));
    }

    #[test]
    fn test_execute_identical_strings() {
        let (_dir, file) = setup_temp_file("hello");
        let result = execute_edit(&file, "hello", "hello", false);
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("相同"));
    }

    #[test]
    fn test_execute_empty_old_string() {
        let (_dir, file) = setup_temp_file("hello");
        let result = execute_edit(&file, "", "bar", false);
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("不能为空"));
    }

    #[test]
    fn test_execute_string_not_found() {
        let (_dir, file) = setup_temp_file("hello world");
        let result = execute_edit(&file, "xyz", "bar", false);
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("未找到"));
    }

    #[test]
    fn test_execute_multiple_matches_fails_without_replace_all() {
        let (_dir, file) = setup_temp_file("foo foo foo");
        let result = execute_edit(&file, "foo", "bar", false);
        // 没有设置 replace_all 时多个匹配应报错
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(
            err.contains("3 次") || err.contains("多次"),
            "Error should mention multiple matches: {}",
            err
        );
    }

    #[test]
    fn test_execute_binary_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("binary.bin");
        std::fs::write(&file, &[0x00, 0x01, 0x02, 0x03]).unwrap();
        let result = execute_edit(&file, "foo", "bar", false);
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("二进制"));
    }

    #[test]
    fn test_execute_not_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("invalid.txt");
        // 使用没有 null byte 但也不是有效 UTF-8 的字节序列
        std::fs::write(&file, &[0xc3, 0x28]).unwrap();
        let result = execute_edit(&file, "foo", "bar", false);
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.contains("UTF-8"), "Error: {}", err);
    }

    #[test]
    fn test_execute_ipynb() {
        let (_dir, file) = setup_temp_file("{}");
        // 改名为 .ipynb
        let ipynb = file.parent().unwrap().join("test.ipynb");
        std::fs::rename(&file, &ipynb).unwrap();
        let result = execute_edit(&ipynb, "foo", "bar", false);
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("Notebook"));
    }

    #[test]
    fn test_execute_missing_file_path() {
        let editor = make_editor();
        let input = serde_json::json!({
            "old_string": "foo",
            "new_string": "bar",
        });
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(editor.execute(&input));
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("file_path"));
    }

    #[test]
    fn test_execute_missing_old_string() {
        let editor = make_editor();
        let input = serde_json::json!({
            "file_path": "/tmp/test.txt",
            "new_string": "bar",
        });
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(editor.execute(&input));
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("old_string"));
    }

    #[test]
    fn test_execute_missing_new_string() {
        let editor = make_editor();
        let input = serde_json::json!({
            "file_path": "/tmp/test.txt",
            "old_string": "foo",
        });
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(editor.execute(&input));
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("new_string"));
    }

    // ---- Line ending detection tests ----

    #[test]
    fn test_detect_lf() {
        assert_eq!(detect_line_endings("hello\nworld\n"), LineEnding::Lf);
    }

    #[test]
    fn test_detect_crlf() {
        assert_eq!(detect_line_endings("hello\r\nworld\r\n"), LineEnding::Crlf);
    }

    #[test]
    fn test_detect_mixed_prefers_crlf() {
        assert_eq!(detect_line_endings("a\r\nb\rc"), LineEnding::Crlf);
    }

    #[test]
    fn test_detect_empty() {
        assert_eq!(detect_line_endings(""), LineEnding::Lf);
    }

    #[test]
    fn test_detect_no_newlines() {
        assert_eq!(detect_line_endings("hello world"), LineEnding::Lf);
    }

    // ---- find_old_string_in_content tests ----

    #[test]
    fn test_find_exact_match() {
        let result = find_old_string_in_content("hello world", "world");
        assert_eq!(result, Some((6, "world".to_string())));
    }

    #[test]
    fn test_find_with_curly_quotes() {
        // 文件中是弯引号，old_string 是直引号
        let content = "println!(\u{2018}hello\u{2019})";
        let result = find_old_string_in_content(content, "println!('hello')");
        assert!(result.is_some());
        let (pos, actual) = result.unwrap();
        assert_eq!(pos, 0);
        // actual 应保留文件中的弯引号（3 字节每字符）
        assert_eq!(actual, "println!(\u{2018}hello\u{2019})");
        // 验证字节长度正确（弯引号各 3 字节）
        assert_eq!(
            actual.len(),
            "println!(".len() + 3 + "hello".len() + 3 + ")".len()
        );
    }

    #[test]
    fn test_find_no_match() {
        let result = find_old_string_in_content("hello world", "xyz");
        assert_eq!(result, None);
    }

    #[test]
    fn test_find_empty_content() {
        let result = find_old_string_in_content("", "hello");
        assert_eq!(result, None);
    }

    // ---- count_occurrences tests ----

    #[test]
    fn test_count_occurrences_basic() {
        assert_eq!(count_occurrences("foo foo foo", "foo"), 3);
    }

    #[test]
    fn test_count_occurrences_no_match() {
        assert_eq!(count_occurrences("hello", "xyz"), 0);
    }

    #[test]
    fn test_count_occurrences_empty_pattern() {
        assert_eq!(count_occurrences("hello", ""), 0);
    }

    #[test]
    fn test_count_occurrences_overlapping() {
        // Rust 的 matches 不会重叠匹配
        assert_eq!(count_occurrences("aaaa", "aa"), 2);
    }

    // ---- Options tests ----

    #[test]
    fn test_default_options() {
        let options = EditOptions::default();
        assert_eq!(options, EditOptions {});
    }

    #[test]
    fn test_new() {
        let editor = Edit::new(EditOptions {});
        assert_eq!(editor.options, EditOptions {});
    }

    // ---- Replace after adjacent edit test ----

    #[test]
    fn test_execute_replace_partial_content() {
        let (_dir, file) = setup_temp_file("function hello() {\n    return 1;\n}");
        let result = execute_edit(&file, "return 1;", "return 42;", false).unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "function hello() {\n    return 42;\n}");
    }
}
