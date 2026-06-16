//! 历史会话加载器 — 从 ~/.zapmyco/sessions/ 重建消息历史
//!
//! 子目录格式: ~/.zapmyco/sessions/<session_id>/conversation.jsonl
//!
//! 提供三个公共函数：
//! - `list_sessions()` — 列出所有可用会话
//! - `load_session(session_id)` — 加载指定会话的消息
//! - `list_subagent_sessions(parent_id)` — 按父会话 ID 查询 SubAgent 会话

use std::path::PathBuf;

use serde_json::Value;

use zapmyco_anthropic_ai_sdk::types::message::ContentBlock;

use crate::agent::chat::ConversationMessage;
use crate::agent::executor::extract_text_from_blocks;
use crate::agent::session_logger;

/// 会话摘要（用于列表展示）
pub struct SessionSummary {
    pub session_id: String,
    pub message_count: usize,
    pub first_message_time: String,
    pub preview: String,
    pub file_path: PathBuf,
    /// 模型名称（从 session.json 获取）
    pub model: Option<String>,
    /// 配置档名称（从 session.json 获取）
    pub profile: Option<String>,
    /// 退出原因（从 session.json 获取）
    pub exit_reason: Option<String>,
    /// 是否为 SubAgent 会话
    pub is_subagent: bool,
    /// 父会话 ID（SubAgent 会话关联到主 Agent）
    pub parent_session_id: Option<String>,
}

/// 列出 ~/.zapmyco/sessions/ 下所有会话，按时间降序排列
///
/// 优先读取 session.json 获取会话信息，仅在没有 session.json 时
/// fallback 到 conversation.jsonl 解析（兼容旧格式）。
pub fn list_sessions() -> Result<Vec<SessionSummary>, String> {
    let dir = get_sessions_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();

    let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取会话目录失败: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }
        let session_id = match path.file_name().and_then(|s| s.to_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };

        // ---- 优先读取 session.json（新格式） ----
        let json_path = path.join("session.json");
        if json_path.exists() {
            let content = std::fs::read_to_string(&json_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok());
            if let Some(content) = content {
                let first_time = content["started_at"].as_str().unwrap_or("").to_string();
                let preview = content["model"]
                    .as_str()
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                sessions.push(SessionSummary {
                    session_id,
                    message_count: 0,
                    first_message_time: first_time,
                    preview,
                    file_path: json_path,
                    model: content["model"].as_str().map(|s| s.to_string()),
                    profile: content["profile"].as_str().map(|s| s.to_string()),
                    exit_reason: content["exit_reason"].as_str().map(|s| s.to_string()),
                    is_subagent: content["is_subagent"].as_bool().unwrap_or(false),
                    parent_session_id: content["parent_session_id"].as_str().map(|s| s.to_string()),
                });
                continue;
            }
            // session.json 损坏则降级到 JSONL
        }

        // ---- Fallback: 解析 conversation.jsonl（兼容旧格式） ----
        let jsonl_path = path.join("conversation.jsonl");
        if !jsonl_path.exists() {
            continue;
        }

        let content = match std::fs::read_to_string(&jsonl_path) {
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

        sessions.push(SessionSummary {
            session_id,
            message_count,
            first_message_time: first_time,
            preview,
            file_path: jsonl_path,
            model: None,
            profile: None,
            exit_reason: None,
            is_subagent: false,
            parent_session_id: None,
        });
    }

    // 按时间降序（最新的在前）
    sessions.sort_by(|a, b| b.first_message_time.cmp(&a.first_message_time));

    Ok(sessions)
}

/// 加载指定会话的消息历史
///
/// 从 `~/.zapmyco/sessions/<session_id>/conversation.jsonl` 读取并重建消息列表。
/// 从最后一条记录的 `request.messages` 重建完整消息列表。
pub fn load_session(session_id: &str) -> Result<Vec<ConversationMessage>, String> {
    let dir = get_sessions_dir()?;
    let path = dir.join(session_id).join("conversation.jsonl");

    let content = std::fs::read_to_string(&path).map_err(|_| {
        format!(
            "未找到会话 '{}'。\n可用 `zapmyco run --session` 按 Tab 查看可用会话",
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

/// 按 parent_session_id 查询所有 SubAgent 会话
pub fn list_subagent_sessions(parent_id: &str) -> Result<Vec<SessionSummary>, String> {
    let all = list_sessions()?;
    Ok(all
        .into_iter()
        .filter(|s| s.parent_session_id.as_deref() == Some(parent_id))
        .collect())
}

// ---- 内部辅助函数 ----

/// 获取 ~/.zapmyco/sessions/ 目录路径
fn get_sessions_dir() -> Result<PathBuf, String> {
    session_logger::get_sessions_dir()
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

    /// 创建一个子目录格式的模拟会话
    fn create_mock_session_dir(
        dir: &std::path::Path,
        session_id: &str,
        user_text: &str,
        assistant_text: &str,
    ) -> PathBuf {
        let session_dir = dir.join(session_id);
        std::fs::create_dir_all(&session_dir).unwrap();
        let path = session_dir.join("conversation.jsonl");

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
    fn test_load_session_file_not_found() {
        run_with_temp_home(|_home| {
            let result = load_session("nonexistent-session");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("未找到会话"));
        });
    }

    #[test]
    fn test_load_session_empty_file() {
        crate::test_util::run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/sessions");
            std::fs::create_dir_all(&dir).unwrap();
            let session_dir = dir.join("empty-session");
            std::fs::create_dir(&session_dir).unwrap();
            std::fs::write(session_dir.join("conversation.jsonl"), "").unwrap();

            let result = load_session("empty-session");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("为空"));
        });
    }

    #[test]
    fn test_list_sessions_empty_dir() {
        run_with_temp_home(|_home| {
            let list = list_sessions().unwrap();
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

    #[test]
    fn test_load_session_multiple_records_uses_last() {
        crate::test_util::run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/sessions");
            std::fs::create_dir_all(&dir).unwrap();
            let session_dir = dir.join("multi-record");
            std::fs::create_dir(&session_dir).unwrap();
            let path = session_dir.join("conversation.jsonl");

            // 写入 3 条记录，每条消息数递增
            let rec1 = serde_json::json!({
                "session_id": "multi-record",
                "order": 0,
                "ts": "2026-06-05T12:00:00Z",
                "duration_ms": 100,
                "request": {
                    "model": "test",
                    "messages": [
                        {"role": "user", "content": "msg from record 1"}
                    ],
                    "max_tokens": 100
                },
                "response": {"content": "ok"}
            });
            let rec2 = serde_json::json!({
                "session_id": "multi-record",
                "order": 1,
                "ts": "2026-06-05T12:00:01Z",
                "duration_ms": 100,
                "request": {
                    "model": "test",
                    "messages": [
                        {"role": "user", "content": "msg from record 2"}
                    ],
                    "max_tokens": 100
                },
                "response": {"content": "ok"}
            });
            let rec3 = serde_json::json!({
                "session_id": "multi-record",
                "order": 2,
                "ts": "2026-06-05T12:00:02Z",
                "duration_ms": 100,
                "request": {
                    "model": "test",
                    "messages": [
                        {"role": "user", "content": "from last"},
                        {"role": "assistant", "content": "last reply"}
                    ],
                    "max_tokens": 100
                },
                "response": {"content": "ok"}
            });

            let content = format!(
                "{}\n{}\n{}\n",
                serde_json::to_string(&rec1).unwrap(),
                serde_json::to_string(&rec2).unwrap(),
                serde_json::to_string(&rec3).unwrap()
            );
            std::fs::write(&path, &content).unwrap();

            let messages = load_session("multi-record").unwrap();
            assert_eq!(messages.len(), 2, "应使用最后一条记录的 2 条消息");
            assert_eq!(messages[0].content, "from last");
            assert_eq!(messages[1].content, "last reply");
        });
    }

    #[test]
    fn test_json_to_conversation_preserves_context_reminder() {
        // 构造一个包含 context_reminder 的模拟消息
        let reminder = crate::agent::system_prompt::build_context_reminder(None);
        let full_text = format!("{}{}", reminder, "actual task");

        let json = serde_json::json!({
            "role": "user",
            "content": full_text
        });

        let msg = json_to_conversation_message(&json).unwrap();
        assert_eq!(msg.role, "user");
        assert!(
            msg.content.contains("<system-reminder>"),
            "应包含 system-reminder 标签"
        );
        assert!(msg.content.contains("</system-reminder>"), "应包含闭合标签");
        assert!(msg.content.contains("actual task"), "应包含原始任务文本");
        assert!(
            msg.content.contains("当前工作目录："),
            "应包含 context_reminder 内容"
        );
        assert!(msg.blocks.is_none(), "纯字符串内容不应有 blocks");
    }

    // ==================== 新格式测试 ====================

    #[test]
    fn test_list_sessions_new_format_only() {
        crate::test_util::run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/sessions");
            std::fs::create_dir_all(&dir).unwrap();

            create_mock_session_dir(&dir, "session-v2-1", "hello", "hi");
            create_mock_session_dir(&dir, "session-v2-2", "task", "done");

            let list = list_sessions().unwrap();
            assert_eq!(list.len(), 2);

            let ids: Vec<&str> = list.iter().map(|s| s.session_id.as_str()).collect();
            assert!(ids.contains(&"session-v2-1"));
            assert!(ids.contains(&"session-v2-2"));

            // 验证 file_path 指向的是子目录内的 conversation.jsonl
            for summary in &list {
                assert!(
                    summary.file_path.ends_with("conversation.jsonl"),
                    "{} 的路径应指向 conversation.jsonl",
                    summary.session_id
                );
                assert!(
                    summary.file_path.exists(),
                    "{} 的 conversation.jsonl 应存在",
                    summary.session_id
                );
            }
        });
    }

    #[test]
    fn test_load_session_new_format() {
        crate::test_util::run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/sessions");
            std::fs::create_dir_all(&dir).unwrap();
            create_mock_session_dir(&dir, "v2-session", "hello", "hi there");

            let messages = load_session("v2-session").unwrap();
            assert_eq!(messages.len(), 2);
            assert_eq!(messages[0].role, "user");
            assert_eq!(messages[0].content, "hello");
            assert_eq!(messages[1].role, "assistant");
            assert_eq!(messages[1].content, "hi there");
        });
    }

    #[test]
    fn test_list_sessions_ignores_non_jsonl_files() {
        crate::test_util::run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/sessions");
            std::fs::create_dir_all(&dir).unwrap();

            // 创建非 jsonl 文件
            std::fs::write(dir.join("README.md"), "# notes").unwrap();
            std::fs::write(dir.join(".DS_Store"), "").unwrap();
            std::fs::write(dir.join("temp.txt"), "temp").unwrap();

            // 创建一条有效会话（新格式）
            create_mock_session_dir(&dir, "real-session", "hi", "hello");

            let list = list_sessions().unwrap();
            assert_eq!(list.len(), 1, "非 jsonl 文件不应计入");
            assert_eq!(list[0].session_id, "real-session");
        });
    }

    #[test]
    fn test_list_sessions_ignores_empty_subdirs() {
        crate::test_util::run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/sessions");
            std::fs::create_dir_all(&dir).unwrap();

            // 创建空子目录（可能来自中断的创建过程）
            std::fs::create_dir(dir.join("incomplete-session")).unwrap();
            // 创建只有 terminal.log 但没有 conversation.jsonl 的子目录
            let partial_dir = dir.join("partial-session");
            std::fs::create_dir_all(&partial_dir).unwrap();
            std::fs::write(partial_dir.join("terminal.log"), "some output").unwrap();

            // 创建一条有效会话
            create_mock_session_dir(&dir, "real-session", "hi", "hello");

            let list = list_sessions().unwrap();
            assert_eq!(list.len(), 1, "空子目录和无 jsonl 的子目录不应计入");
        });
    }

    #[test]
    fn test_list_sessions_only_noise_files() {
        crate::test_util::run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/sessions");
            std::fs::create_dir_all(&dir).unwrap();

            // 非 jsonl 扩展名的文件（含隐藏文件）
            std::fs::write(dir.join(".hidden-file"), "secret").unwrap();
            std::fs::write(dir.join(".DS_Store"), "").unwrap();
            std::fs::write(dir.join("temp.txt"), "temp").unwrap();

            let list = list_sessions().unwrap();
            assert_eq!(list.len(), 0, "无有效会话时应返回空列表");
        });
    }

    #[test]
    fn test_list_sessions_sorts_by_time() {
        crate::test_util::run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/sessions");
            std::fs::create_dir_all(&dir).unwrap();

            // 创建记录时使用不同的时间戳来验证排序
            fn create_with_ts(dir: &std::path::Path, sid: &str, ts: &str, user: &str, asst: &str) {
                let record = serde_json::json!({
                    "session_id": sid,
                    "order": 0,
                    "ts": ts,
                    "duration_ms": 1000,
                    "request": {"model": "test", "messages": [
                        {"role": "user", "content": user},
                        {"role": "assistant", "content": [{"type": "text", "text": asst}]}
                    ], "max_tokens": 100},
                    "response": {"content": asst}
                });
                let line = serde_json::to_string(&record).unwrap();
                let sd = dir.join(sid);
                std::fs::create_dir_all(&sd).unwrap();
                std::fs::write(sd.join("conversation.jsonl"), format!("{}\n", line)).unwrap();
            }

            create_with_ts(
                &dir,
                "session-early",
                "2026-01-01T00:00:00Z",
                "early",
                "reply",
            );
            create_with_ts(&dir, "session-mid", "2026-06-01T00:00:00Z", "mid", "reply");
            create_with_ts(
                &dir,
                "session-late",
                "2026-12-01T00:00:00Z",
                "late",
                "reply",
            );

            let list = list_sessions().unwrap();
            assert_eq!(list.len(), 3);

            // 按时间降序：session-late → session-mid → session-early
            assert_eq!(list[0].session_id, "session-late", "最新应在第一个");
            assert_eq!(list[1].session_id, "session-mid");
            assert_eq!(list[2].session_id, "session-early", "最旧应在最后一个");
        });
    }

    #[test]
    fn test_list_sessions_ignores_empty_jsonl_in_new_format() {
        crate::test_util::run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/sessions");
            std::fs::create_dir_all(&dir).unwrap();

            // 创建子目录但 conversation.jsonl 为空
            let empty_sid = "empty-session";
            let empty_dir = dir.join(empty_sid);
            std::fs::create_dir(&empty_dir).unwrap();
            std::fs::write(empty_dir.join("conversation.jsonl"), "").unwrap();

            // 创建有效的对照会话
            create_mock_session_dir(&dir, "valid-session", "hi", "hello");

            // list 应跳过空文件
            let list = list_sessions().unwrap();
            assert_eq!(list.len(), 1, "空 jsonl 的会话不应计入");
            assert_eq!(list[0].session_id, "valid-session");

            // load 应报错
            let result = load_session(empty_sid);
            assert!(result.is_err(), "空文件加载应失败");
        });
    }

    #[test]
    fn test_list_sessions_handles_malformed_json_in_new_format() {
        crate::test_util::run_with_temp_home(|home| {
            let dir = home.join(".zapmyco/sessions");
            std::fs::create_dir_all(&dir).unwrap();

            // 创建子目录但 conversation.jsonl 内容是无效 JSON
            let bad_sid = "bad-json-session";
            let bad_dir = dir.join(bad_sid);
            std::fs::create_dir(&bad_dir).unwrap();
            std::fs::write(bad_dir.join("conversation.jsonl"), "not valid json\n").unwrap();

            // 创建有效的对照会话
            create_mock_session_dir(&dir, "valid-session", "hi", "hello");

            // list 应跳过无效 JSON
            let list = list_sessions().unwrap();
            assert_eq!(list.len(), 1, "无效 JSON 的会话不应计入");
            assert_eq!(list[0].session_id, "valid-session");

            // load 应报错
            let result = load_session(bad_sid);
            assert!(result.is_err(), "无效 JSON 加载应失败");
        });
    }

    // ==================== session.json 兼容性测试 ====================

    fn write_session_json_to(dir: &std::path::Path, meta: serde_json::Value) {
        let path = dir.join("session.json");
        std::fs::write(&path, serde_json::to_string(&meta).unwrap()).unwrap();
    }

    fn create_session_dir(home: &std::path::Path, session_id: &str) -> std::path::PathBuf {
        let dir = home.join(".zapmyco/sessions").join(session_id);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_list_sessions_prefers_session_json() {
        crate::test_util::run_with_temp_home(|home| {
            let session_dir = create_session_dir(home, "test-session");
            write_session_json_to(
                &session_dir,
                serde_json::json!({
                    "session_id": "test-session",
                    "model": "claude-4",
                    "started_at": "2026-06-14T12:00:00+08:00",
                    "profile": "test",
                }),
            );
            let record = serde_json::json!({
                "session_id": "test-session", "order": 0,
                "ts": "2026-01-01T00:00:00Z", "duration_ms": 100,
                "request": {"model": "test", "messages": [], "max_tokens": 100},
                "response": {"content": "ok"}
            });
            std::fs::write(
                session_dir.join("conversation.jsonl"),
                format!("{}\n", serde_json::to_string(&record).unwrap()),
            )
            .unwrap();

            let sessions = list_sessions().unwrap();
            assert_eq!(sessions.len(), 1);
            assert_eq!(sessions[0].model.as_deref(), Some("claude-4"));
            assert_eq!(sessions[0].profile.as_deref(), Some("test"));
        });
    }

    #[test]
    fn test_list_sessions_fallback_to_jsonl() {
        crate::test_util::run_with_temp_home(|home| {
            let session_dir = create_session_dir(home, "legacy-session");
            let record = serde_json::json!({
                "session_id": "legacy-session", "order": 0,
                "ts": "2026-06-14T12:00:00+08:00", "duration_ms": 100,
                "request": {
                    "model": "test", "max_tokens": 100,
                    "messages": [{"role": "user", "content": "hello"}]
                },
                "response": {"content": "hi"}
            });
            std::fs::write(
                session_dir.join("conversation.jsonl"),
                format!("{}\n", serde_json::to_string(&record).unwrap()),
            )
            .unwrap();

            let sessions = list_sessions().unwrap();
            assert_eq!(sessions.len(), 1);
            assert_eq!(sessions[0].session_id, "legacy-session");
            assert!(sessions[0].model.is_none());
            assert!(sessions[0].profile.is_none());
        });
    }

    #[test]
    fn test_list_sessions_fallback_on_corrupted_json() {
        crate::test_util::run_with_temp_home(|home| {
            let session_dir = create_session_dir(home, "corrupted-session");
            std::fs::write(session_dir.join("session.json"), "{invalid json}").unwrap();
            let record = serde_json::json!({
                "session_id": "corrupted-session", "order": 0,
                "ts": "2026-06-14T12:00:00+08:00", "duration_ms": 100,
                "request": {
                    "model": "test", "max_tokens": 100,
                    "messages": [{"role": "user", "content": "hi"}]
                },
                "response": {"content": "hello"}
            });
            std::fs::write(
                session_dir.join("conversation.jsonl"),
                format!("{}\n", serde_json::to_string(&record).unwrap()),
            )
            .unwrap();

            let sessions = list_sessions().unwrap();
            assert_eq!(sessions.len(), 1);
            assert!(sessions[0].model.is_none());
            assert_eq!(sessions[0].session_id, "corrupted-session");
        });
    }

    #[test]
    fn test_list_sessions_with_only_session_json() {
        crate::test_util::run_with_temp_home(|home| {
            let session_dir = create_session_dir(home, "empty-session");
            write_session_json_to(
                &session_dir,
                serde_json::json!({
                    "session_id": "empty-session",
                    "model": "claude-4",
                    "started_at": "2026-06-14T12:00:00+08:00",
                }),
            );

            let sessions = list_sessions().unwrap();
            assert_eq!(sessions.len(), 1);
            assert_eq!(sessions[0].model.as_deref(), Some("claude-4"));
        });
    }

    #[test]
    fn test_list_sessions_migration_from_old_version() {
        crate::test_util::run_with_temp_home(|home| {
            for i in 0..3 {
                let dir = create_session_dir(home, &format!("old-session-{}", i));
                let record = serde_json::json!({
                    "session_id": format!("old-session-{}", i), "order": 0,
                    "ts": format!("2026-06-{:02}T12:00:00+08:00", i + 1),
                    "duration_ms": 100,
                    "request": {
                        "model": "test", "max_tokens": 100,
                        "messages": [{"role": "user", "content": format!("msg {}", i)}]
                    },
                    "response": {"content": "ok"}
                });
                std::fs::write(
                    dir.join("conversation.jsonl"),
                    format!("{}\n", serde_json::to_string(&record).unwrap()),
                )
                .unwrap();
            }

            let sessions = list_sessions().unwrap();
            assert_eq!(sessions.len(), 3);
            assert!(sessions.iter().all(|s| s.model.is_none()));
        });
    }

    #[test]
    fn test_load_session_ignores_session_json() {
        crate::test_util::run_with_temp_home(|home| {
            let session_dir = create_session_dir(home, "test-session");
            write_session_json_to(
                &session_dir,
                serde_json::json!({
                    "session_id": "test-session",
                    "started_at": "2026-06-14T12:00:00+08:00",
                }),
            );
            let record = serde_json::json!({
                "session_id": "test-session", "order": 0,
                "ts": "2026-06-14T12:00:00+08:00", "duration_ms": 100,
                "request": {
                    "model": "test", "max_tokens": 100,
                    "messages": [{"role": "user", "content": "hello"}]
                },
                "response": {"content": "hi"}
            });
            std::fs::write(
                session_dir.join("conversation.jsonl"),
                format!("{}\n", serde_json::to_string(&record).unwrap()),
            )
            .unwrap();

            let messages = load_session("test-session").unwrap();
            assert_eq!(messages.len(), 1);
        });
    }

    #[test]
    fn test_list_sessions_ignores_tmp_file() {
        crate::test_util::run_with_temp_home(|home| {
            let session_dir = create_session_dir(home, "clean-session");
            std::fs::write(session_dir.join("session.json.tmp"), "garbage").unwrap();
            write_session_json_to(
                &session_dir,
                serde_json::json!({
                    "session_id": "clean-session",
                    "started_at": "2026-06-14T12:00:00+08:00",
                }),
            );

            let sessions = list_sessions().unwrap();
            assert_eq!(sessions.len(), 1);
            assert_eq!(sessions[0].session_id, "clean-session");
        });
    }

    #[test]
    fn test_list_sessions_mixed_format_sorting() {
        crate::test_util::run_with_temp_home(|home| {
            let base = home.join(".zapmyco/sessions");
            for i in 0..3 {
                let dir = base.join(&format!("new-{}", i));
                std::fs::create_dir_all(&dir).unwrap();
                let meta = serde_json::json!({
                    "session_id": format!("new-{}", i),
                    "started_at": format!("2026-06-{:02}T12:00:00+08:00", 10 + i),
                });
                std::fs::write(
                    dir.join("session.json"),
                    serde_json::to_string(&meta).unwrap(),
                )
                .unwrap();
            }
            for i in 0..3 {
                let dir = base.join(&format!("old-{}", i));
                std::fs::create_dir_all(&dir).unwrap();
                let record = serde_json::json!({
                    "session_id": format!("old-{}", i), "order": 0,
                    "ts": format!("2026-06-{:02}T12:00:00+08:00", 10 + i),
                    "duration_ms": 100,
                    "request": {"model": "test", "messages": [], "max_tokens": 100},
                    "response": {"content": "ok"}
                });
                std::fs::write(
                    dir.join("conversation.jsonl"),
                    format!("{}\n", serde_json::to_string(&record).unwrap()),
                )
                .unwrap();
            }

            let sessions = list_sessions().unwrap();
            assert_eq!(sessions.len(), 6);
            for i in 0..5 {
                assert!(sessions[i].first_message_time >= sessions[i + 1].first_message_time);
            }
        });
    }
}
