//! Core 层适配器 — 将 `AgentEvent` 映射到现有的 `output::send()` 终端渲染。

use serde_json::Value;

use crate::output::{self, Message};
use zapmyco_core::AgentEvent;

// ============================================================================
// core_event_handler — 将 AgentEvent 映射到现有的 output::send()
// ============================================================================

use std::sync::atomic::{AtomicBool, Ordering};

/// 全局状态：是否已经输出过 thinking 内容
static HAS_THINKING: AtomicBool = AtomicBool::new(false);

/// 消费一个 AgentEvent，通过现有的 output::send() 渲染到终端
pub fn core_event_handler(event: &AgentEvent) {
    match event {
        AgentEvent::TextChunk { delta } => {
            if HAS_THINKING.swap(false, Ordering::Relaxed) {
                output::send(&Message::info(String::new()));
            }
            output::send(&Message::llm_chunk(delta));
        }
        AgentEvent::ThinkingChunk { delta } => {
            HAS_THINKING.store(true, Ordering::Relaxed);
            output::send(&Message::llm_thinking_delta(delta));
        }
        AgentEvent::ToolInvocationStarted { name, input, .. } => {
            let params = format_tool_params(name, input);
            output::send(&Message::tool_call("", name, vec![params]));
        }
        AgentEvent::ToolInvocationFinished { id: _, result } => match result {
            Ok(text) => {
                let preview = if text.len() > 200 {
                    let truncated: String = text.chars().take(200).collect();
                    format!("{} ...", truncated)
                } else {
                    text.clone()
                };
                output::send(&Message::info(format!("  ✅ {}", preview)));
            }
            Err(e) => {
                output::send(&Message::error(format!("  ❌ {}", e)));
            }
        },
        AgentEvent::TurnFinished { tool_calls_count } => {
            if *tool_calls_count > 0 {
                output::send(&Message::info(format!(
                    "  完成 {} 个工具调用",
                    tool_calls_count
                )));
            }
        }
        AgentEvent::TokenUsage {
            input_tokens,
            output_tokens,
            ..
        } => {
            output::send(&Message::llm_usage(
                *input_tokens as u64,
                *output_tokens as u64,
                0,
                0,
                0,
                None,
            ));
        }
        AgentEvent::Finished { reason } => {
            if reason != "completed" {
                output::send(&Message::info(format!("Agent 结束: {}", reason)));
            }
        }
    }
}

/// 格式化工具参数（简要单行描述）
fn format_tool_params(name: &str, input: &Value) -> String {
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
            if path.is_empty() {
                pattern.to_string()
            } else {
                format!("{}  in  {}", pattern, path)
            }
        }
        "file_write" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "file_edit" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "shell_exec" => input
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "web_fetch" => input
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "web_search" => input
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "ask_user" => input
            .get("question")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_params() {
        let input = serde_json::json!({"file_path": "/tmp/test.txt"});
        let result = format_tool_params("file_read", &input);
        assert_eq!(result, "/tmp/test.txt");
    }

    #[test]
    fn test_format_params_shell() {
        let input = serde_json::json!({"command": "ls -la"});
        let result = format_tool_params("shell_exec", &input);
        assert_eq!(result, "ls -la");
    }

    #[test]
    fn test_format_params_web_fetch() {
        let input = serde_json::json!({"url": "https://example.com"});
        let result = format_tool_params("web_fetch", &input);
        assert_eq!(result, "https://example.com");
    }

    #[test]
    fn test_event_handler_text_chunk() {
        let event = AgentEvent::TextChunk {
            delta: "hello".to_string(),
        };
        core_event_handler(&event);
    }

    #[test]
    fn test_event_handler_tool_start() {
        let event = AgentEvent::ToolInvocationStarted {
            id: "call_1".to_string(),
            name: "file_read".to_string(),
            input: serde_json::json!({"file_path": "/tmp/test.txt"}),
        };
        core_event_handler(&event);
    }

    #[test]
    fn test_event_handler_token_usage() {
        let event = AgentEvent::TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: None,
            cache_creation_tokens: None,
        };
        core_event_handler(&event);
    }

    #[test]
    fn test_event_handler_finished() {
        let event = AgentEvent::Finished {
            reason: "completed".to_string(),
        };
        core_event_handler(&event);
    }
}
