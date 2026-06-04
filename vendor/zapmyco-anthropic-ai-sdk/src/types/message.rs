use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Error types for the Messages API
#[derive(Debug, Error)]
pub enum MessageError {
    #[error("API request failed: {0}")]
    RequestFailed(String),
    #[error("API error: {0}")]
    ApiError(String),
}

impl From<String> for MessageError {
    fn from(error: String) -> Self {
        MessageError::ApiError(error)
    }
}

#[async_trait]
pub trait MessageClient {
    async fn create_message<'a>(
        &'a self,
        params: Option<&'a CreateMessageParams>,
    ) -> Result<CreateMessageResponse, MessageError>;

    async fn count_tokens<'a>(
        &'a self,
        params: Option<&'a CountMessageTokensParams>,
    ) -> Result<CountMessageTokensResponse, MessageError>;

    async fn create_message_streaming<'a>(
        &'a self,
        body: &'a CreateMessageParams,
    ) -> Result<
        impl futures_util::Stream<Item = Result<StreamEvent, MessageError>> + 'a,
        MessageError,
    >;
}

#[derive(Debug)]
pub struct RequiredMessageParams {
    pub model: String,
    pub messages: Vec<Message>,
    pub max_tokens: u32,
}

/// 缓存控制配置，对应 TS SDK 的 CacheControlEphemeral
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct CacheControl {
    #[serde(rename = "type")]
    pub cache_type: String,
    /// TTL: "5m"（默认）或 "1h"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<String>,
}

impl CacheControl {
    pub fn ephemeral() -> Self {
        Self {
            cache_type: "ephemeral".to_string(),
            ttl: None,
        }
    }
}

/// System prompt 文本块，对应 TS SDK 的 TextBlockParam（用于 system 时）
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct SystemBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<CacheControl>,
}

/// Parameters for creating a message
#[derive(Debug, Deserialize, Serialize, Default)]
pub struct CreateMessageParams {
    /// Maximum number of tokens to generate
    pub max_tokens: u32,
    /// Input messages for the conversation
    pub messages: Vec<Message>,
    /// Model to use
    pub model: String,
    /// System prompt (string or array of TextBlockParam with cache_control)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<Vec<SystemBlock>>,
    /// Temperature for response generation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    /// Custom stop sequences
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_sequences: Option<Vec<String>>,
    /// Whether to stream the response
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    /// Top-k sampling
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<u32>,
    /// Top-p sampling
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    /// Tools that the model may use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<Tool>>,
    /// How the model should use tools
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<ToolChoice>,
    /// Configuration for enabling Claude's extended thinking.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<Thinking>,
    /// Request metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Metadata>,
}

impl From<RequiredMessageParams> for CreateMessageParams {
    fn from(required: RequiredMessageParams) -> Self {
        Self {
            model: required.model,
            messages: required.messages,
            max_tokens: required.max_tokens,
            ..Default::default()
        }
    }
}

impl CreateMessageParams {
    /// Create new parameters with only required fields
    pub fn new(required: RequiredMessageParams) -> Self {
        required.into()
    }

    // Builder methods for optional parameters
    pub fn with_system(mut self, system: impl Into<String>) -> Self {
        self.system = Some(vec![SystemBlock {
            block_type: "text".to_string(),
            text: system.into(),
            cache_control: None,
        }]);
        self
    }

    pub fn with_system_blocks(mut self, blocks: Vec<SystemBlock>) -> Self {
        self.system = Some(blocks);
        self
    }

    pub fn with_temperature(mut self, temperature: f32) -> Self {
        self.temperature = Some(temperature);
        self
    }

    pub fn with_stop_sequences(mut self, stop_sequences: Vec<String>) -> Self {
        self.stop_sequences = Some(stop_sequences);
        self
    }

    pub fn with_stream(mut self, stream: bool) -> Self {
        self.stream = Some(stream);
        self
    }

    pub fn with_top_k(mut self, top_k: u32) -> Self {
        self.top_k = Some(top_k);
        self
    }

    pub fn with_top_p(mut self, top_p: f32) -> Self {
        self.top_p = Some(top_p);
        self
    }

    pub fn with_tools(mut self, tools: Vec<Tool>) -> Self {
        self.tools = Some(tools);
        self
    }

    pub fn with_tool_choice(mut self, tool_choice: ToolChoice) -> Self {
        self.tool_choice = Some(tool_choice);
        self
    }

    pub fn with_thinking(mut self, thinking: Thinking) -> Self {
        self.thinking = Some(thinking);
        self
    }

    pub fn with_metadata(mut self, metadata: Metadata) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

/// Message in a conversation
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    /// Role of the message sender
    pub role: Role,
    /// Content of the message (either string or array of content blocks)
    #[serde(flatten)]
    pub content: MessageContent,
}

/// Role of a message sender
#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

/// Content of a message
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(untagged)]
pub enum MessageContent {
    /// Simple text content
    Text { content: String },
    /// Structured content blocks
    Blocks { content: Vec<ContentBlock> },
}

/// Content block in a message
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum ContentBlock {
    /// Text content
    #[serde(rename = "text")]
    Text {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        citations: Option<Vec<serde_json::Value>>,
    },
    /// Image content
    #[serde(rename = "image")]
    Image { source: ImageSource },
    /// Tool use content
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    /// Tool result content
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
    },
    /// Thinking content
    #[serde(rename = "thinking")]
    Thinking { thinking: String, signature: String },
    /// Redacted thinking
    #[serde(rename = "redacted_thinking")]
    RedactedThinking { data: String },
    /// Server-side tool use (e.g. web_search)
    #[serde(rename = "server_tool_use")]
    ServerToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    /// Web search tool result
    #[serde(rename = "web_search_tool_result")]
    WebSearchToolResult {
        tool_use_id: String,
        content: WebSearchToolResultContent,
    },
}

/// Content of a WebSearchToolResultBlock (success results or error)
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(untagged)]
pub enum WebSearchToolResultContent {
    /// Array of search results
    Results(Vec<WebSearchResult>),
    /// Error info
    Error(WebSearchToolResultError),
}

/// Single web search result entry
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct WebSearchResult {
    #[serde(rename = "type")]
    pub type_: String,
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub encrypted_content: Option<String>,
    #[serde(default)]
    pub page_age: Option<String>,
}

/// Web search tool result error
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct WebSearchToolResultError {
    #[serde(rename = "type")]
    pub type_: String,
    pub error_code: String,
}

/// Source of an image
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ImageSource {
    /// Type of image source
    #[serde(rename = "type")]
    pub type_: String,
    /// Media type of the image
    pub media_type: String,
    /// Base64-encoded image data
    pub data: String,
}

/// Tool definition
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Tool {
    /// Name of the tool
    pub name: String,
    /// Description of the tool
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// JSON schema for tool input (not needed for server-side tools like web_search)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<serde_json::Value>,

    /// Tool type discriminator: None/"custom" → regular tool, "web_search_20250305" → web search
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    pub tool_type: Option<String>,

    /// Maximum number of tool uses (for server-side tools)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_uses: Option<u32>,

    /// Only include results from these domains (web_search only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_domains: Option<Vec<String>>,

    /// Exclude results from these domains (web_search only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_domains: Option<Vec<String>>,
}

/// Tool choice configuration
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ToolChoice {
    /// Let model choose whether to use tools
    #[serde(rename = "auto")]
    Auto,
    /// Model must use one of the provided tools
    #[serde(rename = "any")]
    Any,
    /// Model must use a specific tool
    #[serde(rename = "tool")]
    Tool { name: String },
    /// Model must not use any tools
    #[serde(rename = "none")]
    None,
}

/// Configuration for extended thinking
#[derive(Debug, Deserialize, Serialize)]
pub struct Thinking {
    /// Must be at least 1024 tokens
    pub budget_tokens: usize,
    #[serde(rename = "type")]
    pub type_: ThinkingType,
}

#[derive(Debug, Deserialize, Serialize)]
pub enum ThinkingType {
    #[serde(rename = "enabled")]
    Enabled,
}
/// Message metadata
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Metadata {
    /// Custom metadata fields
    #[serde(flatten)]
    pub fields: std::collections::HashMap<String, String>,
}

/// Container for code execution
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct Container {
    pub id: String,
    pub expires_at: String,
}

/// Details about why the model refused to respond
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct RefusalStopDetails {
    /// Category of refusal (e.g., 'cyber', 'bio')
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// Explanation of the refusal
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
    /// Type of the refusal details
    #[serde(rename = "type")]
    pub type_: String,
}

/// Response from creating a message
#[derive(Debug, Deserialize, Serialize)]
pub struct CreateMessageResponse {
    /// Content blocks in the response
    pub content: Vec<ContentBlock>,
    /// Unique message identifier
    pub id: String,
    /// Model that handled the request
    pub model: String,
    /// Role of the message (always "assistant")
    pub role: Role,
    /// Reason for stopping generation
    pub stop_reason: Option<StopReason>,
    /// Stop sequence that was generated
    pub stop_sequence: Option<String>,
    /// Type of the message
    #[serde(rename = "type")]
    pub type_: String,
    /// Usage statistics
    pub usage: Usage,
    /// Container for code execution (if applicable)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container: Option<Container>,
    /// Details about refusal (if stopped due to refusal)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_details: Option<RefusalStopDetails>,
}

/// Reason for stopping message generation
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    StopSequence,
    ToolUse,
    Refusal,
    /// The model paused and will continue later
    #[serde(rename = "pause_turn")]
    PauseTurn,
}

/// Breakdown of cached tokens by TTL
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct CacheCreation {
    /// 1-hour TTL cache entry tokens
    pub ephemeral_1h_input_tokens: u32,
    /// 5-minute TTL cache entry tokens
    pub ephemeral_5m_input_tokens: u32,
}

/// Breakdown of output tokens by category
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct OutputTokensDetails {
    /// Tokens used for internal reasoning/thinking
    pub thinking_tokens: u32,
}

/// Server-side tool usage counts
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct ServerToolUsage {
    /// Number of web fetch requests made by the server
    #[serde(default)]
    pub web_fetch_requests: u32,
    /// Number of web search requests made by the server
    #[serde(default)]
    pub web_search_requests: u32,
}

/// Token usage statistics
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Usage {
    /// Input tokens used
    pub input_tokens: u32,
    /// Output tokens used
    pub output_tokens: u32,
    /// Input tokens used to create the cache entry (cache miss)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u32>,
    /// Input tokens read from the cache (cache hit)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<u32>,
    /// Breakdown of cached tokens by TTL
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_creation: Option<CacheCreation>,
    /// Breakdown of output tokens by category
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens_details: Option<OutputTokensDetails>,
    /// Geographic region where inference was performed
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inference_geo: Option<String>,
    /// Service tier used ('standard', 'priority', or 'batch')
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
    /// Server-side tool usage counts
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_tool_use: Option<ServerToolUsage>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StreamUsage {
    /// Input tokens used (may be missing in some events)
    #[serde(default)]
    pub input_tokens: u32,
    /// Output tokens used
    pub output_tokens: u32,
    /// Input tokens used to create the cache entry (cache miss)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u32>,
    /// Input tokens read from the cache (cache hit)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<u32>,
    /// Breakdown of output tokens by category
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens_details: Option<OutputTokensDetails>,
    /// Server-side tool usage counts
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_tool_use: Option<ServerToolUsage>,
}

impl Message {
    /// Create a new message with simple text content
    pub fn new_text(role: Role, text: impl Into<String>) -> Self {
        Self {
            role,
            content: MessageContent::Text {
                content: text.into(),
            },
        }
    }

    /// Create a new message with content blocks
    pub fn new_blocks(role: Role, blocks: Vec<ContentBlock>) -> Self {
        Self {
            role,
            content: MessageContent::Blocks { content: blocks },
        }
    }
}

// Helper methods for content blocks
impl ContentBlock {
    /// Create a new text block
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text {
            text: text.into(),
            citations: None,
        }
    }

    /// Create a new image block
    pub fn image(
        type_: impl Into<String>,
        media_type: impl Into<String>,
        data: impl Into<String>,
    ) -> Self {
        Self::Image {
            source: ImageSource {
                type_: type_.into(),
                media_type: media_type.into(),
                data: data.into(),
            },
        }
    }
}

#[derive(Debug, Serialize, Default)]
pub struct CountMessageTokensParams {
    pub model: String,
    pub messages: Vec<Message>,
}

#[derive(Debug, Deserialize)]
pub struct CountMessageTokensResponse {
    pub input_tokens: u32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum StreamEvent {
    #[serde(rename = "message_start")]
    MessageStart { message: MessageStartContent },
    #[serde(rename = "content_block_start")]
    ContentBlockStart {
        index: usize,
        content_block: ContentBlock,
    },
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta {
        index: usize,
        delta: ContentBlockDelta,
    },
    #[serde(rename = "content_block_stop")]
    ContentBlockStop { index: usize },
    #[serde(rename = "message_delta")]
    MessageDelta {
        delta: MessageDeltaContent,
        usage: Option<StreamUsage>,
    },
    #[serde(rename = "message_stop")]
    MessageStop,
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "error")]
    Error { error: StreamError },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MessageStartContent {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub role: Role,
    pub content: Vec<ContentBlock>,
    pub model: String,
    pub stop_reason: Option<StopReason>,
    pub stop_sequence: Option<String>,
    pub usage: Usage,
    /// Container for code execution (if applicable)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container: Option<Container>,
    /// Details about refusal (if stopped due to refusal)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_details: Option<RefusalStopDetails>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum ContentBlockDelta {
    #[serde(rename = "text_delta")]
    TextDelta { text: String },
    #[serde(rename = "input_json_delta")]
    InputJsonDelta { partial_json: String },
    #[serde(rename = "thinking_delta")]
    ThinkingDelta { thinking: String },
    #[serde(rename = "signature_delta")]
    SignatureDelta { signature: String },
    #[serde(rename = "citations_delta")]
    CitationsDelta { citation: serde_json::Value },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MessageDeltaContent {
    pub stop_reason: Option<StopReason>,
    pub stop_sequence: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StreamError {
    #[serde(rename = "type")]
    pub type_: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_new_text() {
        let msg = Message::new_text(Role::User, "hello");
        assert!(matches!(msg.role, Role::User));
        assert!(matches!(msg.content, MessageContent::Text { .. }));
        if let MessageContent::Text { content } = &msg.content {
            assert_eq!(content, "hello");
        }
    }

    #[test]
    fn test_message_new_blocks() {
        let blocks = vec![ContentBlock::text("hello")];
        let msg = Message::new_blocks(Role::Assistant, blocks);
        assert!(matches!(msg.role, Role::Assistant));
        assert!(matches!(msg.content, MessageContent::Blocks { .. }));
    }

    #[test]
    fn test_content_block_text_helper() {
        let block = ContentBlock::text("Hello World");
        assert!(matches!(block, ContentBlock::Text { text, .. } if text == "Hello World"));
    }

    #[test]
    fn test_content_block_image_helper() {
        let block = ContentBlock::image("base64", "image/png", "data");
        assert!(matches!(block, ContentBlock::Image { .. }));
    }

    #[test]
    fn test_create_message_params_from_required() {
        let msg = Message::new_text(Role::User, "test");
        let required = RequiredMessageParams {
            model: "test-model".to_string(),
            messages: vec![msg],
            max_tokens: 100,
        };
        let params: CreateMessageParams = required.into();
        assert_eq!(params.model, "test-model");
        assert_eq!(params.messages.len(), 1);
        assert_eq!(params.max_tokens, 100);
        assert!(params.system.is_none());
        assert!(params.stream.is_none());
    }

    #[test]
    fn test_create_message_params_builder() {
        let msg = Message::new_text(Role::User, "hello");
        let required = RequiredMessageParams {
            model: "test-model".to_string(),
            messages: vec![msg],
            max_tokens: 200,
        };
        let params = CreateMessageParams::new(required)
            .with_system("You are a helpful assistant.")
            .with_stream(true)
            .with_temperature(0.7)
            .with_top_k(40)
            .with_top_p(0.9);

        assert_eq!(
            params.system.as_deref(),
            Some("You are a helpful assistant.")
        );
        assert_eq!(params.stream, Some(true));
        assert_eq!(params.temperature, Some(0.7));
        assert_eq!(params.top_k, Some(40));
        assert_eq!(params.top_p, Some(0.9));
    }

    #[test]
    fn test_stream_event_deserialize_message_start() {
        let json = r#"{"type":"message_start","message":{"id":"msg_001","type":"message","role":"assistant","content":[],"model":"deepseek","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":5,"output_tokens":0}}}"#;
        let event: StreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, StreamEvent::MessageStart { .. }));
    }

    #[test]
    fn test_stream_event_deserialize_content_block_delta() {
        let json = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        let event: StreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, StreamEvent::ContentBlockDelta { .. }));
        if let StreamEvent::ContentBlockDelta { delta, .. } = &event {
            assert!(matches!(delta, ContentBlockDelta::TextDelta { text } if text == "Hello"));
        }
    }

    #[test]
    fn test_stream_event_deserialize_error() {
        let json =
            r#"{"type":"error","error":{"type":"server_error","message":"Internal server error"}}"#;
        let event: StreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, StreamEvent::Error { .. }));
    }

    #[test]
    fn test_stream_event_deserialize_message_stop() {
        let json = r#"{"type":"message_stop"}"#;
        let event: StreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, StreamEvent::MessageStop));
    }

    #[test]
    fn test_stream_event_deserialize_ping() {
        let json = r#"{"type":"ping"}"#;
        let event: StreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, StreamEvent::Ping));
    }

    #[test]
    fn test_create_message_response_deserialization() {
        let json = r#"{
            "id": "msg_001",
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": "Hello!"}],
            "model": "deepseek-v4-flash",
            "stop_reason": "end_turn",
            "stop_sequence": null,
            "usage": {"input_tokens": 10, "output_tokens": 5}
        }"#;
        let response: CreateMessageResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.id, "msg_001");
        assert_eq!(response.model, "deepseek-v4-flash");
        assert_eq!(response.content.len(), 1);
        assert_eq!(response.usage.input_tokens, 10);
        assert_eq!(response.usage.output_tokens, 5);
    }

    #[test]
    fn test_create_message_response_with_cache_fields() {
        let json = r#"{
            "id": "msg_002",
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": "Hi"}],
            "model": "deepseek-v4-flash",
            "stop_reason": "end_turn",
            "stop_sequence": null,
            "usage": {"input_tokens": 10, "output_tokens": 5, "cache_creation_input_tokens": 5, "cache_read_input_tokens": 0}
        }"#;
        let response: CreateMessageResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.usage.cache_creation_input_tokens, Some(5));
        assert_eq!(response.usage.cache_read_input_tokens, Some(0));
    }

    #[test]
    fn test_message_error_from_string() {
        let error: MessageError = "something went wrong".to_string().into();
        assert!(matches!(error, MessageError::ApiError(_)));
        assert_eq!(error.to_string(), "API error: something went wrong");
    }

    #[test]
    fn test_message_error_request_failed() {
        let error = MessageError::RequestFailed("network error".to_string());
        assert_eq!(error.to_string(), "API request failed: network error");
    }

    // ---- ServerToolUsage 反序列化测试（兼容 DeepSeek 响应格式） ----

    #[test]
    fn test_server_tool_usage_deserialize_both_fields() {
        let json = r#"{"web_search_requests": 3, "web_fetch_requests": 5}"#;
        let usage: ServerToolUsage = serde_json::from_str(json).unwrap();
        assert_eq!(usage.web_search_requests, 3);
        assert_eq!(usage.web_fetch_requests, 5);
    }

    #[test]
    fn test_server_tool_usage_deserialize_only_search() {
        // DeepSeek 只返回 web_search_requests
        let json = r#"{"web_search_requests": 1}"#;
        let usage: ServerToolUsage = serde_json::from_str(json).unwrap();
        assert_eq!(usage.web_search_requests, 1);
        assert_eq!(usage.web_fetch_requests, 0); // 默认值
    }

    #[test]
    fn test_server_tool_usage_deserialize_only_fetch() {
        let json = r#"{"web_fetch_requests": 2}"#;
        let usage: ServerToolUsage = serde_json::from_str(json).unwrap();
        assert_eq!(usage.web_search_requests, 0);
        assert_eq!(usage.web_fetch_requests, 2);
    }

    #[test]
    fn test_server_tool_usage_deserialize_empty() {
        let json = r#"{}"#;
        let usage: ServerToolUsage = serde_json::from_str(json).unwrap();
        assert_eq!(usage.web_search_requests, 0);
        assert_eq!(usage.web_fetch_requests, 0);
    }

    #[test]
    fn test_server_tool_usage_serialize_roundtrip() {
        let usage = ServerToolUsage {
            web_search_requests: 1,
            web_fetch_requests: 0,
        };
        let json = serde_json::to_string(&usage).unwrap();
        let deserialized: ServerToolUsage = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.web_search_requests, 1);
        assert_eq!(deserialized.web_fetch_requests, 0);
    }

    // ---- WebSearchResult 序列化/反序列化测试 ----

    #[test]
    fn test_web_search_result_deserialize_full() {
        let json = r#"{"type":"web_search_result","title":"Test Title","url":"https://example.com","encrypted_content":"abc123","page_age":"2026-01-01"}"#;
        let result: WebSearchResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.type_, "web_search_result");
        assert_eq!(result.title, "Test Title");
        assert_eq!(result.url, "https://example.com");
        assert_eq!(result.encrypted_content, Some("abc123".to_string()));
        assert_eq!(result.page_age, Some("2026-01-01".to_string()));
    }

    #[test]
    fn test_web_search_result_deserialize_minimal() {
        // DeepSeek 返回的结果中只有 title/url/type/encrypted_content
        let json = r#"{"type":"web_search_result","title":"Test","url":"https://example.com","encrypted_content":"enc"}"#;
        let result: WebSearchResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.title, "Test");
        assert_eq!(result.encrypted_content, Some("enc".to_string()));
        assert!(result.page_age.is_none());
    }

    // ---- WebSearchToolResultContent 反序列化测试 ----

    #[test]
    fn test_web_search_tool_result_content_results() {
        let json = r#"[{"type":"web_search_result","title":"A","url":"https://a.com","encrypted_content":"e1"}]"#;
        let content: WebSearchToolResultContent = serde_json::from_str(json).unwrap();
        match content {
            WebSearchToolResultContent::Results(results) => {
                assert_eq!(results.len(), 1);
                assert_eq!(results[0].title, "A");
            }
            _ => panic!("Expected Results variant"),
        }
    }

    #[test]
    fn test_web_search_tool_result_content_error() {
        let json = r#"{"type":"web_search_tool_result_error","error_code":"unavailable"}"#;
        let content: WebSearchToolResultContent = serde_json::from_str(json).unwrap();
        match content {
            WebSearchToolResultContent::Error(err) => {
                assert_eq!(err.error_code, "unavailable");
            }
            _ => panic!("Expected Error variant"),
        }
    }

    // ---- Tool Default 和序列化测试 ----

    #[test]
    fn test_tool_default_roundtrip() {
        // 普通工具：input_schema 有值，其他新增字段为 None
        let tool = Tool {
            name: "test_tool".to_string(),
            description: Some("A test tool".to_string()),
            input_schema: Some(serde_json::json!({"type": "object"})),
            ..Default::default()
        };
        let json = serde_json::to_string(&tool).unwrap();
        // 验证顶层 type 字段没有被序列化（tool_type 为 None）
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(
            value.get("type").is_none(),
            "top-level type field should be omitted when tool_type is None, got: {}",
            json
        );
        // 验证 input_schema 存在
        assert!(json.contains(r#""input_schema""#));
        // 反序列化回来
        let deserialized: Tool = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "test_tool");
        assert_eq!(deserialized.description.as_deref(), Some("A test tool"));
        assert!(deserialized.input_schema.is_some());
        assert!(deserialized.tool_type.is_none());
    }

    #[test]
    fn test_tool_web_search_schema_roundtrip() {
        // web_search server-side tool：没有 description 和 input_schema
        let tool = Tool {
            name: "web_search".to_string(),
            tool_type: Some("web_search_20250305".to_string()),
            max_uses: Some(8),
            ..Default::default()
        };
        let json = serde_json::to_string(&tool).unwrap();
        // 验证 type 字段存在且值为 web_search_20250305
        assert!(json.contains(r#""type":"web_search_20250305""#));
        assert!(json.contains(r#""max_uses":8"#));
        // 验证没有 description 和 input_schema
        assert!(!json.contains(r#""description""#));
        assert!(!json.contains(r#""input_schema""#));
        // 反序列化回来
        let deserialized: Tool = serde_json::from_str(&json).unwrap();
        assert_eq!(
            deserialized.tool_type.as_deref(),
            Some("web_search_20250305")
        );
        assert!(deserialized.description.is_none());
        assert!(deserialized.input_schema.is_none());
    }

    #[test]
    fn test_tool_with_domain_filters() {
        let tool = Tool {
            name: "web_search".to_string(),
            tool_type: Some("web_search_20250305".to_string()),
            max_uses: Some(8),
            allowed_domains: Some(vec!["example.com".to_string()]),
            blocked_domains: None,
            ..Default::default()
        };
        let json = serde_json::to_string(&tool).unwrap();
        assert!(json.contains(r#""allowed_domains":["example.com"]"#));
        assert!(!json.contains(r#""blocked_domains""#));
    }
}
