//! Agent 核心循环 — 输入 → LLM → 工具 → 循环 → 事件。
//!
//! 这是 zapmyco Core 层的核心：一个与环境无关的 ReAct 循环。
//! 所有 I/O（配置来源、输出渲染、日志）由 Adapter 层处理。

use std::sync::Arc;

use futures_util::StreamExt;
use serde_json::Value;
use tokio::sync::mpsc;

use zapmyco_anthropic_ai_sdk::client::AnthropicClient;
use zapmyco_anthropic_ai_sdk::types::message::{
    self as sdk, ContentBlock, ContentBlockDelta, CreateMessageParams, MessageClient, MessageError,
    RequiredMessageParams, StreamEvent, Tool,
};

use crate::core::{AgentConfig, AgentError, AgentEvent, ConversationMessage, MessageBlock, Role};

// ============================================================================
// 公共 API
// ============================================================================

/// 运行 Agent 核心循环
///
/// 接收用户输入，驱动 ReAct 循环（推理→工具调用→继续/结束），
/// 通过 `event_tx` 发出事件，输出对话历史。
///
/// # 参数
/// - `config`: Agent 配置（模型、工具等）
/// - `messages`: 对话历史（传入传出，调用后包含新增的轮次）
/// - `user_input`: 用户输入
/// - `event_tx`: 事件发送端
pub async fn agent_loop(
    config: Arc<AgentConfig>,
    messages: &mut Vec<ConversationMessage>,
    user_input: impl Into<String>,
    event_tx: mpsc::Sender<AgentEvent>,
) -> Result<(), AgentError> {
    let user_input = user_input.into();
    messages.push(ConversationMessage::user(&user_input));

    // ── 创建 SDK 客户端 ──
    let client = AnthropicClient::builder(&config.api_key, &config.api_version)
        .with_api_base_url(&config.base_url)
        .build::<MessageError>()
        .map_err(|e| AgentError::Api(e.to_string()))?;

    // ── 核心 ReAct 循环 ──
    for _round in 0..config.max_tool_rounds {
        // ── 构建工具定义（每次重建，避免 Clone 约束） ──
        let tool_defs: Vec<Tool> = config
            .tools
            .iter()
            .map(|t| Tool {
                name: t.name().to_string(),
                description: Some(t.description().to_string()),
                input_schema: Some(t.input_schema()),
                tool_type: None,
                max_uses: None,
                allowed_domains: None,
                blocked_domains: None,
            })
            .collect();

        let sdk_messages = convert_messages_to_sdk(messages);

        let mut params = CreateMessageParams::new(RequiredMessageParams {
            model: config.model.clone(),
            messages: sdk_messages,
            max_tokens: config.max_tokens,
        })
        .with_stream(true)
        .with_system(&config.system_prompt);

        if !tool_defs.is_empty() {
            params = params.with_tools(tool_defs);
        }

        // ── 发送请求并处理流式响应 ──
        let stream = client
            .create_message_streaming(&params)
            .await
            .map_err(|e| AgentError::Api(e.to_string()))?;

        let round = process_stream(stream, &event_tx).await?;

        // ── 添加助手响应到对话历史 ──
        let assistant_msg = build_assistant_message(&round);
        messages.push(assistant_msg);

        // 发送 Token 用量
        send_event(
            &event_tx,
            AgentEvent::TokenUsage {
                input_tokens: round.input_tokens,
                output_tokens: round.output_tokens,
                cache_read_tokens: None,
                cache_creation_tokens: None,
            },
        )
        .await;

        // ── 没有工具调用 → 结束 ──
        if round.tool_uses.is_empty() {
            send_event(
                &event_tx,
                AgentEvent::TurnFinished {
                    tool_calls_count: 0,
                },
            )
            .await;
            send_event(
                &event_tx,
                AgentEvent::Finished {
                    reason: "completed".into(),
                },
            )
            .await;
            return Ok(());
        }

        // ── 执行所有工具调用 ──
        // 先收集所有工具结果，再合并为一条消息（Anthropic API 要求同一轮的
        // 所有 tool_result 必须在同一条 user 消息中）
        let mut tool_result_blocks = Vec::new();
        let mut combined_content = String::new();

        for (tool_id, tool_name, tool_input) in &round.tool_uses {
            send_event(
                &event_tx,
                AgentEvent::ToolInvocationStarted {
                    id: tool_id.clone(),
                    name: tool_name.clone(),
                    input: tool_input.clone(),
                },
            )
            .await;

            let result = match config.tools.iter().find(|t| t.name() == tool_name) {
                Some(tool) => tool.execute(tool_input.clone()).await,
                None => Err(format!("未知工具: {}", tool_name)),
            };

            let (output, is_error) = match &result {
                Ok(text) => (text.clone(), false),
                Err(e) => (format!("错误: {}", e), true),
            };

            send_event(
                &event_tx,
                AgentEvent::ToolInvocationFinished {
                    id: tool_id.clone(),
                    result: result.clone(),
                },
            )
            .await;

            tool_result_blocks.push(MessageBlock::ToolResult {
                id: tool_id.clone(),
                content: output.clone(),
                is_error,
            });
            if !combined_content.is_empty() {
                combined_content.push('\n');
            }
            combined_content.push_str(&output);
        }

        // 所有工具结果合并为一条消息
        messages.push(ConversationMessage::with_blocks(
            Role::Tool,
            &combined_content,
            tool_result_blocks,
        ));

        send_event(
            &event_tx,
            AgentEvent::TurnFinished {
                tool_calls_count: round.tool_uses.len(),
            },
        )
        .await;
    }

    // 超出最大轮次
    send_event(
        &event_tx,
        AgentEvent::Finished {
            reason: "max_tool_rounds".into(),
        },
    )
    .await;

    Err(AgentError::MaxRoundsReached)
}

// ============================================================================
// 内部辅助函数
// ============================================================================

/// 流式响应解析结果
struct RoundOutput {
    full_text: String,
    tool_uses: Vec<(String, String, Value)>,
    input_tokens: u32,
    output_tokens: u32,
    thinking: Option<String>,
}

/// 处理流式响应，发出文本块/思考块事件，收集工具调用
async fn process_stream<S>(
    stream: S,
    event_tx: &mpsc::Sender<AgentEvent>,
) -> Result<RoundOutput, AgentError>
where
    S: futures_util::Stream<Item = Result<StreamEvent, MessageError>>,
{
    let mut full_text = String::new();
    let mut tool_uses: Vec<(String, String, Value)> = Vec::new();
    let mut input_tokens: u32 = 0;
    let mut output_tokens: u32 = 0;
    let mut thinking: Option<String> = None;
    let mut current_tool_id = String::new();
    let mut current_tool_name = String::new();
    let mut current_tool_input = String::new();
    let mut current_thinking = String::new();
    let mut in_thinking = false;

    let mut stream = std::pin::pin!(stream);

    while let Some(event) = stream.next().await {
        let event = event.map_err(|e| AgentError::Api(e.to_string()))?;
        match event {
            StreamEvent::MessageStart { message } => {
                input_tokens = message.usage.input_tokens;
            }
            StreamEvent::ContentBlockStart { content_block, .. } => match content_block {
                ContentBlock::Text { .. } => {}
                ContentBlock::ToolUse { id, name, input } => {
                    if input.is_object() && input.as_object().is_some_and(|m| !m.is_empty()) {
                        tool_uses.push((id, name, input));
                    } else {
                        current_tool_id = id;
                        current_tool_name = name;
                        current_tool_input.clear();
                    }
                }
                ContentBlock::Thinking {
                    thinking: t,
                    signature: _sig,
                } => {
                    in_thinking = true;
                    current_thinking = t;
                }
                ContentBlock::RedactedThinking { data } => {
                    in_thinking = true;
                    current_thinking = data;
                }
                _ => {}
            },
            StreamEvent::ContentBlockDelta { delta, .. } => match delta {
                ContentBlockDelta::TextDelta { text } => {
                    full_text.push_str(&text);
                    send_event(event_tx, AgentEvent::TextChunk { delta: text }).await;
                }
                ContentBlockDelta::InputJsonDelta { partial_json } => {
                    current_tool_input.push_str(&partial_json);
                }
                ContentBlockDelta::ThinkingDelta { thinking: t } => {
                    current_thinking.push_str(&t);
                    send_event(event_tx, AgentEvent::ThinkingChunk { delta: t }).await;
                }
                _ => {}
            },
            StreamEvent::ContentBlockStop { .. } => {
                if !current_tool_id.is_empty() && !current_tool_name.is_empty() {
                    if let Ok(input) = serde_json::from_str(&current_tool_input) {
                        tool_uses.push((current_tool_id.clone(), current_tool_name.clone(), input));
                    }
                    current_tool_id.clear();
                    current_tool_name.clear();
                    current_tool_input.clear();
                }
                if in_thinking {
                    in_thinking = false;
                    thinking = Some(std::mem::take(&mut current_thinking));
                }
            }
            StreamEvent::MessageDelta { delta: _, usage } => {
                if let Some(usage) = usage {
                    output_tokens = usage.output_tokens;
                }
            }
            StreamEvent::MessageStop => {
                break;
            }
            StreamEvent::Error { error } => {
                return Err(AgentError::Api(format!(
                    "{}: {}",
                    error.type_, error.message
                )));
            }
            StreamEvent::Ping => {}
        }
    }

    Ok(RoundOutput {
        full_text,
        tool_uses,
        input_tokens,
        output_tokens,
        thinking,
    })
}

/// 将 RoundOutput 构建为 Assistant 消息
fn build_assistant_message(round: &RoundOutput) -> ConversationMessage {
    if round.tool_uses.is_empty() {
        ConversationMessage::assistant(&round.full_text)
    } else {
        let mut blocks = Vec::new();
        if !round.full_text.is_empty() {
            blocks.push(MessageBlock::Text(round.full_text.clone()));
        }
        for (id, name, input) in &round.tool_uses {
            blocks.push(MessageBlock::ToolUse {
                id: id.clone(),
                name: name.clone(),
                input: input.clone(),
            });
        }
        ConversationMessage::with_blocks(Role::Assistant, &round.full_text, blocks)
    }
}

/// 将 Core 消息格式转换为 SDK 消息格式
fn convert_messages_to_sdk(messages: &[ConversationMessage]) -> Vec<sdk::Message> {
    messages
        .iter()
        .map(|msg| {
            let role = match msg.role {
                Role::User => sdk::Role::User,
                Role::Assistant => sdk::Role::Assistant,
                Role::Tool => sdk::Role::User,
            };

            let content = msg.blocks.as_ref().and_then(|blocks| {
                let sdk_blocks: Vec<ContentBlock> =
                    blocks.iter().filter_map(core_block_to_sdk).collect();
                if sdk_blocks.is_empty() {
                    None
                } else {
                    Some(sdk::MessageContent::Blocks {
                        content: sdk_blocks,
                    })
                }
            });

            match content {
                Some(content) => sdk::Message { role, content },
                None => sdk::Message {
                    role,
                    content: sdk::MessageContent::Text {
                        content: msg.content.clone(),
                    },
                },
            }
        })
        .collect()
}

/// 将 Core MessageBlock 转换为 SDK ContentBlock
fn core_block_to_sdk(block: &MessageBlock) -> Option<ContentBlock> {
    match block {
        MessageBlock::Text(text) => Some(ContentBlock::Text {
            text: text.clone(),
            citations: None,
        }),
        MessageBlock::ToolUse { id, name, input } => Some(ContentBlock::ToolUse {
            id: id.clone(),
            name: name.clone(),
            input: input.clone(),
        }),
        MessageBlock::ToolResult {
            id,
            content,
            is_error: _,
        } => Some(ContentBlock::ToolResult {
            tool_use_id: id.clone(),
            content: content.clone(),
        }),
    }
}

/// 安全发送事件（忽略 channel 关闭错误）
async fn send_event(tx: &mpsc::Sender<AgentEvent>, event: AgentEvent) {
    let _ = tx.send(event).await;
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // ── 单元测试 ──

    #[test]
    fn test_convert_text_messages() {
        let msgs = vec![
            ConversationMessage::user("hello"),
            ConversationMessage::assistant("hi there"),
        ];

        let sdk_msgs = convert_messages_to_sdk(&msgs);
        assert_eq!(sdk_msgs.len(), 2);
        assert!(matches!(sdk_msgs[0].role, sdk::Role::User));
        assert!(matches!(sdk_msgs[1].role, sdk::Role::Assistant));
    }

    #[test]
    fn test_convert_tool_role() {
        let msgs = vec![ConversationMessage::tool_result("done")];

        let sdk_msgs = convert_messages_to_sdk(&msgs);
        assert_eq!(sdk_msgs.len(), 1);
        assert!(matches!(sdk_msgs[0].role, sdk::Role::User));
    }

    #[test]
    fn test_convert_block_messages() {
        let blocks = vec![MessageBlock::ToolUse {
            id: "call_1".into(),
            name: "test".into(),
            input: serde_json::json!({"key": "value"}),
        }];
        let msg = ConversationMessage::with_blocks(Role::Assistant, "", blocks);

        let sdk_msgs = convert_messages_to_sdk(&[msg]);
        assert_eq!(sdk_msgs.len(), 1);
    }

    #[test]
    fn test_build_assistant_message_text_only() {
        let round = RoundOutput {
            full_text: "Hello!".into(),
            tool_uses: vec![],
            input_tokens: 10,
            output_tokens: 5,
            thinking: None,
        };

        let msg = build_assistant_message(&round);
        assert_eq!(msg.role, Role::Assistant);
        assert_eq!(msg.content, "Hello!");
        assert!(msg.blocks.is_none());
    }

    #[test]
    fn test_build_assistant_message_with_tools() {
        let round = RoundOutput {
            full_text: "Let me check.".into(),
            tool_uses: vec![(
                "call_1".into(),
                "file_read".into(),
                serde_json::json!({"file_path": "/tmp/test.txt"}),
            )],
            input_tokens: 10,
            output_tokens: 5,
            thinking: None,
        };

        let msg = build_assistant_message(&round);
        assert!(msg.has_tool_calls());
        let calls = msg.tool_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "call_1");
        assert_eq!(calls[0].1, "file_read");
    }

    // ── 集成测试（wiremock） ──

    /// 用 serde_json 构建 SSE 事件，确保所有嵌套 JSON 正确转义
    fn sse_event(event_type: &str, data: &serde_json::Value) -> String {
        format!(
            "event: {}\ndata: {}\n\n",
            event_type,
            serde_json::to_string(data).unwrap()
        )
    }

    fn sse_text_response(text: &str) -> String {
        let mut sse = String::new();
        sse.push_str(&sse_event(
            "message_start",
            &serde_json::json!({
                "type": "message_start",
                "message": {
                    "id": "msg_1",
                    "type": "message",
                    "role": "assistant",
                    "content": [],
                    "model": "test-model",
                    "stop_reason": null,
                    "stop_sequence": null,
                    "usage": {"input_tokens": 10, "output_tokens": 0}
                }
            }),
        ));
        sse.push_str(&sse_event(
            "content_block_start",
            &serde_json::json!({
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""}
            }),
        ));
        sse.push_str(&sse_event(
            "content_block_delta",
            &serde_json::json!({
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": text}
            }),
        ));
        sse.push_str(&sse_event(
            "content_block_stop",
            &serde_json::json!({
                "type": "content_block_stop",
                "index": 0
            }),
        ));
        sse.push_str(&sse_event(
            "message_delta",
            &serde_json::json!({
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn", "stop_sequence": null},
                "usage": {"output_tokens": 5}
            }),
        ));
        sse.push_str(&sse_event(
            "message_stop",
            &serde_json::json!({
                "type": "message_stop"
            }),
        ));
        sse
    }

    fn sse_tool_response(
        text: &str,
        tool_id: &str,
        tool_name: &str,
        tool_input: &serde_json::Value,
    ) -> String {
        let mut sse = String::new();
        sse.push_str(&sse_event(
            "message_start",
            &serde_json::json!({
                "type": "message_start",
                "message": {
                    "id": "msg_2",
                    "type": "message",
                    "role": "assistant",
                    "content": [],
                    "model": "test-model",
                    "stop_reason": null,
                    "stop_sequence": null,
                    "usage": {"input_tokens": 15, "output_tokens": 0}
                }
            }),
        ));
        sse.push_str(&sse_event(
            "content_block_start",
            &serde_json::json!({
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""}
            }),
        ));
        sse.push_str(&sse_event(
            "content_block_delta",
            &serde_json::json!({
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": text}
            }),
        ));
        sse.push_str(&sse_event(
            "content_block_stop",
            &serde_json::json!({
                "type": "content_block_stop",
                "index": 0
            }),
        ));
        sse.push_str(&sse_event(
            "content_block_start",
            &serde_json::json!({
                "type": "content_block_start",
                "index": 1,
                "content_block": {
                    "type": "tool_use",
                    "id": tool_id,
                    "name": tool_name,
                    "input": {}
                }
            }),
        ));
        sse.push_str(&sse_event(
            "content_block_delta",
            &serde_json::json!({
                "type": "content_block_delta",
                "index": 1,
                "delta": {
                    "type": "input_json_delta",
                    "partial_json": serde_json::to_string(tool_input).unwrap()
                }
            }),
        ));
        sse.push_str(&sse_event(
            "content_block_stop",
            &serde_json::json!({
                "type": "content_block_stop",
                "index": 1
            }),
        ));
        sse.push_str(&sse_event(
            "message_delta",
            &serde_json::json!({
                "type": "message_delta",
                "delta": {"stop_reason": "tool_use", "stop_sequence": null},
                "usage": {"output_tokens": 10}
            }),
        ));
        sse.push_str(&sse_event(
            "message_stop",
            &serde_json::json!({
                "type": "message_stop"
            }),
        ));
        sse
    }

    fn make_mock_response(body: String) -> ResponseTemplate {
        ResponseTemplate::new(200)
            .insert_header("Content-Type", "text/event-stream")
            .set_body_string(body)
    }

    /// 一个简单的 Mock 工具
    struct EchoTool;

    #[async_trait]
    impl crate::core::AgentTool for EchoTool {
        fn name(&self) -> &str {
            "echo"
        }
        fn description(&self) -> &str {
            "回显输入参数"
        }
        fn input_schema(&self) -> serde_json::Value {
            serde_json::json!({
                "type": "object",
                "properties": {
                    "message": {"type": "string"}
                }
            })
        }
        async fn execute(&self, input: serde_json::Value) -> Result<String, String> {
            let msg = input.get("message").and_then(|v| v.as_str()).unwrap_or("");
            Ok(format!("Echo: {}", msg))
        }
    }

    /// 测试基本文本对话（无工具）
    #[tokio::test]
    async fn test_agent_loop_text_only() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/messages"))
            .respond_with(make_mock_response(sse_text_response("Hello World")))
            .mount(&mock_server)
            .await;

        let config = Arc::new(
            AgentConfig::new("test-model", "test-key", mock_server.uri())
                .with_system_prompt("You are a test assistant"),
        );

        let (event_tx, mut event_rx) = mpsc::channel(64);
        let mut messages = vec![];

        let result = agent_loop(config, &mut messages, "Hi!", event_tx).await;

        assert!(result.is_ok());
        assert_eq!(messages.len(), 2); // user + assistant
        assert_eq!(messages[1].content, "Hello World");

        // 验证事件流
        let mut text_chunks = vec![];
        let mut finished = false;
        while let Some(event) = event_rx.recv().await {
            match event {
                AgentEvent::TextChunk { delta } => text_chunks.push(delta),
                AgentEvent::Finished { reason } => {
                    finished = true;
                    assert_eq!(reason, "completed");
                }
                _ => {}
            }
        }
        assert!(finished);
        assert_eq!(text_chunks.join(""), "Hello World");
    }

    /// 测试工具调用（使用 max_tool_rounds=1 控制只跑一轮）
    #[tokio::test]
    async fn test_agent_loop_with_tool_call() {
        let mock_server = MockServer::start().await;

        // 注册 mock：LLM 调用工具
        Mock::given(method("POST"))
            .and(path("/messages"))
            .respond_with(make_mock_response(sse_tool_response(
                "Checking...",
                "call_1",
                "echo",
                &serde_json::json!({"message": "hello"}),
            )))
            .mount(&mock_server)
            .await;

        let config = Arc::new(
            AgentConfig::new("test-model", "test-key", mock_server.uri())
                .with_system_prompt("You are a test assistant")
                .with_tools(vec![Box::new(EchoTool)])
                .with_max_tool_rounds(1), // 只跑一轮，避免第二轮无 mock
        );

        let (event_tx, mut event_rx) = mpsc::channel(64);
        let mut messages = vec![];

        let result = agent_loop(config, &mut messages, "Use echo tool", event_tx).await;

        // max_tool_rounds=1 且第一轮有工具调用 → 走完工具执行后返回 MaxRoundsReached
        assert!(
            result.is_err(),
            "expected MaxRoundsReached due to max_tool_rounds=1"
        );
        assert!(matches!(result.unwrap_err(), AgentError::MaxRoundsReached));

        // user + assistant(tool) + tool_result
        assert_eq!(messages.len(), 3);

        let mut saw_text = false;
        let mut saw_tool_start = false;
        let mut saw_tool_end = false;
        while let Some(event) = event_rx.recv().await {
            match event {
                AgentEvent::TextChunk { delta } => {
                    if delta == "Checking..." {
                        saw_text = true;
                    }
                }
                AgentEvent::ToolInvocationStarted { id, name, .. } => {
                    saw_tool_start = true;
                    assert_eq!(id, "call_1");
                    assert_eq!(name, "echo");
                }
                AgentEvent::ToolInvocationFinished { id, result } => {
                    saw_tool_end = true;
                    assert_eq!(id, "call_1");
                    assert_eq!(result.unwrap(), "Echo: hello");
                }
                _ => {}
            }
        }

        assert!(saw_text, "should have seen text chunk");
        assert!(saw_tool_start, "should have seen tool start");
        assert!(saw_tool_end, "should have seen tool end");
    }

    /// 测试 API 错误处理
    #[tokio::test]
    async fn test_agent_loop_api_error() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/messages"))
            .respond_with(ResponseTemplate::new(401).set_body_string(
                r#"{"type":"error","error":{"type":"authentication_error","message":"Invalid API Key"}}"#,
            ))
            .mount(&mock_server)
            .await;

        let config = Arc::new(
            AgentConfig::new("test-model", "bad-key", mock_server.uri())
                .with_system_prompt("You are a test assistant"),
        );

        let (event_tx, _event_rx) = mpsc::channel(64);
        let mut messages = vec![];

        let result = agent_loop(config, &mut messages, "Hi!", event_tx).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, AgentError::Api(_)));
        assert!(
            format!("{}", err).contains("Invalid API Key") || format!("{}", err).contains("401")
        );
    }

    /// 测试消息转换的完整性
    #[tokio::test]
    async fn test_agent_loop_messages_updated() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/messages"))
            .respond_with(make_mock_response(sse_text_response("Hello World")))
            .mount(&mock_server)
            .await;

        let config = Arc::new(
            AgentConfig::new("test-model", "test-key", mock_server.uri())
                .with_system_prompt("You are a test assistant"),
        );

        let (event_tx, _event_rx) = mpsc::channel(64);
        let mut messages = vec![ConversationMessage::user("existing history")];

        let result = agent_loop(config, &mut messages, "Hi!", event_tx).await;

        assert!(result.is_ok());
        // existing + new user + assistant
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].content, "existing history");
        assert_eq!(messages[1].content, "Hi!");
        assert_eq!(messages[2].content, "Hello World");
    }
}
