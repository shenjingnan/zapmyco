//! 自实现的 TUI 组件库。
//!
//! 基于 crossterm 原始终端模式构建，不依赖外部 TUI 框架。
//! 目前提供键盘驱动的选择提示组件（单选/多选），
//! 未来可在此添加 spinner、进度条等组件。
//!
//! # 模块组织
//!
//! - [`types`] — 共享类型定义（选项、选择结果等）
//! - [`select`] — 单选/多选选择器实现

pub mod select;
pub mod types;

pub use select::{prompt_multi_select, prompt_single_select};
pub use types::{MultiSelectResult, SelectOption, SingleSelectResult};
