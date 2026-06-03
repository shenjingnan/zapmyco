// FileEdit 工具 — 使用 old_string/new_string 模式精确替换文件内容
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

/// FileEdit 配置选项
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FileEditOptions {}

// ---------------------------------------------------------------------------
// Core struct
// ---------------------------------------------------------------------------

/// FileEdit 工具 — 使用 old_string/new_string 模式精确替换文件内容
#[derive(Debug, Clone)]
pub struct FileEdit {
    options: FileEditOptions,
}

impl FileEdit {
    /// 创建新的 FileEdit 实例
    pub fn new(options: FileEditOptions) -> Self {
        Self { options }
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "file_edit".to_string(),
            description: Some(
                "修改本地文件系统中的文件内容。支持多种编辑模式：\n\
                 1. line_range（推荐）: 按行号替换，需指定 start_line/end_line/expected/new_content，\
                 系统会自动验证 expected 是否与文件实际内容一致，比 old_string 更稳定可靠。\n\
                 2. append: 在文件末尾追加内容，需指定 content。\n\
                 3. old_string/new_string（旧模式）: 精确字符串替换，保留以兼容旧版。\n\n\
                 注意：line_range 模式的 expected 参数至少包含 3 行非空代码行（trim 后），\
                 否则会被拒绝执行。编辑前必须先使用 file_read 读取文件内容。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "要修改的文件的绝对路径"
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["line_range", "append"],
                        "description": "编辑模式，默认根据其他参数自动判断"
                    },
                    "start_line": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "要替换的起始行号（从1开始，仅 line_range 模式）"
                    },
                    "end_line": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "要替换的结束行号（包含，仅 line_range 模式）"
                    },
                    "expected": {
                        "type": "string",
                        "description": "预期的当前内容（仅 line_range 模式）。\
                         用于验证行号是否准确，至少包含3行非空代码行（trim后）。\
                         如果内容不匹配将被拒绝执行"
                    },
                    "new_content": {
                        "type": "string",
                        "description": "替换后的新内容（仅 line_range 模式）"
                    },
                    "content": {
                        "type": "string",
                        "description": "要追加的内容（仅 append 模式）"
                    },
                    "old_string": {
                        "type": "string",
                        "description": "（旧模式）要被替换的文本，必须在文件中精确匹配"
                    },
                    "new_string": {
                        "type": "string",
                        "description": "（旧模式）替换后的文本（必须与 old_string 不同）"
                    },
                    "replace_all": {
                        "type": "boolean",
                        "description": "（旧模式）是否替换所有匹配项（默认 false）",
                        "default": false
                    }
                },
                "required": ["file_path"]
            })),
            ..Default::default()
        }
    }

    /// 执行文件编辑
    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        // 0. 路由到正确的编辑模式
        //    优先级: edits(批量) > mode(显式) > start_line(行号) > old_string(旧模式)
        let file_path = input
            .get("file_path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'file_path'".to_string())?;

        // 模式1: 批量编辑 (edits 数组)
        if input.get("edits").and_then(|v| v.as_array()).is_some() {
            return self.execute_batch(file_path, input).await;
        }

        // 模式2: 显式 mode 参数
        if let Some(mode) = input.get("mode").and_then(|v| v.as_str()) {
            return match mode {
                "append" => self.execute_append(file_path, input).await,
                "line_range" => self.execute_line_range(file_path, input).await,
                _ => Err(format!("不支持的编辑模式: '{}'", mode)),
            };
        }

        // 模式3: 行号模式 (自动检测 start_line 参数)
        if input.get("start_line").and_then(|v| v.as_u64()).is_some() {
            return self.execute_line_range(file_path, input).await;
        }

        // 模式4: 旧模式 (old_string/new_string) — 保留以兼容
        self.execute_legacy(file_path, input).await
    }

    // ========================================================================
    // 行号替换模式 (line_range)
    // ========================================================================

    async fn execute_line_range(
        &self,
        file_path: &str,
        input: &serde_json::Value,
    ) -> Result<String, String> {
        let start_line = input
            .get("start_line")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| "缺少必填参数 'start_line'".to_string())?
            as usize;

        let end_line = input
            .get("end_line")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| "缺少必填参数 'end_line'".to_string())? as usize;

        let expected = input
            .get("expected")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'expected'".to_string())?;

        let new_content = input
            .get("new_content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'new_content'".to_string())?;

        // 路径校验
        let path = std::path::Path::new(file_path);
        if !path.exists() {
            return Err(format!("文件不存在: {}", file_path));
        }
        let metadata = std::fs::metadata(path).map_err(|e| format!("读取文件元数据失败: {}", e))?;
        if metadata.is_dir() {
            return Err(format!("'{}' 是一个目录，不能编辑", file_path));
        }

        // 读取文件
        let bytes = std::fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;
        let check_len = bytes.len().min(8192);
        if bytes[..check_len].contains(&0x00) {
            return Err(format!("二进制文件: {}。仅支持文本文件编辑。", file_path));
        }
        let content_string = String::from_utf8(bytes)
            .map_err(|_| format!("文件不是有效的 UTF-8 编码: {}", file_path))?;

        let has_bom = content_string.starts_with('\u{feff}');
        let content: &str = content_string.trim_start_matches('\u{feff}');
        let line_endings = detect_line_endings(&content_string);
        let content = content.replace("\r\n", "\n");

        // 行号校验
        let lines: Vec<&str> = content.lines().collect();
        let total_lines = lines.len();

        if total_lines == 0 {
            return Err("文件为空，无法编辑".to_string());
        }
        if start_line < 1 || end_line > total_lines || start_line > end_line {
            return Err(format!(
                "行号超出范围：start_line={}, end_line={}，文件共 {} 行",
                start_line, end_line, total_lines
            ));
        }

        // 提取实际内容进行验证
        let actual_lines: Vec<&str> = lines[start_line - 1..end_line].to_vec();
        let actual_content = actual_lines.join("\n");

        // 内容验证
        if validate_content(expected, &actual_content) == Confidence::Low {
            // 构建详细的拒绝信息，帮助 LLM 理解差异
            let exp_set: std::collections::HashSet<&str> = expected
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect();
            let act_set: std::collections::HashSet<&str> = actual_lines
                .iter()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect();

            let missing: Vec<&str> = exp_set.difference(&act_set).copied().collect();

            let mut detail = format!(
                "内容验证不通过：文件 '{}' 的第 {}-{} 行的实际内容与 expected 描述不一致。",
                file_path, start_line, end_line
            );
            if !missing.is_empty() {
                detail.push_str(&format!(
                    "\nexpected 中有 {} 行未在文件中找到:\n",
                    missing.len()
                ));
                for line in &missing {
                    detail.push_str(&format!("  - '{}'\n", line));
                }
            }
            detail.push_str(&format!(
                "\n当前第 {}-{} 行的实际内容是:\n",
                start_line, end_line
            ));
            for (i, line) in actual_lines.iter().enumerate() {
                detail.push_str(&format!("  {} | {}\n", start_line + i, line));
            }
            detail.push_str("\n建议：请使用 file_read 重新读取文件确认当前内容后重试。");

            return Err(detail);
        }

        // 执行替换：取 start_line-1 之前的行 + new_content + end_line 之后的行
        let before = &lines[..start_line - 1];
        let after = &lines[end_line..];

        let mut new_lines: Vec<&str> = Vec::with_capacity(before.len() + after.len() + 1);
        new_lines.extend_from_slice(before);
        // new_content 可能有多行，逐行追加
        for line in new_content.lines() {
            new_lines.push(line);
        }
        new_lines.extend_from_slice(after);

        let mut new_output = new_lines.join("\n");
        new_output.push('\n'); // 保留 trailing newline

        // 写回文件
        let mut write_content = if line_endings == LineEnding::Crlf {
            new_output.replace('\n', "\r\n")
        } else {
            new_output
        };
        if has_bom {
            write_content.insert(0, '\u{feff}');
        }
        std::fs::write(path, write_content.as_bytes())
            .map_err(|e| format!("写入文件失败: {}", e))?;

        // 构建结果
        let old_lines_count = end_line - start_line + 1;
        let new_lines_count = new_content.lines().count();
        let line_shift = new_lines_count as isize - old_lines_count as isize;

        let diff = build_diff(&actual_content, new_content);
        let shift_desc = if line_shift > 0 {
            format!("（+{} 行）", line_shift)
        } else if line_shift < 0 {
            format!("（{} 行）", line_shift)
        } else {
            String::new()
        };

        Ok(format!(
            "文件 '{}' 编辑完成：替换 {}-{} 行（共 {} 行）→ 共 {} 行{}\n\n\
             diff:\n{}",
            file_path, start_line, end_line, old_lines_count, new_lines_count, shift_desc, diff,
        ))
    }

    // ========================================================================
    // 追加模式 (append)
    // ========================================================================

    async fn execute_append(
        &self,
        file_path: &str,
        input: &serde_json::Value,
    ) -> Result<String, String> {
        let content = input
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少必填参数 'content'".to_string())?;

        let path = std::path::Path::new(file_path);
        if !path.exists() {
            return Err(format!("文件不存在: {}", file_path));
        }

        let bytes = std::fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;
        let check_len = bytes.len().min(8192);
        if bytes[..check_len].contains(&0x00) {
            return Err(format!("二进制文件: {}。仅支持文本文件编辑。", file_path));
        }
        let content_string = String::from_utf8(bytes)
            .map_err(|_| format!("文件不是有效的 UTF-8 编码: {}", file_path))?;

        let has_bom = content_string.starts_with('\u{feff}');
        let text: &str = content_string.trim_start_matches('\u{feff}');
        let line_endings = detect_line_endings(&content_string);
        let text = text.replace("\r\n", "\n");

        let new_output = if text.is_empty() {
            content.to_string()
        } else if text.ends_with('\n') {
            format!("{}{}", text, content)
        } else {
            format!("{}\n{}", text, content)
        };

        let mut write_content = if line_endings == LineEnding::Crlf {
            new_output.replace('\n', "\r\n")
        } else {
            new_output
        };
        if has_bom {
            write_content.insert(0, '\u{feff}');
        }
        std::fs::write(path, write_content.as_bytes())
            .map_err(|e| format!("写入文件失败: {}", e))?;

        Ok(format!(
            "文件 '{}' 追加完成：在文件末尾添加了 {} 行内容。",
            file_path,
            content.lines().count(),
        ))
    }

    // ========================================================================
    // 批量编辑模式 (edits)
    // ========================================================================

    async fn execute_batch(
        &self,
        file_path: &str,
        input: &serde_json::Value,
    ) -> Result<String, String> {
        let edits = input
            .get("edits")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "缺少 'edits' 数组参数".to_string())?;

        if edits.is_empty() {
            return Err("edits 数组为空".to_string());
        }

        // 读取文件
        let path = std::path::Path::new(file_path);
        if !path.exists() {
            return Err(format!("文件不存在: {}", file_path));
        }
        let bytes = std::fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;
        let check_len = bytes.len().min(8192);
        if bytes[..check_len].contains(&0x00) {
            return Err(format!("二进制文件: {}。仅支持文本文件编辑。", file_path));
        }
        let content_string = String::from_utf8(bytes)
            .map_err(|_| format!("文件不是有效的 UTF-8 编码: {}", file_path))?;

        let has_bom = content_string.starts_with('\u{feff}');
        let content: &str = content_string.trim_start_matches('\u{feff}');
        let line_endings = detect_line_endings(&content_string);
        let content = content.replace("\r\n", "\n");

        let lines: Vec<&str> = content.lines().collect();
        let total_lines = lines.len();

        // 解析所有编辑
        struct EditItem {
            start_line: usize,
            end_line: usize,
            expected: String,
            new_content: String,
        }

        let mut items: Vec<EditItem> = Vec::new();
        for (i, edit) in edits.iter().enumerate() {
            let sl = edit
                .get("start_line")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| format!("edits[{}] 缺少 'start_line' 参数", i))?
                as usize;
            let el = edit
                .get("end_line")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| format!("edits[{}] 缺少 'end_line' 参数", i))?
                as usize;
            let exp = edit
                .get("expected")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("edits[{}] 缺少 'expected' 参数", i))?;
            let nc = edit
                .get("new_content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("edits[{}] 缺少 'new_content' 参数", i))?;

            if sl < 1 || el > total_lines || sl > el {
                return Err(format!(
                    "edits[{}] 行号超出范围：start_line={}, end_line={}，文件共 {} 行",
                    i, sl, el, total_lines
                ));
            }

            items.push(EditItem {
                start_line: sl,
                end_line: el,
                expected: exp.to_string(),
                new_content: nc.to_string(),
            });
        }

        // 检测重叠：按 start_line 排序后检查是否有重叠
        items.sort_by_key(|e| e.start_line);
        for i in 1..items.len() {
            if items[i - 1].end_line >= items[i].start_line {
                return Err(format!(
                    "批量编辑范围重叠：edits[{}] ({}-{}) 与 edits[{}] ({}-{}) 重叠，请合并后重试",
                    i - 1,
                    items[i - 1].start_line,
                    items[i - 1].end_line,
                    i,
                    items[i].start_line,
                    items[i].end_line,
                ));
            }
        }

        // 全部验证通过后，按 start_line 降序排列（从下到上执行）
        items.sort_by_key(|b| std::cmp::Reverse(b.start_line));

        // 在内存中执行所有编辑
        let mut current_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();

        for item in &items {
            // 验证
            let actual_lines: Vec<&str> = current_lines[item.start_line - 1..item.end_line]
                .iter()
                .map(|s| s.as_str())
                .collect();
            let actual_content = actual_lines.join("\n");

            if validate_content(&item.expected, &actual_content) == Confidence::Low {
                return Err(format!(
                    "批量编辑中 edits[{}] 内容验证不通过：\
                     第 {}-{} 行的实际内容与 expected 描述不一致。\
                     请使用 file_read 确认当前文件内容。",
                    edits
                        .iter()
                        .position(|e| {
                            e.get("start_line").and_then(|v| v.as_u64())
                                == Some(item.start_line as u64)
                                && e.get("end_line").and_then(|v| v.as_u64())
                                    == Some(item.end_line as u64)
                        })
                        .unwrap_or(0),
                    item.start_line,
                    item.end_line,
                ));
            }

            // 替换
            let before = &current_lines[..item.start_line - 1];
            let after = &current_lines[item.end_line..];
            let mut new_lines: Vec<String> = Vec::new();
            new_lines.extend(before.iter().cloned());
            for line in item.new_content.lines() {
                new_lines.push(line.to_string());
            }
            new_lines.extend(after.iter().cloned());
            current_lines = new_lines;
        }

        // 一次写回
        let mut new_output = current_lines.join("\n");
        new_output.push('\n'); // 保留 trailing newline
        let mut write_content = if line_endings == LineEnding::Crlf {
            new_output.replace('\n', "\r\n")
        } else {
            new_output
        };
        if has_bom {
            write_content.insert(0, '\u{feff}');
        }
        std::fs::write(path, write_content.as_bytes())
            .map_err(|e| format!("写入文件失败: {}", e))?;

        Ok(format!(
            "文件 '{}' 批量编辑完成：{} 个编辑已全部执行",
            file_path,
            items.len(),
        ))
    }

    // ========================================================================
    // 旧模式 (old_string/new_string)
    // ========================================================================

    async fn execute_legacy(
        &self,
        file_path: &str,
        input: &serde_json::Value,
    ) -> Result<String, String> {
        let old_string = input
            .get("old_string")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少 'old_string' 或 'start_line' 参数，请使用 old_string/new_string 或 line_range 模式".to_string())?;

        let new_string = input
            .get("new_string")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少 'new_string' 或 'new_content' 参数".to_string())?;

        let replace_all = input
            .get("replace_all")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if old_string == new_string {
            return Err("old_string 和 new_string 相同，没有需要修改的内容".to_string());
        }
        if old_string.is_empty() {
            return Err("old_string 不能为空".to_string());
        }

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
// Content validation (line-range mode)
// ---------------------------------------------------------------------------

/// 内容验证结果
#[derive(Debug, Clone, Copy, PartialEq)]
enum Confidence {
    High,
    Low,
}

/// 验证 LLM 对指定行号范围的描述是否与实际内容匹配
///
/// # 安全规则
/// - expected 必须包含至少 3 行非空内容（trim 后），否则判别力不足
/// - 每一行非空内容（trim 后）都必须在 actual 中出现（set 匹配，顺序不敏感）
/// - 不要求 actual 中额外行也出现在 expected 中
///
/// # 设计原则
/// - 保守拒绝：宁可拒绝也不要静默放行错误位置
/// - 简单可预测：无百分比模糊，无多层计算
/// - 语言无关：trim 消除缩进差异，set 匹配消除顺序依赖
fn validate_content(expected: &str, actual: &str) -> Confidence {
    // 对 expected 和 actual 都做引号归一化，消除 LLM 输出弯引号导致的误拒
    let normalized_expected = normalize_quotes(expected);
    let normalized_actual = normalize_quotes(actual);

    let exp_lines: Vec<&str> = normalized_expected
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    // 最少 3 行非空内容，否则判别力不足
    if exp_lines.len() < 3 {
        return Confidence::Low;
    }

    // 最短行字符数检查：如果任何行短于 3 个字符，需要至少 4 行
    // 避免 "}", "}" "}" 这种 3 行短行被放行
    let has_very_short = exp_lines.iter().any(|l| l.len() < 3);
    if has_very_short && exp_lines.len() < 4 {
        return Confidence::Low;
    }

    // 所有 expected 行（trim + normalize 后）必须在 actual（同样 normalize）中出现
    let act_set: std::collections::HashSet<&str> = normalized_actual
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    if exp_lines.iter().all(|l| act_set.contains(l)) {
        Confidence::High
    } else {
        Confidence::Low
    }
}

// ---------------------------------------------------------------------------
// Diff builder
// ---------------------------------------------------------------------------

/// 构建简单的 unified diff 文本用于返回结果
///
/// 格式:
/// ```text
/// - old_line1
/// - old_line2
/// + new_line1
/// + new_line2
/// ```
fn build_diff(old_content: &str, new_content: &str) -> String {
    let old_lines: Vec<&str> = old_content.lines().collect();
    let new_lines: Vec<&str> = new_content.lines().collect();
    let mut result = String::new();

    // 简单的逐行 diff：旧行标 -，新行标 +
    let max_len = old_lines.len().max(new_lines.len());
    for i in 0..max_len {
        if i < old_lines.len() && i < new_lines.len() {
            if old_lines[i] != new_lines[i] {
                result.push_str(&format!("- {}\n", old_lines[i]));
                result.push_str(&format!("+ {}\n", new_lines[i]));
            } else {
                // 显示不变的行的缩略版本作为上下文
                let line = old_lines[i];
                if line.len() > 60 {
                    result.push_str(&format!("  {}...\n", &line[..60]));
                } else {
                    result.push_str(&format!("  {}\n", line));
                }
            }
        } else if i < old_lines.len() {
            // 只有旧行（被删除）
            result.push_str(&format!("- {}\n", old_lines[i]));
        } else {
            // 只有新行（被添加）
            result.push_str(&format!("+ {}\n", new_lines[i]));
        }
    }

    result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helpers ----

    fn make_editor() -> FileEdit {
        FileEdit::new(FileEditOptions {})
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

    fn execute_line_range(
        file: &std::path::Path,
        start: u64,
        end: u64,
        expected: &str,
        new_content: &str,
    ) -> Result<String, String> {
        let editor = make_editor();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
            "start_line": start,
            "end_line": end,
            "expected": expected,
            "new_content": new_content,
        });
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(editor.execute(&input))
    }

    fn execute_append(file: &std::path::Path, content: &str) -> Result<String, String> {
        let editor = make_editor();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
            "mode": "append",
            "content": content,
        });
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(editor.execute(&input))
    }

    fn execute_batch(file: &std::path::Path, edits: serde_json::Value) -> Result<String, String> {
        let editor = make_editor();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
            "edits": edits,
        });
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(editor.execute(&input))
    }

    // ---- Line range tests ----

    #[test]
    fn test_tool_definition_name() {
        let tool = FileEdit::tool_definition();
        assert_eq!(tool.name, "file_edit");
    }

    #[test]
    fn test_tool_definition_has_description() {
        let tool = FileEdit::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_valid_schema() {
        let tool = FileEdit::tool_definition();
        let schema = tool.input_schema.unwrap();
        assert_eq!(schema["type"], "object");
        let props = schema["properties"].as_object().unwrap();
        assert!(props.contains_key("file_path"));
        assert!(props.contains_key("start_line"));
        assert!(props.contains_key("end_line"));
        assert!(props.contains_key("expected"));
        assert!(props.contains_key("new_content"));
        assert!(props.contains_key("mode"));
        assert!(props.contains_key("content"));
        assert!(props.contains_key("old_string"));
        assert!(props.contains_key("new_string"));
        assert!(props.contains_key("replace_all"));
        let required = schema["required"].as_array().unwrap();
        assert_eq!(required.len(), 1);
        assert!(required.contains(&serde_json::Value::String("file_path".to_string())));
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

    // ---- Line range tests (integration) ----

    #[test]
    fn test_line_range_basic() {
        let (_dir, file) =
            setup_temp_file("let a = 1;\nlet b = 2;\nlet c = 3;\nlet d = 4;\nlet e = 5;\n");
        let result = execute_line_range(
            &file,
            2,
            4,
            "let b = 2;\nlet c = 3;\nlet d = 4;",
            "let x = 10;\nlet y = 20;",
        )
        .unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(
            content,
            "let a = 1;\nlet x = 10;\nlet y = 20;\nlet e = 5;\n"
        );
    }

    #[test]
    fn test_line_range_shrink() {
        let (_dir, file) = setup_temp_file("line_a\nline_b\nline_c\nline_d\nline_e\n");
        let result = execute_line_range(&file, 2, 4, "line_b\nline_c\nline_d", "line_X").unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "line_a\nline_X\nline_e\n");
    }

    #[test]
    fn test_line_range_expand() {
        let (_dir, file) = setup_temp_file("line_aa\nline_bb\nline_cc\nline_dd\nline_ee\n");
        let result = execute_line_range(
            &file,
            2,
            4,
            "line_bb\nline_cc\nline_dd",
            "new_1\nnew_2\nnew_3\nnew_4",
        )
        .unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "line_aa\nnew_1\nnew_2\nnew_3\nnew_4\nline_ee\n");
    }

    #[test]
    fn test_line_range_first_line() {
        let (_dir, file) = setup_temp_file("row1_cnt\nrow2_cnt\nrow3_cnt\nrow4_cnt\n");
        let result =
            execute_line_range(&file, 1, 3, "row1_cnt\nrow2_cnt\nrow3_cnt", "new_row1").unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "new_row1\nrow4_cnt\n");
    }

    #[test]
    fn test_line_range_last_line() {
        let (_dir, file) = setup_temp_file("rowA_cnt\nrowB_cnt\nrowC_cnt\nrowD_cnt\n");
        let result =
            execute_line_range(&file, 2, 4, "rowB_cnt\nrowC_cnt\nrowD_cnt", "last_row").unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "rowA_cnt\nlast_row\n");
    }

    #[test]
    fn test_line_range_invalid_range() {
        let (_dir, file) = setup_temp_file("aaa\nbbb\nccc\n");
        let result = execute_line_range(&file, 3, 2, "aaa\nbbb\nccc", "x");
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("超出范围"));
    }

    #[test]
    fn test_line_range_out_of_bounds() {
        let (_dir, file) = setup_temp_file("aaa\nbbb\n");
        let result = execute_line_range(&file, 1, 10, "aaa\nbbb\nccc", "x");
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("超出范围"));
    }

    #[test]
    fn test_line_range_content_mismatch() {
        let (_dir, file) = setup_temp_file("alpha_val\nbeta_val\ngamma_val\ndelta_val\n");
        let result = execute_line_range(&file, 1, 3, "foobar\nbazqux\nxyzzzz", "new");
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.contains("验证不通过") || err.contains("不一致"));
    }

    #[test]
    fn test_line_range_missing_expected() {
        // expected 不足 3 行（仅 1 行）→ 拒绝
        let (_dir, file) = setup_temp_file("aaaa\nbbbb\ncccc\ndddd\n");
        let editor = make_editor();
        let input = serde_json::json!({
            "file_path": file.to_string_lossy().to_string(),
            "start_line": 1,
            "end_line": 3,
            "expected": "aaaa",
            "new_content": "xyz",
        });
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(editor.execute(&input));
        assert!(result.is_err());
    }

    #[test]
    fn test_line_range_crlf_preserved() {
        let (_dir, file) = setup_temp_file("aaa\r\nbbb\r\nccc\r\nddd\r\n");
        let result = execute_line_range(&file, 2, 4, "bbb\nccc\nddd", "XXX\nYYY").unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert!(content.contains("\r\n"));
        assert_eq!(content, "aaa\r\nXXX\r\nYYY\r\n");
    }

    #[test]
    fn test_line_range_bom_preserved() {
        let (_dir, file) = setup_temp_file("\u{feff}aaa\nbbb\nccc\nddd\n");
        let result = execute_line_range(&file, 2, 4, "bbb\nccc\nddd", "BBB\nCCC").unwrap();
        assert!(result.contains("编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert!(content.starts_with('\u{feff}'));
        assert_eq!(content, "\u{feff}aaa\nBBB\nCCC\n");
    }

    #[test]
    fn test_line_range_binary_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("binary.bin");
        std::fs::write(&file, &[0x00, 0x01, 0x02]).unwrap();
        let result = execute_line_range(&file, 1, 1, "foobar\nbazqux\nxyzzzz", "new");
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("二进制"));
    }

    // ---- Append tests ----

    #[test]
    fn test_append_basic() {
        let (_dir, file) = setup_temp_file("line1\nline2\n");
        let result = execute_append(&file, "line3\nline4\n").unwrap();
        assert!(result.contains("追加完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "line1\nline2\nline3\nline4\n");
    }

    #[test]
    fn test_append_empty_file() {
        let (_dir, file) = setup_temp_file("");
        let result = execute_append(&file, "new content\n").unwrap();
        assert!(result.contains("追加完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "new content\n");
    }

    #[test]
    fn test_append_no_trailing_newline() {
        let (_dir, file) = setup_temp_file("line1");
        let result = execute_append(&file, "line2\n").unwrap();
        assert!(result.contains("追加完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "line1\nline2\n");
    }

    #[test]
    fn test_append_binary_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("binary.bin");
        std::fs::write(&file, &[0x00, 0x01, 0x02]).unwrap();
        let result = execute_append(&file, "new");
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("二进制"));
    }

    // ---- Batch tests ----

    #[test]
    fn test_batch_two_edits_no_overlap() {
        let (_dir, file) =
            setup_temp_file("line_aaa\nline_bbb\nline_ccc\nline_ddd\nline_eee\nline_fff\n");
        let edits = serde_json::json!([
            {"start_line": 2, "end_line": 4, "expected": "line_bbb\nline_ccc\nline_ddd", "new_content": "line_BB\nline_CC"},
            {"start_line": 5, "end_line": 6, "expected": "line_eee\nline_fff\nline_aaa", "new_content": "line_EE"},
        ]);
        let result = execute_batch(&file, edits);
        assert!(
            result.is_err(),
            "batch should fail: line_aaa not in lines 5-6"
        );
    }

    #[test]
    fn test_batch_edits_descending_order() {
        let (_dir, file) =
            setup_temp_file("row_aaa\nrow_bbb\nrow_ccc\nrow_ddd\nrow_eee\nrow_fff\nrow_ggg\n");
        let edits = serde_json::json!([
            {"start_line": 5, "end_line": 7, "expected": "row_eee\nrow_fff\nrow_ggg", "new_content": "row_EE\nrow_FF"},
            {"start_line": 2, "end_line": 4, "expected": "row_bbb\nrow_ccc\nrow_ddd", "new_content": "row_BB\nrow_CC"},
        ]);
        let result = execute_batch(&file, edits).unwrap();
        assert!(result.contains("批量编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "row_aaa\nrow_BB\nrow_CC\nrow_EE\nrow_FF\n");
    }

    #[test]
    fn test_batch_edits_overlap_rejected() {
        let (_dir, file) = setup_temp_file("line_a\nline_b\nline_c\nline_d\n");
        let edits = serde_json::json!([
            {"start_line": 1, "end_line": 3, "expected": "line_a\nline_b\nline_c", "new_content": "X"},
            {"start_line": 2, "end_line": 4, "expected": "line_b\nline_c\nline_d", "new_content": "Y"},
        ]);
        let result = execute_batch(&file, edits);
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("重叠"));
    }

    #[test]
    fn test_batch_single_edit() {
        let (_dir, file) = setup_temp_file("one\ntwo\nthree\nfour\nfive\n");
        let edits = serde_json::json!([
            {"start_line": 2, "end_line": 4, "expected": "two\nthree\nfour", "new_content": "TWO\nTHREE"},
        ]);
        let result = execute_batch(&file, edits).unwrap();
        assert!(result.contains("批量编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "one\nTWO\nTHREE\nfive\n");
    }

    #[test]
    fn test_batch_empty_edits_rejected() {
        let (_dir, file) = setup_temp_file("a\nb\nc\n");
        let result = execute_batch(&file, serde_json::json!([]));
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("为空"));
    }

    #[test]
    fn test_batch_after_edit_expands_lines() {
        // 下面的编辑增加行后，不影响上面编辑（降序执行解决）
        let (_dir, file) = setup_temp_file("line_1\nline_2\nline_3\nline_4\nline_5\nline_6\n");
        let edits = serde_json::json!([
            {"start_line": 4, "end_line": 6, "expected": "line_4\nline_5\nline_6", "new_content": "line_FOUR\nline_FIVE\nline_SIX"},
            {"start_line": 1, "end_line": 3, "expected": "line_1\nline_2\nline_3", "new_content": "line_ONE\nline_TWO\nline_THREE"},
        ]);
        let result = execute_batch(&file, edits).unwrap();
        assert!(result.contains("批量编辑完成"));
        let content = std::fs::read_to_string(&file).unwrap();
        // 降序执行：先 4-6, 再 1-3
        // 如果顺序错误（先执行 1-3），line_4/5/6 会偏移到行号之外，找不到
        assert_eq!(
            content,
            "line_ONE\nline_TWO\nline_THREE\nline_FOUR\nline_FIVE\nline_SIX\n"
        );
    }

    // ---- validate_content tests ----

    #[test]
    fn test_validate_exact_match() {
        // 3 行完全一致
        assert_eq!(
            validate_content(
                "let x = 1;\nlet y = 2;\nlet z = 3;",
                "let x = 1;\nlet y = 2;\nlet z = 3;"
            ),
            Confidence::High
        );
    }

    #[test]
    fn test_validate_indent_difference() {
        // 缩进不同，trim 后相同
        assert_eq!(
            validate_content(
                "  let x = 1;\n  let y = 2;\n  let z = 3;",
                "    let x = 1;\n    let y = 2;\n    let z = 3;"
            ),
            Confidence::High
        );
    }

    #[test]
    fn test_validate_one_line_different() {
        // 3 行中 1 行不同
        assert_eq!(
            validate_content(
                "let x = 1;\nlet y = 2;\nlet z = 3;",
                "let x = 1;\nlet y = 999;\nlet z = 3;"
            ),
            Confidence::Low
        );
    }

    #[test]
    fn test_validate_completely_different() {
        // 完全无关
        assert_eq!(
            validate_content(
                "let x = 1;\nlet y = 2;\nlet z = 3;",
                "fn foo() {\n    bar()\n}"
            ),
            Confidence::Low
        );
    }

    #[test]
    fn test_validate_less_than_3_lines() {
        // 不足 3 行
        assert_eq!(
            validate_content("let x = 1;\nlet y = 2;", "let x = 1;\nlet y = 2;"),
            Confidence::Low
        );
    }

    #[test]
    fn test_validate_less_than_3_with_empty_lines() {
        // 含空行，过滤后不足 3 行
        assert_eq!(
            validate_content("let x = 1;\n\nlet y = 2;", "let x = 1;\n\nlet y = 2;"),
            Confidence::Low
        );
    }

    #[test]
    fn test_validate_short_lines_3_only() {
        // 3 行短行，因短行规则需要至少 4 行
        assert_eq!(validate_content("x\n}\ny", "x\n}\ny"), Confidence::Low);
    }

    #[test]
    fn test_validate_actual_has_extra_lines() {
        // 实际多出内容（注释行等）
        assert_eq!(
            validate_content(
                "let x = 1;\nlet y = 2;\nreturn x;",
                "let x = 1;\nlet y = 2;\n// debug\nreturn x;"
            ),
            Confidence::High
        );
    }

    #[test]
    fn test_validate_order_different() {
        // 顺序不同（set 匹配）
        assert_eq!(
            validate_content(
                "let y = 2;\nlet z = 3;\nlet x = 1;",
                "let x = 1;\nlet y = 2;\nlet z = 3;"
            ),
            Confidence::High
        );
    }

    #[test]
    fn test_validate_duplicate_lines() {
        // 重复行
        assert_eq!(
            validate_content("}\n}\n}\n}", "}\n}\n}\n}"),
            Confidence::High
        );
    }

    #[test]
    fn test_validate_empty_content() {
        // 空内容
        assert_eq!(validate_content("", "anything"), Confidence::Low);
        assert_eq!(validate_content("anything", ""), Confidence::Low);
    }

    #[test]
    fn test_validate_rust_struct() {
        // Rust 结构体（不同语言验证）
        assert_eq!(
            validate_content(
                "struct User {\n    name: String,\n    age: u32,\n}",
                "struct User {\n    name: String,\n    age: u32,\n}"
            ),
            Confidence::High
        );
    }

    #[test]
    fn test_validate_python_code() {
        // Python 代码
        assert_eq!(
            validate_content(
                "def hello():\n    print('hi')\n    return True",
                "def hello():\n    print('hi')\n    return True"
            ),
            Confidence::High
        );
    }

    #[test]
    fn test_validate_4_lines_1_different() {
        // 4 行中 1 行不同 → 3/4 匹配，但仍有 1 行不匹配 → Low
        assert_eq!(
            validate_content(
                "let a = 1;\nlet b = 2;\nlet c = 3;\nlet d = 4;",
                "let a = 1;\nlet b = 999;\nlet c = 3;\nlet d = 4;"
            ),
            Confidence::Low
        );
    }

    #[test]
    fn test_validate_short_lines_4() {
        // 4 行短行 → 通过（超过 3 行限制）
        assert_eq!(
            validate_content("x\n}\ny\nz", "x\n}\ny\nz"),
            Confidence::High
        );
    }

    #[test]
    fn test_validate_trailing_spaces() {
        // 末尾空格差异
        assert_eq!(
            validate_content(
                "let x = 1;  \nlet y = 2;\nlet z = 3;",
                "let x = 1;\nlet y = 2;  \nlet z = 3;"
            ),
            Confidence::High
        );
    }

    // ---- Options tests ----

    #[test]
    fn test_default_options() {
        let options = FileEditOptions::default();
        assert_eq!(options, FileEditOptions {});
    }

    #[test]
    fn test_new() {
        let editor = FileEdit::new(FileEditOptions {});
        assert_eq!(editor.options, FileEditOptions {});
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
