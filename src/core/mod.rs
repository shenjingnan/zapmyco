//! # zapmyco Core
//!
//! Core 层是 AI Agent 运行时的核心抽象层。
//!
//! ## 设计原则
//!
//! - **零环境依赖**：不读文件、不写终端、不碰环境变量
//! - **依赖注入**：所有外部依赖通过 `AgentConfig` 传入
//! - **事件驱动**：所有输出通过 `AgentEvent` 流发送
//! - **工具即 Trait**：通过 `AgentTool` trait 注册，不通过枚举硬编码
//!
//! ## 模块结构
//!
//! | 模块 | 说明 |
//! |------|------|
//! | `types` | 基础数据类型（Role, ConversationMessage, MessageBlock） |
//! | `agent_tool` | AgentTool trait |
//! | `agent_event` | AgentEvent 枚举 |
//! | `agent_config` | AgentConfig 结构体 |
//! | `agent_error` | AgentError 错误类型 |
//! | `agent_loop` | 核心循环函数 |
//! | `adapters` | 现有系统适配器（ToolHandler → AgentTool, 事件 → 输出） |

mod adapters;
mod agent_config;
mod agent_error;
mod agent_event;
mod agent_loop;
mod agent_tool;
mod types;

// ── 重新导出所有公共类型 ──

pub use adapters::{LegacyToolAdapter, core_event_handler, from_tool_handlers};
pub use agent_config::AgentConfig;
pub use agent_error::AgentError;
pub use agent_event::AgentEvent;
pub use agent_loop::agent_loop;
pub use agent_tool::AgentTool;
pub use types::{ConversationMessage, MessageBlock, Role};
