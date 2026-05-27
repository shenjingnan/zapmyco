use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};
/// 集成测试 - AiAgent 与 Anthropic API 交互
use zapmyco::agent::{AiAgent, AiAgentOptions};

/// 模拟 Anthropic Messages API 非流式响应
const MOCK_NON_STREAM_RESPONSE: &str = r#"{
    "id": "msg_mock_001",
    "type": "message",
    "role": "assistant",
    "content": [
        {"type": "text", "text": "你好！我是 AI 助手。"}
    ],
    "model": "deepseek-v4-flash",
    "stop_reason": "end_turn",
    "stop_sequence": null,
    "usage": {"input_tokens": 10, "output_tokens": 8}
}"#;

/// 模拟 Anthropic Messages API 流式响应（SSE 格式）
const MOCK_STREAM_RESPONSE: &str = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_mock_002\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"deepseek-v4-flash\",\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":10,\"output_tokens\":0}}}\n\n\
event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"你好\"}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"！\"}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"我是 AI 助手。\"}}\n\n\
event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n\
event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":8}}\n\n\
event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

/// 模拟错误的 API 响应
const MOCK_ERROR_RESPONSE: &str = r#"{
    "error": {
        "type": "authentication_error",
        "message": "Invalid API key"
    }
}"#;

#[tokio::test]
async fn test_agent_non_streaming() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/messages"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(MOCK_NON_STREAM_RESPONSE)
                .insert_header("Content-Type", "application/json"),
        )
        .mount(&mock_server)
        .await;

    let mut agent = AiAgent::new(AiAgentOptions {
        api_key: Some("test-key".to_string()),
        base_url: Some(mock_server.uri()),
        model: Some("deepseek-v4-flash".to_string()),
        ..Default::default()
    })
    .expect("Failed to create AiAgent");

    let response = agent.chat("你好").await.expect("Chat failed");
    assert_eq!(response, "你好！我是 AI 助手。");

    // 验证上下文已更新
    assert_eq!(agent.get_messages().len(), 2);
    assert_eq!(agent.get_messages()[0].role, "user");
    assert_eq!(agent.get_messages()[0].content, "你好");
    assert_eq!(agent.get_messages()[1].role, "assistant");
    assert_eq!(agent.get_messages()[1].content, "你好！我是 AI 助手。");
}

#[tokio::test]
async fn test_agent_streaming() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/messages"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(MOCK_STREAM_RESPONSE)
                .insert_header("Content-Type", "text/event-stream"),
        )
        .mount(&mock_server)
        .await;

    let mut agent = AiAgent::new(AiAgentOptions {
        api_key: Some("test-key".to_string()),
        base_url: Some(mock_server.uri()),
        model: Some("deepseek-v4-flash".to_string()),
        ..Default::default()
    })
    .expect("Failed to create AiAgent");

    let mut streamed_chunks = String::new();
    let response = agent
        .chat_stream("你好", |chunk| {
            streamed_chunks.push_str(chunk);
        })
        .await
        .expect("Stream chat failed");

    assert_eq!(response, "你好！我是 AI 助手。");
    assert_eq!(streamed_chunks, "你好！我是 AI 助手。");

    // 验证上下文已更新
    assert_eq!(agent.get_messages().len(), 2);
}

#[tokio::test]
async fn test_agent_api_error() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/messages"))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_string(MOCK_ERROR_RESPONSE)
                .insert_header("Content-Type", "application/json"),
        )
        .mount(&mock_server)
        .await;

    let mut agent = AiAgent::new(AiAgentOptions {
        api_key: Some("invalid-key".to_string()),
        base_url: Some(mock_server.uri()),
        model: Some("deepseek-v4-flash".to_string()),
        ..Default::default()
    })
    .expect("Failed to create AiAgent");

    let result = agent.chat("hello").await;
    assert!(result.is_err());
    assert!(result.err().unwrap().contains("API"));
}

#[tokio::test]
async fn test_agent_clear_context() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/messages"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(MOCK_NON_STREAM_RESPONSE)
                .insert_header("Content-Type", "application/json"),
        )
        .mount(&mock_server)
        .await;

    let mut agent = AiAgent::new(AiAgentOptions {
        api_key: Some("test-key".to_string()),
        base_url: Some(mock_server.uri()),
        model: Some("deepseek-v4-flash".to_string()),
        ..Default::default()
    })
    .expect("Failed to create AiAgent");

    agent.chat("你好").await.expect("Chat failed");
    assert_eq!(agent.get_messages().len(), 2);

    agent.clear_context();
    assert_eq!(agent.get_messages().len(), 0);
}
