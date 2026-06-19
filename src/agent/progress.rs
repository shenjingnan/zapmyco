//! ProgressReporter trait — 将进度上报从终端面板（RunProgress）中解耦。
//!
//! 终端模式使用 `RunProgress`（indicatif 终端面板）。
//! Web 模式使用 `WebProgress`（通过 channel 将进度事件推送到 HTTP 流）。
//! 两种模式都实现此 trait，`chat_with_tools` 无需关心具体实现。

/// 进度句柄 — 表示一个正在执行的工具或子任务。
///
/// 调用方可直接控制其视觉状态（执行中 / 成功 / 失败）。
pub trait HandleLike: Send + Clone + 'static {
    /// 标记为执行中，可选状态描述。
    fn set_running(&self, status: Option<&str>);
    /// 标记为已完成，可选摘要。
    fn set_success(&self, summary: Option<&str>);
    /// 标记为已失败，带错误描述。
    fn set_failed(&self, error: &str);
}

/// 进度上报器 — AI Agent 通过此 trait 上报执行进度。
///
/// # 类型参数
///
/// - `Handle` — 临时执行项的句柄类型，由 [`start_item`](Self::start_item) 返回。
///
/// # 方法说明
///
/// | 方法 | 用途 | Web 模式行为 |
/// |------|------|-------------|
/// | `set_status` | 更新状态行文本 | 发送 `{"type":"status","content":"..."}` |
/// | `start_item` | 创建临时执行项 | 发送 `{"type":"tool_start","label":"..."}` |
/// | `finish_item` | 完成临时项 | 发送 `{"type":"tool_end","success":true}` |
/// | `mark_item_completed` | 标记已由 handle 完成的项 | 记录完成时间 |
/// | `tick` | 清理已到期的临时项 | 空操作 |
/// | `pause` | 暂停动画 | 空操作 |
/// | `resume` | 恢复动画 | 空操作 |
pub trait ProgressReporter: Send + Sync {
    /// 临时执行项的句柄类型。
    type Handle: HandleLike;

    /// 更新状态行文本。
    fn set_status(&self, text: &str);
    /// 创建一个新的临时执行项，返回句柄。
    fn start_item(&self, label: &str) -> Self::Handle;
    /// 标记临时项为完成状态（带成功/失败标记）。
    fn finish_item(&self, handle: &Self::Handle, success: bool, summary: Option<&str>);
    /// 标记临时项为已完成（仅记录时间，不修改视觉）。
    fn mark_item_completed(&self, handle: &Self::Handle);
    /// 清理已到期的临时项（终端模式移除进度条，Web 模式空操作）。
    fn tick(&self);
    /// 暂停 spinner 动画（终端模式禁用 tick，Web 模式空操作）。
    fn pause(&self);
    /// 恢复 spinner 动画（终端模式启用 tick，Web 模式空操作）。
    fn resume(&self);
}
