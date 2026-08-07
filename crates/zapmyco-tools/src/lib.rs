//! # zapmyco-tools
//!
//! 可复用的 `AgentTool` 实现集，配合 [`zapmyco-core`] 组装完整 agent。
//!
//! 全局 dead_code 抑制：与主 crate 迁移前一致（部分 Options 字段为预留用途暂未启用）。
#![allow(dead_code)]
//!
//! 从 zapmyco 主 crate 的 `src/tools/` 提取，保持零主 crate 依赖，可被任意
//! Rust 项目直接引入。当前包含：
//!
//! - **文件类**：`file_read` / `file_write` / `file_edit` / `file_find` / `file_search`
//! - **Web 类**：`web_fetch`
//! - **任务系统**：`task_manager` 及 `task_create` / `task_get` / `task_list` / `task_update` / `task_display`
//! - **审批基础设施**：`confirm`（`ConfirmBackend` / `AskBackend`）

pub mod confirm;
pub mod file_edit;
pub mod file_find;
pub mod file_read;
pub mod file_search;
pub mod file_write;
pub mod task_create;
pub mod task_display;
pub mod task_get;
pub mod task_list;
pub mod task_manager;
pub mod task_update;
pub mod web_fetch;

// 旧路径兼容：zapmyco::grep::* → 本 crate 透传 GrepError
pub use zapmyco_grep::GrepError;

// 便捷重导出（与主 crate 旧导入路径一致）
pub use confirm::{
    AskBackend, AskUserResponse, ConfirmBackend, PendingApprovals, PendingAsks,
    ShellConfirmDecision,
};

#[cfg(test)]
pub(crate) mod test_util;
