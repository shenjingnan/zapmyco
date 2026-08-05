//! 会话管理模块 — 从 `agent/` 提取的共享能力，供 Core 路径与 AiAgent 路径共用。
//!
//! - `logger`：会话日志（conversation.jsonl / session.json / tool_calls.jsonl / events.log）与消息快照
//! - `loader`：历史会话加载（load_session / list_sessions），兼容新旧格式

pub mod loader;
pub mod logger;

pub use logger::{
    ConversationRecord, ExitReason, SessionLogger, SessionMeta, ToolCallLogger, ToolCallRecord,
};
