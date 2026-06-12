pub mod agents_md;
pub mod chat;
pub mod conversation_loader;
pub mod conversation_logger;
pub mod env_info;
pub mod executor;
pub mod stream;
pub mod system_prompt;

pub use chat::{AiAgent, AiAgentOptions, ConversationMessage, ToolHandler};

// 旧路径兼容: zapmyco::conversation_logger::* → zapmyco::agent::conversation_logger::*
pub use conversation_logger::{
    ConversationLogger, ConversationRecord, ToolCallLogger, ToolCallRecord,
};
