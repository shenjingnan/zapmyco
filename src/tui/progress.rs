//! 进度显示组件——用于展示多个并发任务的实时进度。
//!
//! 基于 `indicatif::MultiProgress`，提供多行进度条管理。
//! 每个条目有四个状态：Pending（待执行）→ Running（执行中）→ Success（完成）/ Failed（失败）。
//!
//! # 跨平台
//!
//! 所有显示符号使用 Unicode Dingbats（非 emoji），确保 Linux/macOS/Windows 一致渲染：
//! - Running：`{spinner} label (status)` — braille 点阵动画
//! - Success：`[✓] label (summary)` — U+2713
//! - Failed：`[✗] label (err)` — U+2717
//!
//! # 使用示例
//!
//! ```rust,ignore
//! use zapmyco::tui::progress::ProgressTracker;
//!
//! let mut tracker = ProgressTracker::new();
//! let h1 = tracker.add("[任务] 扫描文件");
//! let h2 = tracker.add("[任务] 分析结果");
//!
//! h1.set_running(Some("scanning..."));
//! h2.set_running(None);
//!
//! // ... 执行工作 ...
//! h1.set_success(Some("42 文件"));
//! h2.set_failed("parse error");
//!
//! tracker.close();
//! ```

use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use std::time::Duration;

// ---------------------------------------------------------------------------
// 样式常量
// ---------------------------------------------------------------------------

/// 待执行样式：灰色文字，2 空格缩进（对齐 running 状态的 spinner 位），无动画
const PENDING_TEMPLATE: &str = "  {msg}";

/// 执行中样式：绿色 spinner + 灰色文字
const RUNNING_TEMPLATE: &str = "{spinner:.green} {msg:.dim}";

/// 完成样式：绿色文字，无 spinner
const SUCCESS_TEMPLATE: &str = "{msg:.green}";

/// 失败样式：红色文字，无 spinner
const FAILED_TEMPLATE: &str = "{msg:.red}";

/// spinner 动画字符集（braille 点阵，跨平台兼容）
const TICK_CHARS: &str = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

/// spinner 刷新间隔（毫秒）
const TICK_INTERVAL_MS: u64 = 80;

// ---------------------------------------------------------------------------
// ProgressTracker
// ---------------------------------------------------------------------------

/// 多条目进度管理器。
///
/// 创建后可添加条目，每个条目返回一个 [`ProgressHandle`] 用于控制状态转换。
/// 所有条目完成后应调用 [`close`](ProgressTracker::close) 清理终端显示。
pub struct ProgressTracker {
    mp: MultiProgress,
    bars: Vec<ProgressBar>,
}

impl ProgressTracker {
    /// 创建一个新的进度管理器，输出到 stderr。
    pub fn new() -> Self {
        Self {
            mp: MultiProgress::new(),
            bars: Vec::new(),
        }
    }

    /// 添加一个进度条目。
    ///
    /// `label` 是条目的显示文本，初始状态为 Pending（灰色文字，无 spinner）。
    ///
    /// 返回一个 [`ProgressHandle`]，可用于后续更新状态。
    pub fn add(&mut self, label: impl Into<String>) -> ProgressHandle {
        let label: String = label.into();
        let pb = self.mp.add(ProgressBar::new_spinner());
        pb.set_style(
            ProgressStyle::with_template(PENDING_TEMPLATE).expect("PENDING_TEMPLATE 格式正确"),
        );
        pb.set_message(label.clone());
        // 不启动 tick，保持静止
        self.bars.push(pb.clone());
        ProgressHandle { pb, label }
    }

    /// 关闭进度显示，从终端清除所有进度行。
    ///
    /// 调用后终端恢复到进度显示前的状态，后续 `println!` / `eprintln!` 输出不受干扰。
    /// 未明确完成（仍在 running 或 pending）的条目会被自动 finish。
    pub fn close(&mut self) {
        for pb in &self.bars {
            pb.finish();
        }
        let _ = self.mp.clear();
    }
}

impl Default for ProgressTracker {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// ProgressHandle
// ---------------------------------------------------------------------------

/// 单条目进度控制 handle。
///
/// `Clone` + `Send` + `Sync`，可在多线程/异步任务间共享。
/// 内部状态由 [`indicatif::ProgressBar`] 管理，线程安全。
#[derive(Clone)]
pub struct ProgressHandle {
    pub(crate) pb: ProgressBar,
    /// 创建时设置的原始 label（不含状态后缀），用于构建各状态的显示文本
    label: String,
}

impl ProgressHandle {
    /// 创建一个新的 ProgressHandle（供同模块内使用）
    pub(crate) fn new(pb: ProgressBar, label: String) -> Self {
        ProgressHandle { pb, label }
    }

    /// 标记为执行中，启动 spinner 动画。
    ///
    /// `status` 是可选的执行状态描述，显示在 label 后的括号中。
    /// 例如 `set_running(Some("scanning..."))` 显示为 `{spinner} [任务] 文件扫描 (scanning...)`。
    pub fn set_running(&self, status: Option<&str>) {
        self.pb.set_style(
            ProgressStyle::with_template(RUNNING_TEMPLATE)
                .expect("RUNNING_TEMPLATE 格式正确")
                .tick_chars(TICK_CHARS),
        );
        let msg = match status {
            Some(s) => format!("{} ({})", self.label, s),
            None => self.label.clone(),
        };
        self.pb.set_message(msg);
        self.pb
            .enable_steady_tick(Duration::from_millis(TICK_INTERVAL_MS));
    }

    /// 更新执行中的状态文本（不改变 spinner 动画）。
    ///
    /// 仅在 Running 状态下有意义；若当前处于其他状态则行为未定义。
    pub fn set_status(&self, msg: &str) {
        let new_msg = format!("{} ({})", self.label, msg);
        self.pb.set_message(new_msg);
    }

    /// 标记为完成，显示 `[✓]` 前缀。
    ///
    /// `summary` 是可选的完成摘要，显示在 label 后的括号中。
    /// 例如 `set_success(Some("2.5s"))` 显示为 `[✓] [任务] 文件扫描 (2.5s)`。
    ///
    /// 调用此方法后 spinner 停止，条目进入终态。
    pub fn set_success(&self, summary: Option<&str>) {
        self.pb.set_style(
            ProgressStyle::with_template(SUCCESS_TEMPLATE).expect("SUCCESS_TEMPLATE 格式正确"),
        );
        let msg = match summary {
            Some(s) => format!("[✓] {} ({})", self.label, s),
            None => format!("[✓] {}", self.label),
        };
        self.pb.finish_with_message(msg);
    }

    /// 标记为失败，显示 `[✗]` 前缀。
    ///
    /// `err` 是错误描述，显示在 label 后的括号中。
    /// 例如 `set_failed("permission denied")` 显示为 `[✗] [任务] 文件扫描 (permission denied)`。
    ///
    /// 调用此方法后 spinner 停止，条目进入终态。
    pub fn set_failed(&self, err: &str) {
        self.pb.set_style(
            ProgressStyle::with_template(FAILED_TEMPLATE).expect("FAILED_TEMPLATE 格式正确"),
        );
        let msg = format!("[✗] {} ({})", self.label, err);
        self.pb.finish_with_message(msg);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- 基本生命周期 --

    #[test]
    fn test_new_tracker_empty() {
        let tracker = ProgressTracker::new();
        assert!(tracker.bars.is_empty());
    }

    #[test]
    fn test_add_one_item() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("test_task");
        assert_eq!(tracker.bars.len(), 1);
        assert!(handle.pb.message().contains("test_task"));
    }

    #[test]
    fn test_add_multiple_items() {
        let mut tracker = ProgressTracker::new();
        let h1 = tracker.add("task1");
        let h2 = tracker.add("task2");
        assert_eq!(tracker.bars.len(), 2);
        assert!(h1.pb.message().contains("task1"));
        assert!(h2.pb.message().contains("task2"));
    }

    // -- 状态转换 --

    #[test]
    fn test_pending_message() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        // Pending: 显示原始 label，未 finish
        assert!(handle.pb.message().contains("task"));
        assert!(!handle.pb.is_finished());
    }

    #[test]
    fn test_running_state() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        handle.set_running(Some("working"));
        // Running: 未 finish，消息含 label 和 status
        assert!(!handle.pb.is_finished());
        assert!(handle.pb.message().contains("task"));
        assert!(handle.pb.message().contains("working"));
    }

    #[test]
    fn test_running_without_status() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        handle.set_running(None);
        assert!(!handle.pb.is_finished());
        assert!(handle.pb.message().contains("task"));
        // 无 status 不应带括号后缀
        assert!(!handle.pb.message().contains("()"));
    }

    #[test]
    fn test_success_state() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        handle.set_running(None);
        handle.set_success(Some("done"));
        // Success: 已 finish，消息含 [✓] 前缀
        assert!(handle.pb.is_finished());
        let msg = handle.pb.message();
        assert!(msg.contains("[✓]"), "消息应含 [✓], got: {}", msg);
        assert!(msg.contains("task"), "消息应含 label, got: {}", msg);
        assert!(msg.contains("done"), "消息应含 summary, got: {}", msg);
    }

    #[test]
    fn test_failed_state() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        handle.set_running(None);
        handle.set_failed("error msg");
        assert!(handle.pb.is_finished());
        let msg = handle.pb.message();
        assert!(msg.contains("[✗]"), "消息应含 [✗], got: {}", msg);
        assert!(msg.contains("task"), "消息应含 label, got: {}", msg);
        assert!(msg.contains("error msg"), "消息应含 error, got: {}", msg);
    }

    // -- 多条目独立性 --

    #[test]
    fn test_multiple_items_independence() {
        let mut tracker = ProgressTracker::new();
        let h1 = tracker.add("task1");
        let h2 = tracker.add("task2");

        h1.set_running(Some("status1"));
        h2.set_running(Some("status2"));

        h1.set_success(Some("done"));
        assert!(h1.pb.is_finished(), "h1 应已完成");
        assert!(!h2.pb.is_finished(), "h2 应仍在运行");

        h2.set_success(None);
        assert!(h2.pb.is_finished(), "h2 应已完成");
    }

    // -- 边界情况 --

    #[test]
    fn test_empty_label() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("");
        handle.set_running(None);
        handle.set_success(None);
        assert!(handle.pb.is_finished());
    }

    #[test]
    fn test_success_without_running() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        // 不经过 Running 直接 Success
        handle.set_success(Some("direct"));
        assert!(handle.pb.is_finished());
        assert!(handle.pb.message().contains("[✓]"));
    }

    #[test]
    fn test_failed_without_running() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        handle.set_failed("direct");
        assert!(handle.pb.is_finished());
        assert!(handle.pb.message().contains("[✗]"));
    }

    #[test]
    fn test_success_without_summary() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        handle.set_success(None);
        assert!(handle.pb.is_finished());
        let msg = handle.pb.message();
        assert!(msg.contains("[✓]"));
        assert!(!msg.contains("()"));
    }

    #[test]
    fn test_status_update() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        handle.set_running(Some("initial"));
        assert!(handle.pb.message().contains("initial"));

        handle.set_status("updated");
        assert!(handle.pb.message().contains("updated"));
        assert!(!handle.pb.message().contains("initial"));
    }

    // -- close 行为 --

    #[test]
    fn test_close_empty_tracker() {
        let mut tracker = ProgressTracker::new();
        tracker.close();
    }

    #[test]
    fn test_close_with_items() {
        let mut tracker = ProgressTracker::new();
        let h = tracker.add("task");
        h.set_success(Some("done"));
        tracker.close();
        // close 后所有 bar 被 finish
        assert!(h.pb.is_finished());
    }

    #[test]
    fn test_close_unfinished_items() {
        let mut tracker = ProgressTracker::new();
        let h = tracker.add("task");
        // 不 finish 直接 close
        tracker.close();
        assert!(h.pb.is_finished());
    }

    // -- 大量条目 --

    #[test]
    fn test_many_items() {
        let mut tracker = ProgressTracker::new();
        let mut handles = Vec::new();
        for i in 0..100 {
            handles.push(tracker.add(format!("task_{}", i)));
        }
        assert_eq!(tracker.bars.len(), 100);
        for h in &handles {
            h.set_running(None);
        }
        for (i, h) in handles.iter().enumerate() {
            if i % 2 == 0 {
                h.set_success(Some("ok"));
            } else {
                h.set_failed("err");
            }
        }
        assert!(handles.iter().all(|h| h.pb.is_finished()));
    }

    // -- 线程安全 --

    #[test]
    fn test_handle_is_send() {
        fn assert_send<T: Send>(_: &T) {}
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        assert_send(&handle);
    }

    #[test]
    fn test_handle_is_sync() {
        fn assert_sync<T: Sync>(_: &T) {}
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        assert_sync(&handle);
    }

    // -- label 隔离（set_success 不应读到 running 阶段拼接的 status） --

    #[test]
    fn test_label_isolation_after_running_status() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        handle.set_running(Some("intermediate status"));
        assert!(handle.pb.message().contains("intermediate status"));

        handle.set_success(Some("final"));
        let msg = handle.pb.message();
        // 消息应包含 [✓] 和原始 label，但不应包含 running 阶段的 status
        assert!(msg.contains("[✓]"));
        assert!(msg.contains("task"));
        // "final" 是 success 阶段的新 summary，"intermediate" 是 running 阶段旧 status
        assert!(
            !msg.contains("intermediate"),
            "不应包含 running 阶段的 status"
        );
    }

    #[test]
    fn test_label_isolation_direct_success() {
        let mut tracker = ProgressTracker::new();
        let handle = tracker.add("task");
        handle.set_success(Some("done"));
        assert_eq!(
            handle.pb.message(),
            "[✓] task (done)",
            "消息格式不对: {}",
            handle.pb.message()
        );
    }
}
