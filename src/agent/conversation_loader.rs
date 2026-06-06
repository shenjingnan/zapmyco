//! 历史会话加载器 — 从 ~/.zapmyco/conversations/*.jsonl 重建消息历史
//!
//! 提供三个公共函数：
//! - `list_conversations()` — 列出所有可用会话
//! - `load_conversation(session_id)` — 加载指定会话的消息
//! - `select_conversation_interactively()` — 交互式选择会话

use std::path::PathBuf;

use serde_json::Value;

use zapmyco_anthropic_ai_sdk::types::message::ContentBlock;

use crate::agent::chat::ConversationMessage;
use crate::agent::conversation_logger;
use crate::agent::executor::extract_text_from_blocks;

/// 会话摘要（用于列表展示）
pub struct ConversationSummary {
    pub session_id: String,
    pub message_count: usize,
    pub first_message_time: String,
    pub preview: String,
    pub file_path: PathBuf,
}

/// 列出 ~/.zapmyco/conversations/ 下所有 JSONL 文件，按时间降序排列
pub fn list_conversations() -> Result<Vec<ConversationSummary>, String> {
    let dir = get_conversations_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut conversations = Vec::new();

    let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取会话目录失败: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }

        let session_id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let lines: Vec<&str> = content.lines().collect();
        if lines.is_empty() {
            continue;
        }

        // 读取第一行获取时间戳和预览
        let (first_time, preview) = match serde_json::from_str::<Value>(lines[0]) {
            Ok(record) => {
                let ts = record["ts"].as_str().unwrap_or("").to_string();
                let preview = record["request"]["messages"]
                    .as_array()
                    .and_then(|msgs| msgs.first())
                    .and_then(|m| match &m["content"] {
                        Value::String(s) => Some(s.chars().take(80).collect()),
                        _ => None,
                    })
                    .unwrap_or_default();
                (ts, preview)
            }
            Err(_) => continue,
        };

        // 读取最后一行获取消息数
        let message_count = lines
            .last()
            .and_then(|line| serde_json::from_str::<Value>(line).ok())
            .and_then(|record| record["request"]["messages"].as_array().map(|a| a.len()))
            .unwrap_or(0);

        conversations.push(ConversationSummary {
            session_id,
            message_count,
            first_message_time: first_time,
            preview,
            file_path: path,
        });
    }

    // 按时间降序（最新的在前）
    conversations.sort_by(|a, b| b.first_message_time.cmp(&a.first_message_time));

    Ok(conversations)
}

/// 加载指定会话的消息历史
///
/// 读取 JSONL 文件，从最后一条记录的 `request.messages` 重建完整消息列表。
pub fn load_conversation(session_id: &str) -> Result<Vec<ConversationMessage>, String> {
    let path = get_conversations_dir()?.join(format!("{}.jsonl", session_id));

    let content = std::fs::read_to_string(&path).map_err(|_| {
        format!(
            "未找到会话 '{}'。\n可用 `zapmyco run --conversation` 按 Tab 查看可用会话",
            session_id
        )
    })?;

    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return Err("会话文件为空".to_string());
    }

    // 取最后一条记录（order 最大），包含完整的消息历史
    let last_record: Value = serde_json::from_str(lines.last().unwrap())
        .map_err(|e| format!("解析会话文件失败: {}", e))?;

    let messages = last_record["request"]["messages"]
        .as_array()
        .ok_or_else(|| "会话文件中未找到消息记录".to_string())?;

    messages.iter().map(json_to_conversation_message).collect()
}

/// 交互式选择会话（使用 inquire::Select）
pub fn select_conversation_interactively() -> Result<String, String> {
    let conversations = list_conversations()?;

    if conversations.is_empty() {
        return Err("~/.zapmyco/conversations/ 中没有找到历史会话。\
                     \n请先执行 `zapmyco run <任务>` 产生会话后再使用 --conversation。"
            .to_string());
    }

    let options: Vec<String> = conversations
        .iter()
        .map(|c| {
            let date = if c.first_message_time.len() >= 10 {
                &c.first_message_time[..10]
            } else {
                &c.first_message_time
            };
            format!("{} | {} 条消息 | {}", date, c.message_count, c.preview)
        })
        .collect();

    let selection = inquire::Select::new("选择要恢复的会话:", options.clone())
        .prompt()
        .map_err(|e| match e {
            inquire::InquireError::OperationCanceled => "已取消选择".to_string(),
            _ => format!("选择会话失败: {}", e),
        })?;

    let idx = options
        .iter()
        .position(|o| o == &selection)
        .expect("选中的项应存在于列表中");

    Ok(conversations[idx].session_id.clone())
}

// ---- 内部辅助函数 ----

/// 获取 ~/.zapmyco/conversations/ 目录路径
fn get_conversations_dir() -> Result<PathBuf, String> {
    conversation_logger::get_log_dir()
}

/// 将 JSON 格式的消息转换为内部 ConversationMessage
fn json_to_conversation_message(msg: &Value) -> Result<ConversationMessage, String> {
    let role = msg["role"]
        .as_str()
        .ok_or_else(|| "消息缺少 role 字段".to_string())?
        .to_string();

    match &msg["content"] {
        Value::String(text) => Ok(ConversationMessage {
            role,
            content: text.clone(),
            blocks: None,
        }),
        Value::Array(blocks_json) => {
            let blocks: Vec<ContentBlock> = blocks_json
                .iter()
                .map(|b| {
                    serde_json::from_value(b.clone())
                        .map_err(|e| format!("解析 ContentBlock 失败: {}", e))
                })
                .collect::<Result<Vec<_>, _>>()?;

            let text = extract_text_from_blocks(&blocks);
            Ok(ConversationMessage {
                role,
                content: text,
                blocks: Some(blocks),
            })
        }
        other => Err(format!(
            "意外的 content 格式 (期望 string 或 array, 得到 {})",
            type_name_of(other)
        )),
    }
}

/// 获取 Value 的类型名称（用于错误信息）
fn type_name_of(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;

    /// 创建一个模拟的 JSONL 文件
    fn create_mock_jsonl(
        dir: &std::path::Path,
        session_id: &str,
        user_text: &str,
        assistant_text: &str,
    ) -> PathBuf {
        let path = dir.join(format!("{}.jsonl", session_id));

        // 构造一条完整的请求/响应记录
        let record = serde_json::json!({
            "session_id": session_id,
            "order": 0,
            "ts": "2026-06-05T12:00:00Z",
            "duration_ms": 1000,
            "request": {
                "model": "test-model",
                "messages": [
                    {"role": "user", "content": user_text},
                    {"role": "assistant", "content": [{"type": "text", "text": assistant_text}]}
                ],
                "max_tokens": 4096
            },
            "response": {
                "id": null,
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": assistant_text}],
                "model": "test-model",
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 10, "output_tokens": 5}
            }
        });

        let json_line = serde_json::to_string(&record).unwrap();
        std::fs::write(&path, format!("{}\n", json_line)).unwrap();
        path
    }

    #[test]
    fn test_load_conversation_success() {
        run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/conversations");
            std::fs::create_dir_all(&dir).unwrap();
            create_mock_jsonl(&dir, "test-session-1", "hello", "hi there");

            let messages = load_conversation("test-session-1").unwrap();
            assert_eq!(messages.len(), 2);

            assert_eq!(messages[0].role, "user");
            assert_eq!(messages[0].content, "hello");
            assert!(messages[0].blocks.is_none());

            assert_eq!(messages[1].role, "assistant");
            assert_eq!(messages[1].content, "hi there");
            assert!(messages[1].blocks.is_some());
        });
    }

    #[test]
    fn test_load_conversation_file_not_found() {
        run_with_temp_home(|_home| {
            let result = load_conversation("nonexistent-session");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("未找到会话"));
        });
    }

    #[test]
    fn test_load_conversation_empty_file() {
        run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/conversations");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("empty-session.jsonl"), "").unwrap();

            let result = load_conversation("empty-session");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("为空"));
        });
    }

    #[test]
    fn test_list_conversations() {
        run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/conversations");
            std::fs::create_dir_all(&dir).unwrap();

            create_mock_jsonl(&dir, "session-old", "old task", "done");
            create_mock_jsonl(&dir, "session-new", "new task", "in progress");

            let list = list_conversations().unwrap();
            // 按时间降序，最新的在前
            assert_eq!(list.len(), 2);
            // 两个会话的 ts 相同，所以顺序不重要
            let ids: Vec<&str> = list.iter().map(|s| s.session_id.as_str()).collect();
            assert!(ids.contains(&"session-old"));
            assert!(ids.contains(&"session-new"));
        });
    }

    #[test]
    fn test_list_conversations_empty_dir() {
        run_with_temp_home(|_home| {
            let list = list_conversations().unwrap();
            assert!(list.is_empty());
        });
    }

    #[test]
    fn test_json_to_conversation_text_content() {
        let json = serde_json::json!({
            "role": "user",
            "content": "plain text message"
        });

        let msg = json_to_conversation_message(&json).unwrap();
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content, "plain text message");
        assert!(msg.blocks.is_none());
    }

    #[test]
    fn test_json_to_conversation_blocks_content() {
        let json = serde_json::json!({
            "role": "assistant",
            "content": [
                {"type": "text", "text": "Hello"},
                {"type": "tool_use", "id": "tu_1", "name": "file_read", "input": {"file_path": "/test.txt"}}
            ]
        });

        let msg = json_to_conversation_message(&json).unwrap();
        assert_eq!(msg.role, "assistant");
        assert_eq!(msg.content, "Hello");
        assert!(msg.blocks.is_some());
        let blocks = msg.blocks.unwrap();
        assert_eq!(blocks.len(), 2);
    }

    #[test]
    fn test_json_to_conversation_tool_result() {
        let json = serde_json::json!({
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "tu_1", "content": "file content"}
            ]
        });

        let msg = json_to_conversation_message(&json).unwrap();
        assert_eq!(msg.role, "user");
        assert!(msg.blocks.is_some());
    }

    #[test]
    fn test_json_to_conversation_missing_role() {
        let json = serde_json::json!({
            "content": "no role here"
        });
        let result = json_to_conversation_message(&json);
        assert!(result.is_err());
    }

    #[test]
    fn test_json_to_conversation_unexpected_content() {
        let json = serde_json::json!({
            "role": "user",
            "content": {"nested": "object"}
        });
        let result = json_to_conversation_message(&json);
        assert!(result.is_err());
    }
}
