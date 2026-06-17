//! 自实现的 TUI 组件库。
//!
//! 基于 crossterm 原始终端模式构建，不依赖外部 TUI 框架。
//! 目前提供：
//! - 键盘驱动的选择提示组件（单选/多选）
//! - 内联输入状态机
//! - 基于 indicatif 的多条目进度显示组件
//!
//! # 模块组织
//!
//! - [`types`] — 共享类型定义（选项、选择结果等）
//! - [`select`] — 单选/多选选择器实现
//! - [`input`] — 内联输入状态机
//! - [`progress`] — 并发任务进度显示组件

pub mod input;
pub mod progress;
pub mod select;
pub mod types;

pub use input::{InlineInput, InputAction};
pub use progress::ProgressTracker;
pub use select::{prompt_multi_select, prompt_single_select};
pub use types::{MultiSelectResult, SelectOption, SingleSelectResult};
