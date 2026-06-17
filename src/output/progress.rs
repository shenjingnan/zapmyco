//! 进度输出目标——使用 indicatif 将临时性过程输出渲染为紧凑的 spinner 显示。
//!
//! ProgressTarget 用 AtomicBool 控制是否处于"进度显示模式"：
//!
//! - **非活跃**（默认）：所有消息直接 println!/eprintln! 输出到终端
//! - **活跃**（收到第一个 LlmThinking 后激活）：LLM 思考/工具调用由 spinner 渲染，
//!   非进度消息（Info 等）通过 `mp.println()` 显示在 spinner 上方
//!
//! 收到 ResultLine/ResultBlock/Warning/Error 后退出活跃模式，清除 spinner。

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

use indicatif::{MultiProgress, ProgressBar, ProgressStyle};

use crate::output::{self, Channel, Message, MessageKind, Target};

/// Progress 消息是否活跃（TerminalTarget 检查此标志以抑制进度类消息）
pub static PROGRESS_ACTIVE: AtomicBool = AtomicBool::new(false);

/// 进度输出目标
pub struct ProgressTarget {
    mp: MultiProgress,
    spinner: ProgressBar,
    /// 是否已进入进度显示模式（收到第一个 LlmThinking 后为 true）
    active: AtomicBool,
    /// 当前对话轮次
    round: AtomicU32,
    /// 本轮工具总数
    tool_total: AtomicUsize,
    /// 本轮已完成工具数
    tool_done: AtomicUsize,
}

// AtomicU32 和 AtomicUsize 是 Send + Sync
use std::sync::atomic::{AtomicU32, AtomicUsize};

impl Default for ProgressTarget {
    fn default() -> Self {
        Self::new()
    }
}

impl ProgressTarget {
    /// 创建 ProgressTarget
    pub fn new() -> Self {
        let mp = MultiProgress::new();
        let spinner = ProgressBar::new_spinner();
        spinner.set_style(
            ProgressStyle::default_spinner()
                .tick_chars("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏")
                .template("{spinner} {msg}")
                .unwrap(),
        );
        spinner.enable_steady_tick(std::time::Duration::from_millis(80));

        let mp_spinner = mp.add(spinner);
        PROGRESS_ACTIVE.store(true, Ordering::Release);

        ProgressTarget {
            mp,
            spinner: mp_spinner,
            active: AtomicBool::new(false),
            round: AtomicU32::new(0),
            tool_total: AtomicUsize::new(0),
            tool_done: AtomicUsize::new(0),
        }
    }

    /// 进入活跃模式（首次收到 LlmThinking 时调用）
    fn activate(&self) {
        if !self.active.load(Ordering::Acquire) {
            self.active.store(true, Ordering::Release);
            self.spinner.set_message("🤔 LLM 思考中...");
        }
    }

    /// 退出活跃模式，清除 spinner
    fn deactivate(&self) {
        if self.active.load(Ordering::Acquire) {
            self.active.store(false, Ordering::Release);
            self.spinner.finish_and_clear();
        }
    }

    /// 更新主 spinner 消息
    fn set_msg(&self, msg: impl Into<String>) {
        self.spinner.set_message(msg.into());
    }

    /// 在进度区域上方打印一行日志
    fn println_above(&self, text: impl Into<String>) {
        let t = text.into();
        if !t.is_empty() {
            let _ = self.mp.println(t);
        }
    }

    /// 直接打印消息到对应通道（非活跃模式/结果类消息）
    fn print_direct(kind: MessageKind, text: &str) {
        if text.is_empty() {
            return;
        }
        let channel = output::terminal::TerminalTarget::channel_for(kind);
        match channel {
            Channel::Stdout => println!("{}", text),
            Channel::Stderr => eprintln!("{}", text),
            Channel::Stream => {
                eprint!("{}", text);
                std::io::stderr().flush().ok();
            }
        }
    }

    /// 从 ToolOutput 文本中提取工具名称和状态
    fn parse_tool_output(text: &str) -> (bool, String) {
        let text = text.trim();
        let text = text.strip_prefix("[工具] ").unwrap_or(text);
        let is_ok = !text.contains('❌');
        // 跳过前导 emoji/符号，找到第一个字母数字的词作为工具名
        let name = text
            .split_whitespace()
            .find(|w| w.chars().next().is_some_and(|c| c.is_alphanumeric()))
            .unwrap_or("?")
            .to_string();
        (is_ok, name)
    }

    /// 更新工具完成计数后的 spinner 消息
    fn update_tool_progress(&self) {
        let done = self.tool_done.load(Ordering::Acquire);
        let total = self.tool_total.load(Ordering::Acquire);
        let remaining = total.saturating_sub(done);
        if remaining > 0 {
            self.set_msg(format!(
                "📋 已完成 {}/{} 个 (剩余 {})",
                done, total, remaining
            ));
        } else {
            self.set_msg("📋 本轮工具调用完成".to_string());
        }
    }
}

impl Target for ProgressTarget {
    fn name(&self) -> &'static str {
        "progress"
    }

    fn on_message(&self, msg: &Message) {
        // ── 非活跃模式：只监听 LlmThinking 激活，其他消息由 TerminalTarget 处理 ──
        if !self.active.load(Ordering::Acquire) {
            if msg.kind == MessageKind::LlmThinking {
                self.activate();
                self.round.store(0, Ordering::Release);
                self.tool_total.store(0, Ordering::Release);
                self.tool_done.store(0, Ordering::Release);
            }
            return;
        }

        // ── 活跃模式 ──
        match msg.kind {
            MessageKind::LlmThinking => {
                // 新一轮思考，重置工具计数
                self.tool_total.store(0, Ordering::Release);
                self.tool_done.store(0, Ordering::Release);
                self.round.fetch_add(1, Ordering::AcqRel);
                let r = self.round.load(Ordering::Acquire);
                self.set_msg(format!("🤔 LLM 思考中... (round {})", r));
            }

            MessageKind::LlmUsage => {
                // 从 msg.text 提取用量信息附加到 spinner
                let text = msg.text.trim();
                let usage = text.strip_prefix("[LLM]").unwrap_or(text).trim();
                self.set_msg(format!("🤔 {}", usage));
            }

            MessageKind::ToolCall => {
                // 提取工具数量并设置 spinner 消息
                let text = msg.text.trim();
                let summary = text.strip_prefix("[工具]").unwrap_or(text).trim();
                let count = summary
                    .split_whitespace()
                    .nth(1)
                    .and_then(|s| s.parse::<usize>().ok())
                    .unwrap_or(0);
                self.tool_total.store(count, Ordering::Release);
                self.tool_done.store(0, Ordering::Release);
                self.set_msg(format!("📋 {}", summary));
            }

            MessageKind::ToolResult => {
                let name = msg
                    .data
                    .as_ref()
                    .and_then(|d| d.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("?");
                let duration_ms = msg
                    .data
                    .as_ref()
                    .and_then(|d| d.get("duration_ms"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let detail = msg
                    .data
                    .as_ref()
                    .and_then(|d| d.get("detail"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                self.tool_done.fetch_add(1, Ordering::AcqRel);
                self.println_above(format!(
                    "  ✅ {} {} ({:.1}s)",
                    name,
                    detail,
                    duration_ms as f64 / 1000.0
                ));
                self.update_tool_progress();
            }

            MessageKind::ToolError => {
                let name = msg
                    .data
                    .as_ref()
                    .and_then(|d| d.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("?");
                let error = msg
                    .data
                    .as_ref()
                    .and_then(|d| d.get("error"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("?");

                self.tool_done.fetch_add(1, Ordering::AcqRel);
                self.println_above(format!("  ❌ {}: {}", name, error));
                self.update_tool_progress();
            }

            MessageKind::ToolOutput => {
                let (_is_ok, _name) = Self::parse_tool_output(&msg.text);
                self.tool_done.fetch_add(1, Ordering::AcqRel);
                self.println_above(msg.text.trim().to_string());
                self.update_tool_progress();
            }

            // 最终结果 → 退出活跃模式
            MessageKind::ResultLine | MessageKind::ResultBlock => {
                self.deactivate();
                Self::print_direct(msg.kind, &msg.text);
            }

            MessageKind::Warning | MessageKind::Error => {
                self.deactivate();
                Self::print_direct(msg.kind, &msg.text);
            }

            MessageKind::TaskDone => {
                self.deactivate();
                Self::print_direct(msg.kind, &msg.text);
            }

            // 非进度消息 → 打印在 spinner 上方
            MessageKind::Info
            | MessageKind::TaskPending
            | MessageKind::SkillLoaded
            | MessageKind::SubAgentInfo
            | MessageKind::UpgradePhase
            | MessageKind::UpgradeDone
            | MessageKind::NoteInfo => {
                self.println_above(&msg.text);
            }

            // LlmChunk → 实时流式文本，忽略（由 TerminalTarget 处理或忽略）
            MessageKind::LlmChunk => {}
        }
    }
}

impl Drop for ProgressTarget {
    fn drop(&mut self) {
        self.spinner.finish_and_clear();
        PROGRESS_ACTIVE.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_progress_active_flag() {
        assert!(!PROGRESS_ACTIVE.load(Ordering::Acquire));
        {
            let _pt = ProgressTarget::new();
            assert!(PROGRESS_ACTIVE.load(Ordering::Acquire));
        }
        assert!(!PROGRESS_ACTIVE.load(Ordering::Acquire));
    }

    #[test]
    fn test_parse_tool_output_success() {
        let text = "[工具] 🔍 file_find **/*.rs  (0.2s, 2284 字符)";
        let (ok, name) = ProgressTarget::parse_tool_output(text);
        assert!(ok);
        assert_eq!(name, "file_find");
    }

    #[test]
    fn test_parse_tool_output_error() {
        let text = "[工具] ⚠️ 🔍 file_find **/*.rs  ❌ 失败: not found";
        let (ok, name) = ProgressTarget::parse_tool_output(text);
        assert!(!ok);
        assert_eq!(name, "file_find");
    }

    #[test]
    fn test_parse_tool_output_unknown() {
        let text = "[工具] ❌ file_find  Unknown tool";
        let (ok, name) = ProgressTarget::parse_tool_output(text);
        assert!(!ok);
        assert_eq!(name, "file_find");
    }

    #[test]
    fn test_parse_tool_output_without_prefix() {
        let text = "📖 file_read src/main.rs  (0.0s, 806 字符)";
        let (ok, name) = ProgressTarget::parse_tool_output(text);
        assert!(ok);
        assert_eq!(name, "file_read");
    }

    #[test]
    fn test_initial_state_not_active() {
        let pt = ProgressTarget::new();
        assert!(!pt.active.load(Ordering::Acquire));
    }

    #[test]
    fn test_llm_thinking_activates() {
        let pt = ProgressTarget::new();
        pt.on_message(&Message::info("before"));
        assert!(!pt.active.load(Ordering::Acquire));

        pt.on_message(&Message::llm_chunk("thinking..."));
        assert!(!pt.active.load(Ordering::Acquire));

        pt.on_message(&Message {
            kind: MessageKind::LlmThinking,
            text: String::new(),
            data: None,
        });
        assert!(pt.active.load(Ordering::Acquire));
    }

    #[test]
    fn test_result_line_deactivates() {
        let pt = ProgressTarget::new();

        // 激活
        pt.on_message(&Message {
            kind: MessageKind::LlmThinking,
            text: String::new(),
            data: None,
        });
        assert!(pt.active.load(Ordering::Acquire));

        // 结果消消激活
        pt.on_message(&Message::result("done"));
        assert!(!pt.active.load(Ordering::Acquire));
    }
}
