pub mod chat;
pub mod conversation_logger;

pub use chat::{AiAgent, AiAgentOptions, ConversationMessage, ToolHandler};

// 旧路径兼容: zapmyco::conversation_logger::* → zapmyco::agent::conversation_logger::*
pub use conversation_logger::{ConversationLogger, ConversationRecord};
