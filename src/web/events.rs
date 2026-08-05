//! AgentEvent → Web SSE StreamEvent 适配器（纯函数，可单测）。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use zapmyco_core::AgentEvent;

use super::chat::StreamEvent;
use super::tools::parse_working_dir;

/// 将 Core 的 AgentEvent 映射为 Web 的 StreamEvent 序列。
///
/// 说明：
/// - `Finished` 不在此映射 — 由外层按 `agent_loop` 返回值统一发一次 `Done`，避免重复。
/// - `TurnFinished` / `TokenUsage` 无对应 SSE 事件（与旧实现一致），忽略。
/// - `ToolInvocationFinished` 若结果含 "Working directory:" 首行，同时产出
///   `CurrentDir` 并更新共享 cwd。
pub(crate) fn agent_event_to_stream_event(
    event: &AgentEvent,
    cwd: &Arc<Mutex<PathBuf>>,
) -> Vec<StreamEvent> {
    match event {
        AgentEvent::TextChunk { delta } => vec![StreamEvent::TextDelta {
            content: delta.clone(),
        }],
        AgentEvent::ThinkingChunk { delta } => vec![StreamEvent::ThinkingDelta {
            content: delta.clone(),
        }],
        AgentEvent::ToolInvocationStarted { id, .. } => vec![StreamEvent::ToolProgress {
            id: id.clone(),
            status: "running".to_string(),
        }],
        AgentEvent::ToolInvocationFinished { id, result } => match result {
            Ok(text) => {
                let mut out = vec![];
                if let Some(path) = parse_working_dir(text) {
                    *cwd.lock().unwrap() = PathBuf::from(&path);
                    out.push(StreamEvent::CurrentDir { path });
                }
                out.push(StreamEvent::ToolResult {
                    id: id.clone(),
                    content: text.clone(),
                });
                out
            }
            Err(e) => vec![StreamEvent::ToolResult {
                id: id.clone(),
                content: format!("failed: {e}"),
            }],
        },
        AgentEvent::TurnFinished { .. }
        | AgentEvent::TokenUsage { .. }
        | AgentEvent::Finished { .. } => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zapmyco_core::AgentEvent;

    fn make_cwd() -> Arc<Mutex<PathBuf>> {
        Arc::new(Mutex::new(PathBuf::from("/start")))
    }

    #[test]
    fn test_text_chunk() {
        let cwd = make_cwd();
        let events = agent_event_to_stream_event(
            &AgentEvent::TextChunk {
                delta: "hello".to_string(),
            },
            &cwd,
        );
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0],
            StreamEvent::TextDelta { content } if content == "hello"
        ));
    }

    #[test]
    fn test_thinking_chunk() {
        let cwd = make_cwd();
        let events = agent_event_to_stream_event(
            &AgentEvent::ThinkingChunk {
                delta: "think".to_string(),
            },
            &cwd,
        );
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0],
            StreamEvent::ThinkingDelta { content } if content == "think"
        ));
    }

    #[test]
    fn test_tool_started() {
        let cwd = make_cwd();
        let events = agent_event_to_stream_event(
            &AgentEvent::ToolInvocationStarted {
                id: "call_1".to_string(),
                name: "file_read".to_string(),
                input: serde_json::json!({"file_path": "/tmp/x"}),
            },
            &cwd,
        );
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0],
            StreamEvent::ToolProgress { id, status } if id == "call_1" && status == "running"
        ));
    }

    #[test]
    fn test_tool_finished_ok() {
        let cwd = make_cwd();
        let events = agent_event_to_stream_event(
            &AgentEvent::ToolInvocationFinished {
                id: "call_1".to_string(),
                result: Ok("file content".to_string()),
            },
            &cwd,
        );
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0],
            StreamEvent::ToolResult { id, content } if id == "call_1" && content == "file content"
        ));
        // 无 Working directory 首行 → cwd 不变
        assert_eq!(cwd.lock().unwrap().to_string_lossy(), "/start");
    }

    #[test]
    fn test_tool_finished_with_cwd() {
        let cwd = make_cwd();
        let text = "Working directory: /tmp/test\n\nExit code: 0\n\n--- STDOUT ---\n...";
        let events = agent_event_to_stream_event(
            &AgentEvent::ToolInvocationFinished {
                id: "call_1".to_string(),
                result: Ok(text.to_string()),
            },
            &cwd,
        );
        // 产出 CurrentDir + ToolResult 两个事件
        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[0],
            StreamEvent::CurrentDir { path } if path == "/tmp/test"
        ));
        // cwd 已更新
        assert_eq!(cwd.lock().unwrap().to_string_lossy(), "/tmp/test");
    }

    #[test]
    fn test_tool_finished_err() {
        let cwd = make_cwd();
        let events = agent_event_to_stream_event(
            &AgentEvent::ToolInvocationFinished {
                id: "call_1".to_string(),
                result: Err("boom".to_string()),
            },
            &cwd,
        );
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0],
            StreamEvent::ToolResult { content, .. } if content == "failed: boom"
        ));
    }

    #[test]
    fn test_ignored_events() {
        let cwd = make_cwd();
        assert!(
            agent_event_to_stream_event(
                &AgentEvent::Finished {
                    reason: "completed".to_string(),
                },
                &cwd
            )
            .is_empty()
        );
        assert!(
            agent_event_to_stream_event(
                &AgentEvent::TurnFinished {
                    tool_calls_count: 0,
                },
                &cwd
            )
            .is_empty()
        );
        assert!(
            agent_event_to_stream_event(
                &AgentEvent::TokenUsage {
                    input_tokens: 1,
                    output_tokens: 1,
                    cache_read_tokens: None,
                    cache_creation_tokens: None,
                },
                &cwd
            )
            .is_empty()
        );
    }
}
