//! 工具执行相关模块
//!
//! 提供工具执行的辅助函数：工具图标、参数格式化、文本提取、编辑合并、
//! 调用分区、Token 用量打印、日志记录等。

use zapmyco_anthropic_ai_sdk::types::message::{
    ContentBlock, CreateMessageParams, CreateMessageResponse,
};

use crate::agent::chat::ToolHandler;
use crate::agent::session_logger::SessionLogger;
use crate::agent::stream::RoundResult;
use crate::datetime;
use crate::output::{self, Message};

// ---------------------------------------------------------------------------
// 工具显示
// ---------------------------------------------------------------------------

/// 获取工具类型对应的终端图标
pub(crate) fn tool_icon(name: &str) -> &'static str {
    match name {
        "file_read" => "\u{1f4d6}",                       // 📖
        "file_find" | "file_search" => "\u{1f50d}",       // 🔍
        "file_write" | "file_edit" => "\u{270f}\u{fe0f}", // ✏️
        "shell_exec" => "\u{1f4bb}",                      // 💻
        "web_search" => "\u{1f310}",                      // 🌐
        "web_fetch" => "\u{1f4e1}",                       // 📡
        "ask_user" => "\u{1f4ac}",                        // 💬
        "task_create" | "task_get" | "task_list" | "task_update" => "\u{1f4cb}",
        "subagent" => "\u{1f916}", // 📋
        _ => "\u{1f527}",          // 🔧
    }
}

/// 安全截断字符串到指定字符数（避免在 UTF-8 字符中间截断）
fn truncate_str(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        Some((boundary, _)) => &s[..boundary],
        None => s,
    }
}

/// 生成工具参数的紧凑单行描述
pub(crate) fn format_tool_param(name: &str, input: &serde_json::Value) -> String {
    match name {
        "file_read" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "file_find" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            let path = input.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if path.is_empty() {
                pattern.to_string()
            } else {
                format!("{}  in  {}", pattern, path)
            }
        }
        "file_search" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            let path = input.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let output_mode = input.get("output_mode").and_then(|v| v.as_str());
            let base = if path.is_empty() {
                pattern.to_string()
            } else {
                format!("{}  in  {}", pattern, path)
            };
            if let Some(mode) = output_mode
                && mode != "content"
            {
                format!("[{}] {}", mode, base)
            } else {
                base
            }
        }
        "file_write" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "file_edit" => {
            let fp = input
                .get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let old = input.get("old_string").and_then(|v| v.as_str());
            if let Some(old) = old {
                let truncated = {
                    let t = crate::agent::executor::truncate_str(old, 40);
                    if t.len() < old.len() {
                        format!("{}...", t)
                    } else {
                        old.to_string()
                    }
                };
                format!("{}  查找: \"{}\"", fp, truncated)
            } else {
                fp.to_string()
            }
        }
        "shell_exec" => input
            .get("command")
            .and_then(|v| v.as_str())
            .map(|s| {
                let truncated = crate::agent::executor::truncate_str(s, 60);
                if truncated.len() < s.len() {
                    format!("{}...", truncated)
                } else {
                    s.to_string()
                }
            })
            .unwrap_or_default(),
        "web_search" => input
            .get("query")
            .and_then(|v| v.as_str())
            .map(|s| {
                let truncated = crate::agent::executor::truncate_str(s, 60);
                if truncated.len() < s.len() {
                    format!("\"{}...\"", truncated)
                } else {
                    format!("\"{}\"", s)
                }
            })
            .unwrap_or_default(),
        "web_fetch" => input
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "ask_user" => input
            .get("question")
            .and_then(|v| v.as_str())
            .map(|s| {
                let truncated = crate::agent::executor::truncate_str(s, 60);
                if truncated.len() < s.len() {
                    format!("{}...", truncated)
                } else {
                    s.to_string()
                }
            })
            .unwrap_or_default(),
        "task_create" => input
            .get("subject")
            .and_then(|v| v.as_str())
            .map(|s| {
                let truncated = crate::agent::executor::truncate_str(s, 60);
                if truncated.len() < s.len() {
                    format!("{}...", truncated)
                } else {
                    s.to_string()
                }
            })
            .unwrap_or_default(),
        "task_update" => {
            let id = input.get("task_id").and_then(|v| v.as_str()).unwrap_or("");
            let status = input.get("status").and_then(|v| v.as_str());
            if let Some(status) = status {
                format!("#{} \u{2192} {}", id, status) // →
            } else {
                format!("#{}", id)
            }
        }
        "task_get" => input
            .get("task_id")
            .and_then(|v| v.as_str())
            .map(|s| format!("#{}", s))
            .unwrap_or_default(),
        "task_list" => String::new(),
        "subagent" => input
            .get("task")
            .and_then(|v| v.as_str())
            .map(|s| truncate_str(s, 60).to_string())
            .unwrap_or_default(),
        _ => String::new(),
    }
}

// ---------------------------------------------------------------------------
// 文本处理
// ---------------------------------------------------------------------------

/// 从 ContentBlock 列表中提取纯文本
pub(crate) fn extract_text_from_blocks(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| {
            if let ContentBlock::Text { text, .. } = block {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("")
}

/// 合并同文件的 file_edit 调用（line_range 模式）为批量编辑
pub(crate) fn merge_file_edits(
    tool_uses: &[(String, String, serde_json::Value)],
) -> Vec<(String, String, serde_json::Value)> {
    use std::collections::HashMap;
    let mut file_edit_groups: HashMap<String, Vec<(String, serde_json::Value)>> = HashMap::new();
    let mut other = Vec::new();

    for (tid, name, input) in tool_uses {
        if name == "file_edit"
            && input.get("start_line").and_then(|v| v.as_u64()).is_some()
            && let Some(fp) = input.get("file_path").and_then(|v| v.as_str())
        {
            file_edit_groups
                .entry(fp.to_string())
                .or_default()
                .push((tid.clone(), input.clone()));
            continue;
        }
        other.push((tid.clone(), name.clone(), input.clone()));
    }

    for (file_path, edits) in &file_edit_groups {
        if edits.len() == 1 {
            let (tid, input) = &edits[0];
            other.push((tid.clone(), "file_edit".to_string(), input.clone()));
        } else {
            let edit_items: Vec<serde_json::Value> = edits
                .iter()
                .map(|(_, inp)| {
                    serde_json::json!({
                        "start_line": inp["start_line"],
                        "end_line": inp["end_line"],
                        "expected": inp["expected"],
                        "new_content": inp["new_content"],
                    })
                })
                .collect();

            let merged_input = serde_json::json!({
                "file_path": file_path,
                "edits": edit_items,
            });
            other.push((edits[0].0.clone(), "file_edit".to_string(), merged_input));

            output::send(&Message::info(format!(
                "[工具] 🔗 合并 {} 个 file_edit 调用 (文件: {})",
                edits.len(),
                file_path,
            )));
        }
    }

    other
}

// ---------------------------------------------------------------------------
// 工具调用分区
// ---------------------------------------------------------------------------

/// 工具执行批次，用于并行/串行分区
pub(crate) struct ToolBatch {
    /// 批次内所有工具是否可以并行执行
    pub is_concurrency_safe: bool,
    /// (tool_use_id, name, input)
    pub items: Vec<(String, String, serde_json::Value)>,
}

/// 将工具调用列表按并发安全属性分区：
/// 连续的 safe 工具合并在一个 batch 中（可并行），
/// 每个 unsafe 工具单独一个 batch（串行执行）。
pub(crate) fn partition_tool_calls(
    tool_uses: Vec<(String, String, serde_json::Value)>,
    tools: &[ToolHandler],
) -> Vec<ToolBatch> {
    let mut batches: Vec<ToolBatch> = Vec::new();

    for (tool_use_id, name, input) in tool_uses {
        // 查找 ToolHandler 判断并发安全
        let is_safe = tools
            .iter()
            .find(|h| h.tool_definition().name == name)
            .map(|h| h.is_concurrency_safe(&input))
            .unwrap_or(false);

        if is_safe {
            // 尝试追加到上一个 batch（如果前一个也是 safe batch）
            if let Some(last) = batches.last_mut()
                && last.is_concurrency_safe
            {
                last.items.push((tool_use_id, name, input));
            } else {
                batches.push(ToolBatch {
                    is_concurrency_safe: true,
                    items: vec![(tool_use_id, name, input)],
                });
            }
        } else {
            // 不安全工具各自独立 batch
            batches.push(ToolBatch {
                is_concurrency_safe: false,
                items: vec![(tool_use_id, name, input)],
            });
        }
    }

    batches
}

// ---------------------------------------------------------------------------
// Token 用量打印
// ---------------------------------------------------------------------------

/// 在终端输出当前轮次的 token 用量和缓存命中率信息
pub(crate) fn print_usage_line(
    round: Option<u32>,
    input_tokens: u32,
    output_tokens: u32,
    cache_read: Option<u32>,
    cache_create: Option<u32>,
    duration_ms: u64,
) {
    let cache_read_val = cache_read.unwrap_or(0);
    let cache_create_val = cache_create.unwrap_or(0);
    let total_input = input_tokens + cache_read_val + cache_create_val;
    output::send(&Message::llm_usage(
        total_input as u64,
        output_tokens as u64,
        cache_read_val as u64,
        cache_create_val as u64,
        duration_ms,
        round,
    ));
}

// ---------------------------------------------------------------------------
// 对话日志记录
// ---------------------------------------------------------------------------

/// 记录非流式对话的 round-trip 日志
pub(crate) fn log_round_trip(
    logger: &SessionLogger,
    params: &CreateMessageParams,
    response: &CreateMessageResponse,
    duration_ms: u64,
) {
    let ts = datetime::iso_timestamp_now();
    let request_value = serde_json::to_value(params).unwrap_or_default();
    let response_value = serde_json::to_value(response).unwrap_or_default();
    let _ = logger.append_record(ts, duration_ms, request_value, response_value);
}

/// 记录流式对话的 round-trip 日志（从 RoundResult 重建响应）
pub(crate) fn log_round_trip_stream(
    logger: &SessionLogger,
    params: &CreateMessageParams,
    result: &RoundResult,
    duration_ms: u64,
) {
    let ts = datetime::iso_timestamp_now();
    let request_value = serde_json::to_value(params).unwrap_or_default();
    let response_value = serde_json::json!({
        "id": null,
        "type": "message",
        "role": "assistant",
        "content": result.blocks,
        "model": result.model,
        "stop_reason": if result.tool_uses.is_empty() { "end_turn" } else { "tool_use" },
        "stop_sequence": null,
        "usage": {
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "cache_creation_input_tokens": result.cache_creation_input_tokens,
            "cache_read_input_tokens": result.cache_read_input_tokens,
        }
    });
    let _ = logger.append_record(ts, duration_ms, request_value, response_value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use zapmyco_anthropic_ai_sdk::types::message::{ContentBlock, Message, Role};

    // ---- extract_text_from_blocks tests ----

    #[test]
    fn test_extract_text_from_blocks() {
        let blocks = vec![
            ContentBlock::Text {
                text: "Hello ".to_string(),
                citations: None,
            },
            ContentBlock::Text {
                text: "World".to_string(),
                citations: None,
            },
        ];
        assert_eq!(extract_text_from_blocks(&blocks), "Hello World");
    }

    #[test]
    fn test_extract_text_from_blocks_empty() {
        let blocks: Vec<ContentBlock> = vec![];
        assert_eq!(extract_text_from_blocks(&blocks), "");
    }

    #[test]
    fn test_extract_text_from_blocks_mixed() {
        let blocks = vec![
            ContentBlock::Text {
                text: "Hello ".to_string(),
                citations: None,
            },
            ContentBlock::ToolUse {
                id: "tu_1".to_string(),
                name: "web_search".to_string(),
                input: serde_json::json!({"q": "test"}),
            },
            ContentBlock::Text {
                text: "World".to_string(),
                citations: None,
            },
            ContentBlock::ToolResult {
                tool_use_id: "tu_1".to_string(),
                content: "result".to_string(),
            },
        ];
        assert_eq!(extract_text_from_blocks(&blocks), "Hello World");
    }

    #[test]
    fn test_extract_text_from_blocks_only_non_text() {
        let blocks = vec![
            ContentBlock::ToolUse {
                id: "tu_1".to_string(),
                name: "web_search".to_string(),
                input: serde_json::json!({"q": "test"}),
            },
            ContentBlock::ToolResult {
                tool_use_id: "tu_1".to_string(),
                content: "result".to_string(),
            },
        ];
        assert_eq!(extract_text_from_blocks(&blocks), "");
    }

    // ---- merge_file_edits tests ----

    #[test]
    fn test_merge_file_edits_same_file() {
        let tool_uses = vec![
            (
                "tid1".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "start_line": 1,
                    "end_line": 5,
                    "expected": "old1",
                    "new_content": "new1",
                }),
            ),
            (
                "tid2".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "start_line": 10,
                    "end_line": 15,
                    "expected": "old2",
                    "new_content": "new2",
                }),
            ),
        ];
        let merged = merge_file_edits(&tool_uses);
        // 两个同文件 line_range 编辑应合为一个 batch 编辑
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].1, "file_edit");
        assert!(merged[0].2.get("edits").is_some());
    }

    #[test]
    fn test_merge_file_edits_different_files() {
        let tool_uses = vec![
            (
                "tid1".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "start_line": 1,
                    "end_line": 5,
                    "expected": "old1",
                    "new_content": "new1",
                }),
            ),
            (
                "tid2".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/lib.rs",
                    "start_line": 10,
                    "end_line": 15,
                    "expected": "old2",
                    "new_content": "new2",
                }),
            ),
        ];
        let merged = merge_file_edits(&tool_uses);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn test_merge_file_edits_old_string_mode_not_merged() {
        let tool_uses = vec![
            (
                "tid1".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "old_string": "old1",
                    "new_string": "new1",
                }),
            ),
            (
                "tid2".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "old_string": "old2",
                    "new_string": "new2",
                }),
            ),
        ];
        let merged = merge_file_edits(&tool_uses);
        // old_string 模式不合并，每个独立保留
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn test_merge_file_edits_single_line_range_not_batched() {
        let tool_uses = vec![(
            "tid1".to_string(),
            "file_edit".to_string(),
            serde_json::json!({
                "file_path": "src/main.rs",
                "start_line": 1,
                "end_line": 5,
                "expected": "old1",
                "new_content": "new1",
            }),
        )];
        let merged = merge_file_edits(&tool_uses);
        // 单个 line_range 编辑不批量（直接原样保留）
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].1, "file_edit");
        assert!(merged[0].2.get("edits").is_none());
    }
}
