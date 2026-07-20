//! # zapmyco-core
//!
//! AI Agent 运行时的核心抽象层。
//!
//! ## 设计原则
//!
//! - **零环境依赖**：不读文件、不写终端、不碰环境变量
//! - **依赖注入**：所有外部依赖通过 `AgentConfig` 传入
//! - **事件驱动**：所有输出通过 `AgentEvent` 流发送
//! - **工具即 Trait**：通过 `AgentTool` trait 注册，不通过枚举硬编码

mod agent_config;
mod agent_error;
mod agent_event;
mod agent_loop;
mod agent_tool;
mod types;

// ── 重新导出所有公共类型 ──

pub use agent_config::AgentConfig;
pub use agent_error::AgentError;
pub use agent_event::AgentEvent;
pub use agent_loop::agent_loop;
pub use agent_tool::AgentTool;
pub use types::{ConversationMessage, MessageBlock, Role};
