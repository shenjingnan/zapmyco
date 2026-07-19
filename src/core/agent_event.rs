//! Agent 核心事件流。
//!
//! Core 层通过 `AgentEvent` 枚举向外输出所有状态变化。
//! Adapter 层消费这些事件来决定如何渲染/处理。
//! 例如：CLI Adapter 将 `TextChunk` 输出到终端，
//! Web Adapter 将事件转为 SSE 发送给浏览器。

/// Agent 核心事件
#[derive(Debug, Clone)]
pub enum AgentEvent {
    /// LLM 输出的文本片段（流式）
    TextChunk { delta: String },

    /// LLM 的思考过程（Extended Thinking）
    ThinkingChunk { delta: String },

    /// Agent 开始调用工具
    ToolInvocationStarted {
        id: String,
        name: String,
        input: serde_json::Value,
    },

    /// Agent 完成工具调用
    ToolInvocationFinished {
        id: String,
        result: Result<String, String>,
    },

    /// 一轮请求完成
    TurnFinished { tool_calls_count: usize },

    /// Token 用量统计
    TokenUsage {
        input_tokens: u32,
        output_tokens: u32,
        cache_read_tokens: Option<u32>,
        cache_creation_tokens: Option<u32>,
    },

    /// Agent 执行结束
    Finished { reason: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_text_chunk() {
        let event = AgentEvent::TextChunk {
            delta: "hello".to_string(),
        };
        match event {
            AgentEvent::TextChunk { delta } => assert_eq!(delta, "hello"),
            _ => panic!("unexpected event type"),
        }
    }

    #[test]
    fn test_thinking_chunk() {
        let event = AgentEvent::ThinkingChunk {
            delta: "thinking...".to_string(),
        };
        match event {
            AgentEvent::ThinkingChunk { delta } => assert_eq!(delta, "thinking..."),
            _ => panic!("unexpected event type"),
        }
    }

    #[test]
    fn test_tool_invocation() {
        let event = AgentEvent::ToolInvocationStarted {
            id: "call_1".to_string(),
            name: "file_read".to_string(),
            input: serde_json::json!({"file_path": "/tmp/test.txt"}),
        };
        match event {
            AgentEvent::ToolInvocationStarted { id, name, input } => {
                assert_eq!(id, "call_1");
                assert_eq!(name, "file_read");
                assert_eq!(input["file_path"], "/tmp/test.txt");
            }
            _ => panic!("unexpected event type"),
        }
    }

    #[test]
    fn test_tool_invocation_finished_ok() {
        let event = AgentEvent::ToolInvocationFinished {
            id: "call_1".to_string(),
            result: Ok("done".to_string()),
        };
        match event {
            AgentEvent::ToolInvocationFinished { id, result } => {
                assert_eq!(id, "call_1");
                assert!(result.is_ok());
                assert_eq!(result.unwrap(), "done");
            }
            _ => panic!("unexpected event type"),
        }
    }

    #[test]
    fn test_tool_invocation_finished_err() {
        let event = AgentEvent::ToolInvocationFinished {
            id: "call_1".to_string(),
            result: Err("failed".to_string()),
        };
        match event {
            AgentEvent::ToolInvocationFinished { id, result } => {
                assert_eq!(id, "call_1");
                assert!(result.is_err());
                assert_eq!(result.unwrap_err(), "failed");
            }
            _ => panic!("unexpected event type"),
        }
    }

    #[test]
    fn test_turn_finished() {
        let event = AgentEvent::TurnFinished {
            tool_calls_count: 3,
        };
        match event {
            AgentEvent::TurnFinished { tool_calls_count } => {
                assert_eq!(tool_calls_count, 3);
            }
            _ => panic!("unexpected event type"),
        }
    }

    #[test]
    fn test_token_usage() {
        let event = AgentEvent::TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: Some(10),
            cache_creation_tokens: None,
        };
        match event {
            AgentEvent::TokenUsage {
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens,
            } => {
                assert_eq!(input_tokens, 100);
                assert_eq!(output_tokens, 50);
                assert_eq!(cache_read_tokens, Some(10));
                assert_eq!(cache_creation_tokens, None);
            }
            _ => panic!("unexpected event type"),
        }
    }

    #[test]
    fn test_finished() {
        let event = AgentEvent::Finished {
            reason: "completed".to_string(),
        };
        match event {
            AgentEvent::Finished { reason } => {
                assert_eq!(reason, "completed");
            }
            _ => panic!("unexpected event type"),
        }
    }

    /// 验证事件实现了 Clone
    #[test]
    fn test_clone() {
        let event = AgentEvent::TextChunk {
            delta: "hello".to_string(),
        };
        let cloned = event.clone();
        match cloned {
            AgentEvent::TextChunk { delta } => assert_eq!(delta, "hello"),
            _ => panic!("unexpected event type"),
        }
    }
}
