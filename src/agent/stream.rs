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
    /// 正在收集 thinking 内容（ThinkingDelta）
    ThinkingBlock {
        buffer: String,
        signature: Option<String>,
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
    /// Thinking 内容（模型思考过程）
    pub thinking: Option<String>,
    /// API 耗时（毫秒）
    pub duration_ms: u64,
    /// 模型名称
    pub model: String,
    /// HTTP 状态码（SDK 改造后填充）
    pub http_status: Option<u16>,
    /// 剩余请求配额
    pub rate_limit_remaining: Option<u32>,
    /// 配额重置时间（Unix 时间戳）
    pub rate_limit_reset: Option<u64>,
}

/// 处理流式事件序列，返回解析结果（纯逻辑，可单元测试）
pub(crate) async fn process_stream_events<F: FnMut(&str), G: FnMut(&str)>(
    events: impl Stream<Item = Result<StreamEvent, String>>,
    on_chunk: &mut F,
    on_thinking_chunk: &mut G,
) -> Result<RoundResult, String> {
    let mut state = StreamParseState::Idle;
    let mut full_text = String::new();
    let mut tool_uses = Vec::new();
    let mut blocks = Vec::new();
    let mut input_tokens = 0u32;
    let mut output_tokens = 0u32;
    let mut cache_read = None;
    let mut cache_create = None;
    let mut thinking = None;
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
                ContentBlock::Thinking { thinking: th, signature } => {
                    state = StreamParseState::ThinkingBlock {
                        buffer: th.clone(),
                        signature: Some(signature),
                    };
                    if !th.is_empty() {
                        on_thinking_chunk(&th);
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
                ContentBlockDelta::ThinkingDelta { thinking: th } => {
                    if let StreamParseState::ThinkingBlock { ref mut buffer, .. } = state {
                        buffer.push_str(&th);
                        on_thinking_chunk(&th);
                    }
                }
                ContentBlockDelta::SignatureDelta { signature } => {
                    if let StreamParseState::ThinkingBlock {
                        signature: ref mut sig, ..
                    } = state
                    {
                        *sig = Some(signature);
                    }
                }
                _ => {}
            },
            StreamEvent::ContentBlockStop { .. } => {
                match std::mem::replace(&mut state, StreamParseState::Idle) {
                    StreamParseState::ToolUseBlock {
                        id,
                        name,
                        input_buffer,
                    } => {
                        let input: serde_json::Value = serde_json::from_str(&input_buffer)
                            .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));
                        blocks.push(ContentBlock::ToolUse {
                            id: id.clone(),
                            name: name.clone(),
                            input: input.clone(),
                        });
                        tool_uses.push((id, name, input));
                    }
                    StreamParseState::ThinkingBlock { buffer, .. } if !buffer.is_empty() => {
                        thinking = Some(buffer);
                    }
                    _ => {}
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

    // 重建 blocks（thinking 在 text 之前）
    if !full_text.is_empty() || thinking.is_some() {
        let mut ordered = Vec::new();
        if let Some(ref t) = thinking {
            ordered.push(ContentBlock::Thinking {
                thinking: t.clone(),
                signature: String::new(),
            });
        }
        if !full_text.is_empty() {
            ordered.push(ContentBlock::Text {
                text: full_text.clone(),
                citations: None,
            });
        }
        ordered.append(&mut blocks);
        blocks = ordered;
    }

    Ok(RoundResult {
        full_text,
        tool_uses,
        blocks,
        thinking,
        input_tokens,
        output_tokens,
        cache_read_input_tokens: cache_read,
        cache_creation_input_tokens: cache_create,
        duration_ms: 0,
        model,
        http_status: None,
        rate_limit_remaining: None,
        rate_limit_reset: None,
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

    // ── thinking 事件辅助构造器 ──

    fn thinking_start() -> StreamEvent {
        StreamEvent::ContentBlockStart {
            index: 0,
            content_block: ContentBlock::Thinking {
                thinking: String::new(),
                signature: String::new(),
            },
        }
    }

    fn thinking_start_with_content(content: &str) -> StreamEvent {
        StreamEvent::ContentBlockStart {
            index: 0,
            content_block: ContentBlock::Thinking {
                thinking: content.to_string(),
                signature: "test_sig".to_string(),
            },
        }
    }

    fn thinking_delta(text: &str) -> StreamEvent {
        StreamEvent::ContentBlockDelta {
            index: 0,
            delta: ContentBlockDelta::ThinkingDelta {
                thinking: text.to_string(),
            },
        }
    }

    fn signature_delta(sig: &str) -> StreamEvent {
        StreamEvent::ContentBlockDelta {
            index: 0,
            delta: ContentBlockDelta::SignatureDelta {
                signature: sig.to_string(),
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
        }, &mut |_| {})
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
        let result = process_stream_events(stream, &mut |c| chunks.push_str(c), &mut |_| {})
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
        let result = process_stream_events(stream, &mut |_| {}, &mut |_| {})
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
        let result = process_stream_events(stream, &mut |c| chunks.push_str(c), &mut |_| {})
            .await
            .expect("should succeed");

        assert_eq!(chunks, "Let me search...");
        assert_eq!(result.full_text, "Let me search...");
        assert_eq!(result.tool_uses.len(), 1);
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
        let result = process_stream_events(stream, &mut |_| {}, &mut |_| {})
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
        let result = process_stream_events(stream, &mut |_| {}, &mut |_| {})
            .await
            .expect("should succeed");

        assert_eq!(result.tool_uses.len(), 1);
    }

    #[tokio::test]
    async fn test_process_stream_events_error_event() {
        let events = vec![msg_start(10), error_event("rate limit", "rate_limit_error")];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let result = process_stream_events(stream, &mut |_| {}, &mut |_| {}).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("rate limit"));
    }

    #[tokio::test]
    async fn test_process_stream_events_stream_error() {
        let events: Vec<Result<StreamEvent, String>> =
            vec![Ok(msg_start(10)), Err("connection reset".to_string())];
        let stream = stream::iter(events);
        let result = process_stream_events(stream, &mut |_| {}, &mut |_| {}).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("connection reset"));
    }

    // ── 新增 thinking 测试 ──

    #[tokio::test]
    async fn test_thinking_plus_text() {
        let events = vec![
            msg_start(10),
            thinking_start(),
            thinking_delta("Let me think about this..."),
            thinking_delta("I need to be careful."),
            signature_delta("sig_abc"),
            block_stop(),
            text_delta("The answer is 42."),
            msg_delta(15, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let mut chunks = String::new();
        let mut thinking_chunks = Vec::new();
        let result = process_stream_events(
            stream,
            &mut |c| chunks.push_str(c),
            &mut |c| thinking_chunks.push(c.to_string()),
        )
        .await
        .expect("should succeed");

        assert_eq!(
            result.thinking.as_deref(),
            Some("Let me think about this...I need to be careful.")
        );
        assert_eq!(result.full_text, "The answer is 42.");
        assert_eq!(chunks, "The answer is 42.");
        assert_eq!(
            thinking_chunks,
            vec!["Let me think about this...", "I need to be careful."]
        );
        assert_eq!(result.blocks.len(), 2);
        assert!(matches!(result.blocks[0], ContentBlock::Thinking { .. }));
        assert!(matches!(result.blocks[1], ContentBlock::Text { .. }));
    }

    #[tokio::test]
    async fn test_thinking_plus_text_tool_use() {
        let events = vec![
            msg_start(10),
            thinking_start(),
            thinking_delta("I need to search."),
            signature_delta("sig_xyz"),
            block_stop(),
            text_delta("Let me search..."),
            tool_use_start("tu_1", "web_search"),
            json_delta(r#"{"q":"hello"}"#),
            block_stop(),
            msg_delta(15, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let result = process_stream_events(stream, &mut |_| {}, &mut |_| {})
            .await
            .expect("should succeed");

        assert_eq!(result.thinking.as_deref(), Some("I need to search."));
        assert_eq!(result.tool_uses.len(), 1);
        assert_eq!(result.blocks.len(), 3);
        assert!(matches!(result.blocks[0], ContentBlock::Thinking { .. }));
        assert!(matches!(result.blocks[1], ContentBlock::Text { .. }));
        assert!(matches!(result.blocks[2], ContentBlock::ToolUse { .. }));
    }

    #[tokio::test]
    async fn test_thinking_plus_multiple_tool_uses() {
        let events = vec![
            msg_start(10),
            thinking_start(),
            thinking_delta("I need to search and fetch."),
            signature_delta("sig_multi"),
            block_stop(),
            text_delta("Running tools..."),
            tool_use_start("tu_1", "web_search"),
            json_delta(r#"{"q":"hello"}"#),
            block_stop(),
            tool_use_start("tu_2", "web_fetch"),
            json_delta(r#"{"url":"example.com"}"#),
            block_stop(),
            msg_delta(15, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let result = process_stream_events(stream, &mut |_| {}, &mut |_| {})
            .await
            .expect("should succeed");

        assert_eq!(result.thinking.as_deref(), Some("I need to search and fetch."));
        assert_eq!(result.tool_uses.len(), 2);
        // blocks: [Thinking, Text, ToolUse, ToolUse]
        assert_eq!(result.blocks.len(), 4);
        assert!(matches!(result.blocks[0], ContentBlock::Thinking { .. }));
        assert!(matches!(result.blocks[1], ContentBlock::Text { .. }));
        assert!(matches!(result.blocks[2], ContentBlock::ToolUse { .. }));
        assert!(matches!(result.blocks[3], ContentBlock::ToolUse { .. }));
    }

    #[tokio::test]
    async fn test_thinking_complete_in_start() {
        let events = vec![
            msg_start(10),
            thinking_start_with_content("Already thought."),
            block_stop(),
            text_delta("Done."),
            msg_delta(5, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let mut thinking_chunks = Vec::new();
        let result = process_stream_events(
            stream,
            &mut |_| {},
            &mut |c| thinking_chunks.push(c.to_string()),
        )
        .await
        .expect("should succeed");

        assert_eq!(result.thinking.as_deref(), Some("Already thought."));
        assert_eq!(thinking_chunks, vec!["Already thought."]);
    }

    #[tokio::test]
    async fn test_thinking_empty() {
        let events = vec![
            msg_start(10),
            thinking_start(),
            block_stop(),
            text_delta("No thinking here."),
            msg_delta(5, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let result = process_stream_events(stream, &mut |_| {}, &mut |_| {})
            .await
            .expect("should succeed");

        assert!(result.thinking.is_none());
        assert_eq!(result.full_text, "No thinking here.");
    }

    #[tokio::test]
    async fn test_thinking_interrupted_by_error() {
        let events = vec![
            msg_start(10),
            thinking_start(),
            thinking_delta("I was thinking..."),
            error_event("rate limit", "rate_limit_error"),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let result = process_stream_events(stream, &mut |_| {}, &mut |_| {}).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_thinking_large_content() {
        let chunk_size = 10_000;
        let total_size = 100_000;
        let mut events = vec![msg_start(10), thinking_start()];
        let mut all_content = String::new();
        for _ in (0..total_size).step_by(chunk_size) {
            let chunk = "a".repeat(chunk_size);
            all_content.push_str(&chunk);
            events.push(thinking_delta(&chunk));
        }
        events.push(signature_delta("large_sig"));
        events.push(block_stop());
        events.push(text_delta("done."));
        events.push(msg_delta(5, None, None));
        events.push(msg_stop());

        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let mut received = 0usize;
        let result = process_stream_events(
            stream,
            &mut |_| {},
            &mut |c| received += c.len(),
        )
        .await
        .expect("large thinking should succeed");

        assert_eq!(result.thinking.as_deref(), Some(all_content.as_str()));
        assert_eq!(received, total_size);
        assert_eq!(result.thinking.unwrap().len(), total_size);
    }

    #[tokio::test]
    async fn test_signature_delta_without_thinking_block() {
        let events = vec![
            msg_start(10),
            text_delta("Hello"),
            StreamEvent::ContentBlockDelta {
                index: 0,
                delta: ContentBlockDelta::SignatureDelta {
                    signature: "orphan_sig".to_string(),
                },
            },
            msg_delta(5, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let result = process_stream_events(stream, &mut |_| {}, &mut |_| {})
            .await
            .expect("should not panic on orphan signature_delta");

        assert_eq!(result.full_text, "Hello");
        assert!(result.thinking.is_none());
    }

    #[tokio::test]
    async fn test_thinking_chinese_content() {
        let events = vec![
            msg_start(10),
            thinking_start(),
            thinking_delta("让我仔细思考这个问题..."),
            thinking_delta("首先需要分析边界条件。"),
            signature_delta("cn_sig"),
            block_stop(),
            text_delta("答案是 42。"),
            msg_delta(5, None, None),
            msg_stop(),
        ];
        let stream = stream::iter(events.into_iter().map(Ok::<_, String>));
        let mut thinking_chunks = Vec::new();
        let result = process_stream_events(
            stream,
            &mut |_| {},
            &mut |c| thinking_chunks.push(c.to_string()),
        )
        .await
        .expect("chinese thinking should succeed");

        assert_eq!(
            result.thinking.as_deref(),
            Some("让我仔细思考这个问题...首先需要分析边界条件。")
        );
        assert_eq!(thinking_chunks[0].chars().count(), 13);
    }
}

// ==================== RoundResult HTTP 字段测试 (P0-3-04) ====================

#[test]
fn test_round_result_http_fields_default_none() {
    use crate::agent::stream::RoundResult;
    let result = RoundResult {
        full_text: String::new(),
        tool_uses: vec![],
        blocks: vec![],
        thinking: None,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: None,
        cache_creation_input_tokens: None,
        duration_ms: 0,
        model: String::new(),
        http_status: None,
        rate_limit_remaining: None,
        rate_limit_reset: None,
    };
    assert!(result.http_status.is_none());
    assert!(result.rate_limit_remaining.is_none());
    assert!(result.rate_limit_reset.is_none());
}

#[test]
fn test_round_result_http_fields_with_values() {
    use crate::agent::stream::RoundResult;
    let result = RoundResult {
        full_text: "test".to_string(),
        tool_uses: vec![],
        blocks: vec![],
        thinking: None,
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: None,
        cache_creation_input_tokens: None,
        duration_ms: 100,
        model: "test".to_string(),
        http_status: Some(200),
        rate_limit_remaining: Some(42),
        rate_limit_reset: Some(1718000000),
    };
    assert_eq!(result.http_status, Some(200));
    assert_eq!(result.rate_limit_remaining, Some(42));
    assert_eq!(result.rate_limit_reset, Some(1718000000));
}
