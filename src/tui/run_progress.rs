//! RunProgress — run 命令的动态面板展示组件。
//!
//! 基于 `indicatif::MultiProgress`，管理一个包含状态行、任务列表、
//! 临时执行项、折叠行的动态终端面板。
//!
//! # 布局
//!
//! ```text
//! ┌─ [Status]    [LLM] 🤔 正在分析...                ← 常驻，滚动
//! ├─ [Task]      [✓] 分析项目结构                     ← 常驻，每 task 一行
//! ├─ [Task]      [⠋] 实现核心功能                     ← 常驻
//! ├─ [Collapsed] 📝 方案: 采用微服务...               ← 折叠行
//! ├─ [Exec]      📖 file_read  src/main.rs            ← 临时，执行完自动消失
//! ├─ [Exec]      🤖 subagent: 正在分析漏洞            ← 临时，执行完自动消失
//! ```

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use indicatif::{MultiProgress, ProgressBar, ProgressStyle};

use crate::output::SUPPRESS_TERMINAL;
use crate::tui::progress::ProgressHandle;

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/// 临时项完成后停留时间（秒）
const REMOVAL_DELAY_SECS: f64 = 1.5;
/// Spinner 动画刷新间隔（毫秒）
const TICK_INTERVAL_MS: u64 = 80;
/// Spinner 动画字符集（braille 点阵）
const TICK_CHARS: &str = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

// ---------------------------------------------------------------------------
// 样式模板
// ---------------------------------------------------------------------------

/// 状态行：绿色 spinner + 消息
const STATUS_TEMPLATE: &str = "{spinner:.green} {msg}";
/// 任务待执行：灰色文字，2 空格缩进
const TASK_PENDING_TEMPLATE: &str = "  {msg}";
/// 任务执行中：绿色 spinner + 灰色文字
const TASK_RUNNING_TEMPLATE: &str = "{spinner:.green} {msg:.dim}";
/// 任务完成：绿色文字
const TASK_DONE_TEMPLATE: &str = "{msg:.green}";
/// 折叠行：直接显示消息
const COLLAPSED_TEMPLATE: &str = "{msg}";
/// 临时执行项：青色 spinner + 消息
const TRANSIENT_RUNNING_TEMPLATE: &str = "{spinner:.cyan} {msg}";
/// 临时项完成
const TRANSIENT_DONE_TEMPLATE: &str = "{msg:.green}";
/// 临时项失败
const TRANSIENT_FAILED_TEMPLATE: &str = "{msg:.red}";

// ---------------------------------------------------------------------------
// 内部结构
// ---------------------------------------------------------------------------

struct Inner {
    task_bars: Vec<ProgressBar>,
    collapsed_bars: Vec<ProgressBar>,
    transient: Vec<TransientItem>,
}

struct TransientItem {
    id: u64,
    bar: ProgressBar,
    finished_at: Option<Instant>,
}

// ---------------------------------------------------------------------------
// Handle 类型
// ---------------------------------------------------------------------------

/// Task 行句柄
#[derive(Clone)]
pub struct TaskHandle {
    idx: usize,
}

/// 临时执行项句柄（命令/agent）
#[derive(Clone)]
pub struct TransientHandle {
    id: u64,
    /// 底层的 ProgressHandle，可直接调用 set_running/set_success/set_failed
    pub handle: ProgressHandle,
}

/// 折叠行句柄（方案/总结缩成一行后）
#[derive(Clone)]
pub struct CollapsedHandle {
    idx: usize,
}

// ---------------------------------------------------------------------------
// RunProgress
// ---------------------------------------------------------------------------

/// run 命令的动态面板展示组件。
pub struct RunProgress {
    mp: MultiProgress,
    status_bar: ProgressBar,
    inner: Mutex<Inner>,
    next_id: AtomicU64,
}

impl RunProgress {
    /// 创建一个新的进度面板，初始化状态行和任务区。
    pub fn new() -> Self {
        let mp = MultiProgress::new();
        let status_bar = mp.add(ProgressBar::new_spinner());
        status_bar.set_style(
            ProgressStyle::with_template(STATUS_TEMPLATE)
                .expect("STATUS_TEMPLATE 格式正确")
                .tick_chars(TICK_CHARS),
        );
        status_bar.set_message("");
        status_bar.enable_steady_tick(Duration::from_millis(TICK_INTERVAL_MS));

        RunProgress {
            mp,
            status_bar,
            inner: Mutex::new(Inner {
                task_bars: Vec::new(),
                collapsed_bars: Vec::new(),
                transient: Vec::new(),
            }),
            next_id: AtomicU64::new(1),
        }
    }

    // ── 状态行 ──

    /// 更新状态行文本。例如 `set_status("[LLM] 🤔 思考中...")`。
    pub fn set_status(&self, text: &str) {
        self.status_bar.set_message(text.to_string());
    }

    /// 获取当前状态行文本
    #[allow(dead_code)]
    pub fn status_text(&self) -> String {
        self.status_bar.message().to_string()
    }

    // ── Task 管理（常驻，不消失）──

    /// 添加一个 task 行，返回句柄用于后续状态更新。
    pub fn add_task(&self, label: &str) -> TaskHandle {
        let pb = self.mp.add(ProgressBar::new_spinner());
        pb.set_style(
            ProgressStyle::with_template(TASK_PENDING_TEMPLATE)
                .expect("TASK_PENDING_TEMPLATE 格式正确"),
        );
        pb.set_message(format!("[ ] {}", label));

        let mut inner = self.inner.lock().unwrap();
        let idx = inner.task_bars.len();
        inner.task_bars.push(pb);
        TaskHandle { idx }
    }

    /// 更新 task 行的文本但不改变样式（由调用方自行管理 ProgressBar 样式）
    pub fn set_task_text(&self, handle: &TaskHandle, text: &str) {
        let inner = self.inner.lock().unwrap();
        if let Some(pb) = inner.task_bars.get(handle.idx) {
            pb.set_message(text.to_string());
        }
    }

    /// 将 task 标记为「执行中」（带 spinner）
    pub fn set_task_running(&self, handle: &TaskHandle, text: &str) {
        let inner = self.inner.lock().unwrap();
        if let Some(pb) = inner.task_bars.get(handle.idx) {
            pb.set_style(
                ProgressStyle::with_template(TASK_RUNNING_TEMPLATE)
                    .expect("TASK_RUNNING_TEMPLATE 格式正确")
                    .tick_chars(TICK_CHARS),
            );
            pb.set_message(text.to_string());
            pb.enable_steady_tick(Duration::from_millis(TICK_INTERVAL_MS));
        }
    }

    /// 将 task 标记为「已完成」（显示 ✓）
    pub fn set_task_done(&self, handle: &TaskHandle, text: &str) {
        let inner = self.inner.lock().unwrap();
        if let Some(pb) = inner.task_bars.get(handle.idx) {
            pb.set_style(
                ProgressStyle::with_template(TASK_DONE_TEMPLATE)
                    .expect("TASK_DONE_TEMPLATE 格式正确"),
            );
            pb.finish_with_message(format!("[✓] {}", text));
        }
    }

    /// 将 task 标记为「失败」（显示 ✗）
    pub fn set_task_failed(&self, handle: &TaskHandle, text: &str) {
        let inner = self.inner.lock().unwrap();
        if let Some(pb) = inner.task_bars.get(handle.idx) {
            pb.set_style(
                ProgressStyle::with_template(TRANSIENT_FAILED_TEMPLATE)
                    .expect("TRANSIENT_FAILED_TEMPLATE 格式正确"),
            );
            pb.finish_with_message(format!("[✗] {}", text));
        }
    }

    // ── 临时执行项（命令/agent，执行完自动消失）──

    /// 添加一个临时执行项，返回 [`TransientHandle`]。
    ///
    /// 调用方可使用 `handle.handle.set_running/set_success/set_failed` 控制状态。
    /// 完成后调用 [`finish_item`](Self::finish_item) 使其短暂停留后自动消失。
    pub fn start_item(&self, label: &str) -> TransientHandle {
        let pb = self.mp.add(ProgressBar::new_spinner());
        pb.set_style(
            ProgressStyle::with_template(TRANSIENT_RUNNING_TEMPLATE)
                .expect("TRANSIENT_RUNNING_TEMPLATE 格式正确")
                .tick_chars(TICK_CHARS),
        );
        pb.set_message(label.to_string());
        pb.enable_steady_tick(Duration::from_millis(TICK_INTERVAL_MS));

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let handle = ProgressHandle::new(pb.clone(), label.to_string());

        let mut inner = self.inner.lock().unwrap();
        inner.transient.push(TransientItem {
            id,
            bar: pb,
            finished_at: None,
        });

        TransientHandle { id, handle }
    }

    /// 标记临时项已完成（仅记录时间，不修改视觉）。
    /// 适用于视觉已由 handle 直接控制完成的场景（如并发执行路径）。
    pub fn mark_item_completed(&self, handle: &TransientHandle) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(item) = inner.transient.iter_mut().find(|t| t.id == handle.id) {
            item.finished_at = Some(Instant::now());
        }
    }

    /// 标记临时项为完成状态，短暂显示 ✅/✗ 后自动消失。
    ///
    /// `success`: true 显示 ✅，false 显示 ✗。
    /// `summary`: 可选的完成描述（如耗时 "0.5s"），显示在行末括号中。
    pub fn finish_item(&self, handle: &TransientHandle, success: bool, summary: Option<&str>) {
        // 通过 ProgressHandle 设置最终状态
        if success {
            handle.handle.set_success(summary);
        } else {
            handle.handle.set_failed(summary.unwrap_or("failed"));
        }

        // 记录完成时间（用于 tick 延迟移除）
        let mut inner = self.inner.lock().unwrap();
        if let Some(item) = inner.transient.iter_mut().find(|t| t.id == handle.id) {
            item.finished_at = Some(Instant::now());
        }
    }

    /// 检查并移除已到期的临时项。应在 round 循环结束后调用。
    pub fn tick(&self) {
        let mut inner = self.inner.lock().unwrap();
        let now = Instant::now();
        inner.transient.retain(|item| {
            if let Some(finished_at) = item.finished_at
                && now.duration_since(finished_at).as_secs_f64() >= REMOVAL_DELAY_SECS
            {
                item.bar.finish_and_clear();
                self.mp.remove(&item.bar);
                return false;
            }
            true
        });
    }

    // ── 折叠行（方案/总结缩成一行常驻）──

    /// 添加一个折叠行。`prefix` 和 `text` 拼接后显示。
    /// 例如 `add_collapsed("📝 方案:", "采用微服务架构...")`。
    pub fn add_collapsed(&self, prefix: &str, text: &str) -> CollapsedHandle {
        let pb = self.mp.add(ProgressBar::new_spinner());
        pb.set_style(
            ProgressStyle::with_template(COLLAPSED_TEMPLATE).expect("COLLAPSED_TEMPLATE 格式正确"),
        );
        let display = format!("{} {}", prefix, text);
        pb.set_message(display);
        pb.finish();

        let mut inner = self.inner.lock().unwrap();
        let idx = inner.collapsed_bars.len();
        inner.collapsed_bars.push(pb);
        CollapsedHandle { idx }
    }

    /// 更新折叠行文本
    pub fn set_collapsed_text(&self, handle: &CollapsedHandle, prefix: &str, text: &str) {
        let inner = self.inner.lock().unwrap();
        if let Some(pb) = inner.collapsed_bars.get(handle.idx) {
            let display = format!("{} {}", prefix, text);
            pb.set_message(display);
        }
    }

    // ── 完整内容展示 ──

    /// 暂停面板，展示完整文本内容，等待交互后恢复面板。
    ///
    /// 在 Plan 模式下展示方案全文、总结全文时使用。
    /// `title` 为内容标题，`body` 为全文，`interact` 为交互闭包。
    pub fn show_full_content<F, T>(&self, title: &str, body: &str, interact: F) -> T
    where
        F: FnOnce() -> T,
    {
        // 1. 暂停 status bar 动画
        self.status_bar.disable_steady_tick();

        // 2. 清空面板
        self.mp.clear().ok();
        std::thread::sleep(Duration::from_millis(200));

        // 3. 临时恢复 TerminalTarget 输出
        SUPPRESS_TERMINAL.store(false, Ordering::Relaxed);
        std::thread::sleep(Duration::from_millis(100));

        // 4. 打印完整内容
        println!();
        println!("─── {} ───", title);
        for line in body.lines() {
            println!("{}", line);
        }
        println!();

        // 5. 执行交互
        let result = interact();

        // 6. 重新静默 TerminalTarget
        SUPPRESS_TERMINAL.store(true, Ordering::Relaxed);
        std::thread::sleep(Duration::from_millis(100));

        // 7. 清空残留内容，恢复面板
        self.mp.clear().ok();
        self.status_bar
            .enable_steady_tick(Duration::from_millis(TICK_INTERVAL_MS));

        result
    }

    // ── 暂停/恢复（用于交互式工具执行时避免与 crossterm 冲突）──

    /// 暂停所有 spinner 动画和面板刷新。
    /// 在交互式工具（如 ask_user）执行前调用，避免与 crossterm 原始模式冲突。
    pub fn pause(&self) {
        self.status_bar.disable_steady_tick();
        let inner = self.inner.lock().unwrap();
        for item in &inner.transient {
            item.bar.disable_steady_tick();
        }
    }

    /// 恢复所有 spinner 动画和面板刷新。
    /// 在交互式工具执行完成后调用。
    pub fn resume(&self) {
        self.status_bar
            .enable_steady_tick(Duration::from_millis(TICK_INTERVAL_MS));
        let inner = self.inner.lock().unwrap();
        for item in &inner.transient {
            item.bar
                .enable_steady_tick(Duration::from_millis(TICK_INTERVAL_MS));
        }
    }

    // ── 清理 ──

    /// 关闭面板，清理所有进度行。
    ///
    /// 调用后终端恢复到普通模式，需配合 [`TerminalGuard`](crate::output::TerminalGuard) 释放来恢复 TerminalTarget。
    pub fn finalize(self) {
        self.status_bar.finish_and_clear();

        // 直接访问内部所有 bars 并清理
        if let Ok(inner) = self.inner.lock() {
            for item in &inner.transient {
                item.bar.finish_and_clear();
            }
            for bar in &inner.task_bars {
                bar.finish_and_clear();
            }
            for bar in &inner.collapsed_bars {
                bar.finish_and_clear();
            }
        }

        self.mp.clear().ok();
        // self 析构时，所有 bars 和 mp 被释放，draw 线程停止
    }
}

impl Default for RunProgress {
    fn default() -> Self {
        Self::new()
    }
}

// ── ProgressReporter trait 实现 ──

/// 为 ProgressHandle 实现 HandleLike trait。
/// 使得 TrackerHandle（ProgressHandle 的包装）可以直接通过 trait 方法控制状态。
impl crate::agent::progress::HandleLike for TransientHandle {
    fn set_running(&self, status: Option<&str>) {
        self.handle.set_running(status);
    }

    fn set_success(&self, summary: Option<&str>) {
        self.handle.set_success(summary);
    }

    fn set_failed(&self, error: &str) {
        self.handle.set_failed(error);
    }
}

impl crate::agent::progress::ProgressReporter for RunProgress {
    type Handle = TransientHandle;

    fn set_status(&self, text: &str) {
        self.set_status(text);
    }

    fn start_item(&self, label: &str) -> TransientHandle {
        self.start_item(label)
    }

    fn finish_item(&self, handle: &TransientHandle, success: bool, summary: Option<&str>) {
        self.finish_item(handle, success, summary);
    }

    fn mark_item_completed(&self, handle: &TransientHandle) {
        self.mark_item_completed(handle);
    }

    fn tick(&self) {
        self.tick();
    }

    fn pause(&self) {
        self.pause();
    }

    fn resume(&self) {
        self.resume();
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new() {
        let rp = RunProgress::new();
        // 创建后至少应有 status_bar
        assert_eq!(rp.status_bar.message(), "");
    }

    #[test]
    fn test_set_status() {
        let rp = RunProgress::new();
        rp.set_status("[LLM] 测试状态");
        assert_eq!(rp.status_bar.message(), "[LLM] 测试状态");
    }

    #[test]
    fn test_add_task() {
        let rp = RunProgress::new();
        let handle = rp.add_task("测试任务");
        // 勾柄 idx 应为 0（第一个 task）
        assert_eq!(handle.idx, 0);
    }

    #[test]
    fn test_add_collapsed() {
        let rp = RunProgress::new();
        let handle = rp.add_collapsed("📝 方案:", "测试方案");
        assert_eq!(handle.idx, 0);
        // collapsed 行应在 status_bar 之前（insert_before）
    }

    #[test]
    fn test_start_and_finish_item() {
        let rp = RunProgress::new();
        let th = rp.start_item("📖 read_file test.rs");
        // 标记完成
        rp.finish_item(&th, true, Some("0.5s"));
        // tick 应保留该条目（时间未到）
        rp.tick();
    }

    #[test]
    fn test_finalize() {
        let rp = RunProgress::new();
        rp.set_status("准备结束");
        let _ = rp.add_task("任务1");
        rp.finalize();
        // finalize 后不应 panic
    }
}
