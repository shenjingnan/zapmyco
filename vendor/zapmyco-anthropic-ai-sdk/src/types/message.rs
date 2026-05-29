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

/// Parameters for creating a message
#[derive(Debug, Deserialize, Serialize, Default)]
pub struct CreateMessageParams {
    /// Maximum number of tokens to generate
    pub max_tokens: u32,
    /// Input messages for the conversation
    pub messages: Vec<Message>,
    /// Model to use
    pub model: String,
    /// System prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
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
        self.system = Some(system.into());
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
#[derive(Debug, Serialize, Deserialize)]
pub struct Tool {
    /// Name of the tool
    pub name: String,
    /// Description of the tool
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// JSON schema for tool input
    pub input_schema: serde_json::Value,
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
    pub web_fetch_requests: u32,
    /// Number of web search requests made by the server
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
