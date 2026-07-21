//! Core 层适配器 — 桥接现有系统与 Core 层。
//!
//! 提供两样东西：
//! 1. `LegacyToolAdapter` — 将现有 `ToolHandler` enum 包装为 `AgentTool` trait
//! 2. `core_event_handler()` — 将 `AgentEvent` 映射到现有的 `output::send()`

use async_trait::async_trait;
use serde_json::Value;

use crate::agent::chat::ToolHandler;
use crate::output::{self, Message};
use zapmyco_core::{AgentEvent, AgentTool};

// ============================================================================
// LegacyToolAdapter — 将现有 ToolHandler 包装为 AgentTool
// ============================================================================

/// 将现有 `ToolHandler` 包装为 `AgentTool` trait 实现
///
/// 这样所有 16 种现有工具都可以通过 Core 层使用，无需重写。
pub struct LegacyToolAdapter {
    inner: ToolHandler,
    cached_name: String,
    cached_description: String,
    cached_schema: Value,
}

impl LegacyToolAdapter {
    /// 包装一个现有的 `ToolHandler`
    pub fn new(handler: ToolHandler) -> Self {
        let def = handler.tool_definition();
        Self {
            cached_name: def.name.clone(),
            cached_description: def.description.unwrap_or_default(),
            cached_schema: def.input_schema.unwrap_or_default(),
            inner: handler,
        }
    }
}

#[async_trait]
impl AgentTool for LegacyToolAdapter {
    fn name(&self) -> &str {
        &self.cached_name
    }

    fn description(&self) -> &str {
        &self.cached_description
    }

    fn input_schema(&self) -> Value {
        self.cached_schema.clone()
    }

    async fn execute(&self, input: Value) -> Result<String, String> {
        self.inner.execute(&input).await
    }
}

/// 批量转换 `Vec<ToolHandler>` 为 `Vec<Box<dyn AgentTool>>`
pub fn from_tool_handlers(handlers: Vec<ToolHandler>) -> Vec<Box<dyn AgentTool>> {
    handlers
        .into_iter()
        .map(|h| Box::new(LegacyToolAdapter::new(h)) as Box<dyn AgentTool>)
        .collect()
}

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

    fn make_file_read() -> ToolHandler {
        ToolHandler::FileRead(crate::tools::file_read::FileRead::new(
            crate::tools::file_read::FileReadOptions::default(),
        ))
    }

    fn make_file_write() -> ToolHandler {
        ToolHandler::FileWrite(crate::tools::file_write::FileWrite::new(
            crate::tools::file_write::FileWriteOptions {},
        ))
    }

    #[test]
    fn test_adapter_file_read() {
        let adapter = LegacyToolAdapter::new(make_file_read());
        assert_eq!(adapter.name(), "file_read");
        assert!(!adapter.description().is_empty());
        let schema = adapter.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema.get("properties").is_some());
    }

    #[test]
    fn test_adapter_shell_exec() {
        let tool = crate::tools::shell_exec::ShellExec::new(
            crate::tools::shell_exec::ShellExecOptions::default(),
        );
        let adapter = LegacyToolAdapter::new(ToolHandler::ShellExec(tool));
        assert_eq!(adapter.name(), "shell_exec");
        assert!(!adapter.description().is_empty());
    }

    #[test]
    fn test_adapter_file_write() {
        let adapter = LegacyToolAdapter::new(make_file_write());
        assert_eq!(adapter.name(), "file_write");
        assert!(!adapter.description().is_empty());
    }

    #[test]
    fn test_from_tool_handlers() {
        let handlers = vec![make_file_read(), make_file_write()];
        let tools = from_tool_handlers(handlers);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name(), "file_read");
        assert_eq!(tools[1].name(), "file_write");
    }

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
