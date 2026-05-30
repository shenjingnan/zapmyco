use std::sync::{Mutex, OnceLock};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};
/// 集成测试 - AiAgent 与 Anthropic API 交互
use zapmyco::agent::{AiAgent, AiAgentOptions};

/// 全局 HOME 锁，确保集成测试之间不会竞态修改 HOME
static HOME_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
fn acquire_home_lock() -> std::sync::MutexGuard<'static, ()> {
    HOME_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

/// 创建临时 HOME 和 settings.toml，避免 CI 环境缺少配置文件
fn setup_temp_home() -> tempfile::TempDir {
    let _guard = acquire_home_lock();
    let dir = tempfile::tempdir().expect("Failed to create temp dir");
    let settings_dir = dir.path().join(".zapmyco");
    std::fs::create_dir_all(&settings_dir).expect("Failed to create .zapmyco dir");
    std::fs::write(settings_dir.join("settings.toml"), "[llm]\n")
        .expect("Failed to write settings.toml");
    // SAFETY: HOME_LOCK guard 确保无竞态
    unsafe {
        std::env::set_var("HOME", dir.path());
    }
    dir
}

/// 模拟 Anthropic Messages API 非流式响应（含缓存字段）
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
    "usage": {
        "input_tokens": 10,
        "output_tokens": 8,
        "cache_creation_input_tokens": 5,
        "cache_read_input_tokens": 0
    }
}"#;

/// 模拟 Anthropic Messages API 流式响应（SSE 格式，含缓存字段）
const MOCK_STREAM_RESPONSE: &str = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_mock_002\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"deepseek-v4-flash\",\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":10,\"output_tokens\":0,\"cache_creation_input_tokens\":5,\"cache_read_input_tokens\":0}}}\n\n\
event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"你好\"}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"！\"}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"我是 AI 助手。\"}}\n\n\
event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n\
event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":8,\"cache_creation_input_tokens\":5,\"cache_read_input_tokens\":0}}\n\n\
event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

/// 模拟无缓存字段的旧格式非流式响应（向后兼容性测试）
const MOCK_NON_STREAM_RESPONSE_LEGACY: &str = r#"{
    "id": "msg_mock_003",
    "type": "message",
    "role": "assistant",
    "content": [
        {"type": "text", "text": "旧格式响应"}
    ],
    "model": "deepseek-v4-flash",
    "stop_reason": "end_turn",
    "stop_sequence": null,
    "usage": {"input_tokens": 5, "output_tokens": 3}
}"#;

/// 模拟错误的 API 响应
const MOCK_ERROR_RESPONSE: &str = r#"{
    "error": {
        "type": "authentication_error",
        "message": "Invalid API key"
    }
}"#;

/// 模拟流式响应中的 error 事件
const MOCK_STREAM_ERROR_EVENT: &str = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"server_error\",\"message\":\"Internal error\"}}\n\n";

/// 模拟空流式响应（只有 message_stop）
const MOCK_STREAM_EMPTY: &str = "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

#[tokio::test]
async fn test_agent_non_streaming() {
    let _home = setup_temp_home();
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
    let _home = setup_temp_home();
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
    let _home = setup_temp_home();
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
async fn test_agent_non_streaming_legacy_format() {
    let _home = setup_temp_home();
    let mock_server = MockServer::start().await;

    // 无缓存字段的旧格式响应（向后兼容性测试）
    Mock::given(method("POST"))
        .and(path("/messages"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(MOCK_NON_STREAM_RESPONSE_LEGACY)
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

    let response = agent.chat("测试旧格式").await.expect("Chat failed");
    assert_eq!(response, "旧格式响应");

    // 验证上下文已更新
    assert_eq!(agent.get_messages().len(), 2);
}

#[tokio::test]
async fn test_agent_clear_context() {
    let _home = setup_temp_home();
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

#[tokio::test]
async fn test_agent_stream_api_error() {
    let _home = setup_temp_home();
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

    let result = agent.chat_stream("hello", |_| {}).await;
    assert!(result.is_err());
    assert!(result.err().unwrap().contains("API"));
}

#[tokio::test]
async fn test_agent_stream_empty() {
    let _home = setup_temp_home();
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/messages"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(MOCK_STREAM_EMPTY)
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

    let mut chunks = String::new();
    let result = agent
        .chat_stream("hello", |chunk| {
            chunks.push_str(chunk);
        })
        .await;
    assert!(result.is_ok());
    // 空流返回空字符串
    assert_eq!(result.unwrap(), "");
    assert_eq!(chunks, "");
}

#[tokio::test]
async fn test_agent_stream_error_event() {
    let _home = setup_temp_home();
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/messages"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(MOCK_STREAM_ERROR_EVENT)
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

    let result = agent.chat_stream("hello", |_| {}).await;
    assert!(result.is_err());
    assert!(result.err().unwrap().contains("API 错误"));
}
