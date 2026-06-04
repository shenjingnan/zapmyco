//! 流式事件处理模块
//!
//! 提供流式 API 响应的事件解析逻辑，将 `StreamEvent` 序列解析为
//! `RoundResult`（文本 + 工具调用），以及流处理状态机 `StreamParseState`。

use futures_util::{Stream, StreamExt};
use zapmyco_anthropic_ai_sdk::types::message::{ContentBlock, ContentBlockDelta, StreamEvent};

/// 流式响应解析状态机
enum StreamParseState {
    /// 不在任何 content block 中
    Idle,
    /// 正在收集文本（TextDelta）
    TextBlock,
    /// 正在收集工具调用的 JSON 参数（InputJsonDelta）
    ToolUseBlock {
        id: String,
        name: String,
        input_buffer: String,
    },
}

/// 一轮流式请求的结果
#[derive(Debug)]
pub(crate) struct RoundResult {
    /// 从 text blocks 拼接的完整文本
    pub full_text: String,
    /// 收集到的工具调用列表 (id, name, input)
    pub tool_uses: Vec<(String, String, serde_json::Value)>,
    /// 按原始顺序重建的 ContentBlock 列表（用于对话历史记录）
    pub blocks: Vec<ContentBlock>,
    /// input token 数
    pub input_tokens: u32,
    /// output token 数
    pub output_tokens: u32,
    /// cache read tokens
    pub cache_read_input_tokens: Option<u32>,
    /// cache creation tokens
    pub cache_creation_input_tokens: Option<u32>,
    /// API 耗时（毫秒）
    pub duration_ms: u64,
    /// 模型名称
    pub model: String,
}

/// 处理流式事件序列，返回解析结果（纯逻辑，可单元测试）
pub(crate) async fn process_stream_events(
    events: impl Stream<Item = Result<StreamEvent, String>>,
    on_chunk: &mut dyn FnMut(&str),
) -> Result<RoundResult, String> {
    let mut state = StreamParseState::Idle;
    let mut full_text = String::new();
    let mut tool_uses = Vec::new();
    let mut blocks = Vec::new();
    let mut input_tokens = 0u32;
    let mut output_tokens = 0u32;
    let mut cache_read = None;
    let mut cache_create = None;
    let mut model = String::new();

    let mut stream = std::pin::pin!(events);
    while let Some(event) = stream.next().await {
        let event = event?;
        match event {
            StreamEvent::MessageStart { message } => {
                input_tokens = message.usage.input_tokens;
                model = message.model;
            }
            StreamEvent::ContentBlockStart { content_block, .. } => match content_block {
                ContentBlock::Text { .. } => {
                    state = StreamParseState::TextBlock;
                }
                ContentBlock::ToolUse { id, name, input } => {
                    // 判断 ContentBlockStart 是否已包含完整参数
                    let has_full_input =
                        input.is_object() && input.as_object().is_some_and(|m| !m.is_empty());
                    if has_full_input {
                        // API 直接在 ContentBlockStart 中提供了完整参数
                        blocks.push(ContentBlock::ToolUse {
                            id: id.clone(),
                            name: name.clone(),
                            input: input.clone(),
                        });
                        tool_uses.push((id, name, input));
                    // state 保持 Idle，ContentBlockStop 跳过
                    } else {
                        // ContentBlockStart 中 input 为空占位符，
                        // 等待 InputJsonDelta 增量到达
                        state = StreamParseState::ToolUseBlock {
                            id,
                            name,
                            input_buffer: String::new(),
                        };
                    }
                }
                _ => {}
            },
            StreamEvent::ContentBlockDelta { delta, .. } => match delta {
                ContentBlockDelta::TextDelta { text } => {
                    full_text.push_str(&text);
                    on_chunk(&text);
                }
                ContentBlockDelta::InputJsonDelta { partial_json } => {
                    if let StreamParseState::ToolUseBlock {
                        ref mut input_buffer,
                        ..
                    } = state
                    {
                        input_buffer.push_str(&partial_json);
                    }
                }
                _ => {}
            },
            StreamEvent::ContentBlockStop { .. } => {
                if let StreamParseState::ToolUseBlock {
                    id,
                    name,
                    input_buffer,
                } = std::mem::replace(&mut state, StreamParseState::Idle)
                {
                    let input: serde_json::Value = serde_json::from_str(&input_buffer)
                        .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));
                    blocks.push(ContentBlock::ToolUse {
                        id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                    });
                    tool_uses.push((id, name, input));
                }
            }
            StreamEvent::MessageDelta { usage: Some(u), .. } => {
                output_tokens = u.output_tokens;
                cache_read = u.cache_read_input_tokens;
                cache_create = u.cache_creation_input_tokens;
            }
            StreamEvent::MessageStop => {
                break;
            }
            StreamEvent::Error { error } => {
                return Err(format!("API 流式错误: {} ({})", error.message, error.type_));
            }
            _ => {}
        }
    }

    // 在 blocks 开头插入 Text block（如果存在文本内容）
    if !full_text.is_empty() {
        blocks.insert(
            0,
            ContentBlock::Text {
                text: full_text.clone(),
                citations: None,
            },
        );
    }

    Ok(RoundResult {
        full_text,
        tool_uses,
        blocks,
        input_tokens,
        output_tokens,
        cache_read_input_tokens: cache_read,
        cache_creation_input_tokens: cache_create,
        duration_ms: 0,
        model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::stream;
    use zapmyco_anthropic_ai_sdk::types::message::{
        ContentBlockDelta, MessageDeltaContent, MessageStartContent, Role, StopReason, StreamError,
        StreamUsage, Usage,
    };

    /// 辅助：构造一个 MessageStart event
    fn msg_start(input_tokens: u32) -> StreamEvent {
        StreamEvent::MessageStart {
            message: MessageStartContent {
                id: "msg_test".to_string(),
                model: "test-model".to_string(),
                role: Role::Assistant,
                content: Vec::new(),
                usage: Usage {
                    input_tokens,
                    output_tokens: 0,
                    cache_creation_input_tokens: None,
                    cache_read_input_tokens: None,
                    cache_creation: None,
                    output_tokens_details: None,
                    inference_geo: None,
                    service_tier: None,
                    server_tool_use: None,
                },
                stop_reason: None,
                stop_sequence: None,
                type_: "message".to_string(),
                container: None,
                stop_details: None,
            },
        }
    }

    /// 辅助：构造一个 TextDelta event
    fn text_delta(text: &str) -> StreamEvent {
        StreamEvent::ContentBlockDelta {
            index: 0,
            delta: ContentBlockDelta::TextDelta {
                text: text.to_string(),
            },
        }
    }

    /// 辅助：构造 ToolUse ContentBlockStart（空 input — 需要 InputJsonDelta 后续到达）
    fn tool_use_start(id: &str, name: &str) -> StreamEvent {
        StreamEvent::ContentBlockStart {
            index: 0,
            content_block: ContentBlock::ToolUse {
                id: id.to_string(),
                name: name.to_string(),
                input: serde_json::Value::Object(serde_json::Map::new()),
            },
        }
    }

    /// 辅助：构造 ToolUse ContentBlockStart（完整 input）
    fn tool_use_start_full(id: &str, name: &str, input: serde_json::Value) -> StreamEvent {
        StreamEvent::ContentBlockStart {
            index: 0,
            content_block: ContentBlock::ToolUse {
                id: id.to_string(),
                name: name.to_string(),
                input,
            },
        }
    }

    /// 辅助：构造 InputJsonDelta
    fn json_delta(json: &str) -> StreamEvent {
        StreamEvent::ContentBlockDelta {
            index: 0,
            delta: ContentBlockDelta::InputJsonDelta {
                partial_json: json.to_string(),
            },
        }
    }

    /// 辅助：构造 ContentBlockStop
    fn block_stop() -> StreamEvent {
        StreamEvent::ContentBlockStop { index: 0 }
    }

    /// 辅助：构造 MessageDelta（含用量）
    fn msg_delta(
        output_tokens: u32,
        cache_read: Option<u32>,
        cache_create: Option<u32>,
    ) -> StreamEvent {
        StreamEvent::MessageDelta {
            delta: MessageDeltaContent {
                stop_reason: None,
                stop_sequence: None,
            },
            usage: Some(StreamUsage {
                input_tokens: 0,
                output_tokens,
                cache_read_input_tokens: cache_read,
                cache_creation_input_tokens: cache_create,
                output_tokens_details: None,
                server_tool_use: None,
            }),
        }
    }

    fn msg_stop() -> StreamEvent {
        StreamEvent::MessageStop
    }

    fn error_event(msg: &str, err_type: &str) -> StreamEvent {
        StreamEvent::Error {
            error: StreamError {
                type_: err_type.to_string(),
                message: msg.to_string(),
            },
        }
    }

    #[tokio::test]
    async fn test_process_stream_events_plain_text() {
        let events = vec![
            msg_start(10),
            text_delta("Hello"),
            text_delta(" World"),
            msg_delta(5, Some(100), Some(50)),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let mut chunks = String::new();
        let result = process_stream_events(stream, &mut |chunk| {
            chunks.push_str(chunk);
        })
        .await
        .expect("process_stream_events should succeed");

        assert_eq!(result.full_text, "Hello World");
        assert_eq!(chunks, "Hello World");
        assert_eq!(result.input_tokens, 10);
        assert_eq!(result.output_tokens, 5);
        assert_eq!(result.cache_read_input_tokens, Some(100));
        assert_eq!(result.cache_creation_input_tokens, Some(50));
        assert!(result.tool_uses.is_empty());
        assert!(!result.blocks.is_empty());
    }

    #[tokio::test]
    async fn test_process_stream_events_tool_use_input_json_delta() {
        let events = vec![
            msg_start(10),
            tool_use_start("tu_1", "web_search"),
            json_delta(r##"{"query":"##),
            json_delta(r#""hello"}"#),
            block_stop(),
            msg_delta(5, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let mut chunks = String::new();
        let result = process_stream_events(stream, &mut |c| chunks.push_str(c))
            .await
            .expect("should succeed");

        assert!(chunks.is_empty(), "工具调用不应产生文本块");
        assert_eq!(result.tool_uses.len(), 1);
        assert_eq!(result.tool_uses[0].0, "tu_1");
        assert_eq!(result.tool_uses[0].1, "web_search");
        assert_eq!(result.tool_uses[0].2, serde_json::json!({"query": "hello"}));
    }

    #[tokio::test]
    async fn test_process_stream_events_tool_use_full_input_in_start() {
        let input = serde_json::json!({"query": "hello"});
        let events = vec![
            msg_start(10),
            tool_use_start_full("tu_1", "web_search", input.clone()),
            block_stop(),
            msg_delta(5, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let result = process_stream_events(stream, &mut |_| {})
            .await
            .expect("should succeed");

        assert_eq!(result.tool_uses.len(), 1);
        assert_eq!(result.tool_uses[0].0, "tu_1");
        assert_eq!(result.tool_uses[0].1, "web_search");
        assert_eq!(result.tool_uses[0].2, input);
    }

    #[tokio::test]
    async fn test_process_stream_events_mixed_text_and_tool() {
        let events = vec![
            msg_start(10),
            text_delta("Let me search..."),
            tool_use_start("tu_1", "web_search"),
            json_delta(r#"{"q":"rust"}"#),
            block_stop(),
            msg_delta(5, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let mut chunks = String::new();
        let result = process_stream_events(stream, &mut |c| chunks.push_str(c))
            .await
            .expect("should succeed");

        assert_eq!(chunks, "Let me search...");
        assert_eq!(result.full_text, "Let me search...");
        assert_eq!(result.tool_uses.len(), 1);
        // blocks 应包含 text + tool_use
        assert!(result.blocks.len() >= 2);
    }

    #[tokio::test]
    async fn test_process_stream_events_multiple_tools() {
        let events = vec![
            msg_start(10),
            text_delta("Running tools..."),
            tool_use_start("tu_1", "web_search"),
            json_delta(r#"{"q":"a"}"#),
            block_stop(),
            tool_use_start("tu_2", "web_fetch"),
            json_delta(r#"{"url":"b"}"#),
            block_stop(),
            msg_delta(5, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let result = process_stream_events(stream, &mut |_| {})
            .await
            .expect("should succeed");

        assert_eq!(result.tool_uses.len(), 2);
        assert_eq!(result.tool_uses[0].1, "web_search");
        assert_eq!(result.tool_uses[1].1, "web_fetch");
    }

    #[tokio::test]
    async fn test_process_stream_events_empty_input_json_delta() {
        let events = vec![
            msg_start(10),
            tool_use_start("tu_1", "web_search"),
            json_delta(""),
            json_delta(r#"{"q":"hi"}"#),
            block_stop(),
            msg_delta(5, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let result = process_stream_events(stream, &mut |_| {})
            .await
            .expect("should succeed");

        assert_eq!(result.tool_uses.len(), 1);
    }

    #[tokio::test]
    async fn test_process_stream_events_error_event() {
        let events = vec![msg_start(10), error_event("rate limit", "rate_limit_error")];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let result = process_stream_events(stream, &mut |_| {}).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("rate limit"));
    }

    #[tokio::test]
    async fn test_process_stream_events_stream_error() {
        let events: Vec<Result<StreamEvent, String>> =
            vec![Ok(msg_start(10)), Err("connection reset".to_string())];
        let stream = stream::iter(events);
        let result = process_stream_events(stream, &mut |_| {}).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("connection reset"));
    }
}
