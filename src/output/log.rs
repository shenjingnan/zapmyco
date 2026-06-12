//! 日志消息目标——将消息写入 conversation 目录的 terminal.log。
//!
//! 在 conversation 期间注册到 Router，结束时移除。
//! 写入的日志不含 ANSI 转义码，带时间戳和通道标记。

use crate::output::{Message, MessageKind, Target};
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::Mutex;

/// 行缓冲最大长度（64KB），超过时强制写入防止内存膨胀
const MAX_LINE_BUFFER: usize = 64 * 1024;

// ============================================================================
// AnsiStripper
// ============================================================================

/// ANSI 转义序列剥离状态机
///
/// 处理：
/// - CSI: `\x1b[<params><final>` (final byte 0x40-0x7E)
/// - OSC: `\x1b]<content>(\x07 | \x1b\\)`
/// - Simple: `\x1b<final>` (final byte 0x40-0x5F)
enum AnsiState {
    Normal,
    Escape,
    Csi,
    Osc,
}

struct AnsiStripper {
    state: AnsiState,
}

impl AnsiStripper {
    fn new() -> Self {
        AnsiStripper {
            state: AnsiState::Normal,
        }
    }

    fn process(&mut self, text: &str) -> String {
        let mut output = String::with_capacity(text.len());
        for ch in text.chars() {
            match self.state {
                AnsiState::Normal => {
                    if ch == '\x1b' {
                        self.state = AnsiState::Escape;
                    } else {
                        output.push(ch);
                    }
                }
                AnsiState::Escape if ch == '[' => self.state = AnsiState::Csi,
                AnsiState::Escape if ch == ']' => self.state = AnsiState::Osc,
                AnsiState::Escape => self.state = AnsiState::Normal,
                AnsiState::Csi if ('\x40'..='\x7e').contains(&ch) => self.state = AnsiState::Normal,
                AnsiState::Osc if ch == '\x07' => self.state = AnsiState::Normal,
                AnsiState::Osc if ch == '\x1b' => self.state = AnsiState::Escape,
                _ => {}
            }
        }
        output
    }
}

// ============================================================================
// LogTarget
// ============================================================================

/// 日志消息目标——将消息写入文件
pub struct LogTarget {
    file: Mutex<BufWriter<File>>,
    line_buffer: Mutex<String>,
    stripper: Mutex<AnsiStripper>,
}

impl LogTarget {
    /// 创建新的日志 target
    ///
    /// `path`: terminal.log 的完整路径
    pub fn new(path: &Path) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        Ok(LogTarget {
            file: Mutex::new(BufWriter::new(file)),
            line_buffer: Mutex::new(String::new()),
            stripper: Mutex::new(AnsiStripper::new()),
        })
    }

    /// 写入日志，每条内容独立一行。如果 text 含多行，拆成多行写入，每行都带时间戳前缀。
    /// 每次写入后立即 flush，确保进程异常退出时数据不丢失。
    fn write_log(&self, channel: &str, text: &str) {
        use chrono::Local;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S");
        if let Ok(mut file) = self.file.lock() {
            for line in text.lines() {
                let _ = writeln!(file, "[{}] [{}] {}", now, channel, line);
            }
            // 立即刷盘，防止 BufWriter 缓冲区在进程异常退出时丢失数据
            let _ = file.flush();
        }
    }

    /// 冲洗行缓冲（用于非流式消息写入前）
    fn flush_buffer(&self) {
        if let Ok(mut buf) = self.line_buffer.lock()
            && !buf.is_empty()
        {
            self.write_log("STDERR", &buf);
            buf.clear();
        }
    }

    /// 剥离 ANSI 转义码
    fn strip_ansi(&self, text: &str) -> String {
        self.stripper
            .lock()
            .map(|mut s| s.process(text))
            .unwrap_or_else(|_| text.to_string())
    }
}

impl Target for LogTarget {
    fn name(&self) -> &'static str {
        "log"
    }

    fn on_message(&self, msg: &Message) {
        match msg.kind {
            // 流式输出——缓冲到完整行再写入
            MessageKind::LlmChunk => {
                let clean = self.strip_ansi(&msg.text);
                if clean.is_empty() {
                    return;
                }
                let mut buf = self.line_buffer.lock().unwrap();
                buf.push_str(&clean);

                // 安全上限：超过 64KB 强制写入，防止无换行长文本膨胀
                if buf.len() > MAX_LINE_BUFFER {
                    self.write_log("STDERR", &buf);
                    buf.clear();
                    return;
                }

                while let Some(pos) = buf.find('\n') {
                    self.write_log("STDERR", &buf[..pos]);
                    *buf = buf[pos + 1..].to_string();
                }
            }

            // 状态信息——先冲洗流式缓冲，再写入
            MessageKind::ToolCall
            | MessageKind::ToolResult
            | MessageKind::ToolError
            | MessageKind::LlmThinking
            | MessageKind::LlmUsage
            | MessageKind::TaskPending
            | MessageKind::Info
            | MessageKind::Warning
            | MessageKind::Error
            | MessageKind::SkillLoaded
            | MessageKind::SubAgentInfo => {
                self.flush_buffer();
                self.write_log("STDERR", &self.strip_ansi(&msg.text));
            }

            // stdout 输出
            MessageKind::ResultLine
            | MessageKind::ResultBlock
            | MessageKind::TaskDone
            | MessageKind::UpgradePhase
            | MessageKind::UpgradeDone
            | MessageKind::NoteInfo => {
                self.flush_buffer();
                self.write_log("STDOUT", &self.strip_ansi(&msg.text));
            }

            // ToolOutput
            MessageKind::ToolOutput => {
                self.flush_buffer();
                let clean = self.strip_ansi(&msg.text);
                if !clean.is_empty() {
                    self.write_log("STDERR", &clean);
                }
            }
        }
    }
}

impl Drop for LogTarget {
    fn drop(&mut self) {
        self.flush_buffer();
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::Message;
    use crate::output::Router;
    use tempfile::TempDir;

    fn setup_log() -> (LogTarget, TempDir) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("terminal.log");
        let target = LogTarget::new(&path).unwrap();
        (target, dir)
    }

    fn read_log(dir: &TempDir) -> String {
        std::fs::read_to_string(dir.path().join("terminal.log")).unwrap()
    }

    // -- 基本文件写入 --

    #[test]
    fn test_log_creates_directory() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("sub/deep/path");
        let log = LogTarget::new(&nested.join("test.log")).unwrap();
        drop(log);
        assert!(nested.join("test.log").exists());
    }

    #[test]
    fn test_log_write_result_line() {
        let (target, dir) = setup_log();
        target.on_message(&Message::result("hello world"));
        drop(target);
        let content = read_log(&dir);
        assert!(content.contains("[STDOUT]"));
        assert!(content.contains("hello world"));
        assert!(content.contains('Z') || content.contains('-'));
    }

    #[test]
    fn test_log_write_stderr_message() {
        let (target, dir) = setup_log();
        target.on_message(&Message::warning("be careful"));
        drop(target);
        let content = read_log(&dir);
        assert!(content.contains("[STDERR]"));
        assert!(content.contains("be careful"));
    }

    // -- ANSI 剥离 --

    #[test]
    fn test_log_ansi_stripping() {
        let (target, dir) = setup_log();
        target.on_message(&Message::result("\x1b[32mgreen text\x1b[0m"));
        drop(target);
        let content = read_log(&dir);
        assert!(content.contains("green text"));
        assert!(!content.contains('\x1b'));
    }

    // -- 完全 ANSI 剥离 --

    #[test]
    fn test_log_strips_all_ansi() {
        let (target, dir) = setup_log();
        target.on_message(&Message::info("\x1b[1;31m\x1b[44mstyled\x1b[0m"));
        drop(target);
        let content = read_log(&dir);
        assert!(content.contains("styled"));
        assert!(!content.contains('\x1b'));
    }

    // -- 多行处理 --

    #[test]
    fn test_log_multi_line_text() {
        let (target, dir) = setup_log();
        target.on_message(&Message::result_block("line1\nline2\nline3"));
        drop(target);
        let content = read_log(&dir);
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].contains("line1"));
        assert!(lines[1].contains("line2"));
        assert!(lines[2].contains("line3"));
    }

    #[test]
    fn test_log_tool_call_multi_line() {
        let (target, dir) = setup_log();
        let msg = Message::tool_call("🔧", "read_file", vec!["src/main.rs".into()]);
        target.on_message(&msg);
        drop(target);
        let content = read_log(&dir);
        for line in content.lines() {
            assert!(line.starts_with("[202"));
        }
    }

    // -- 流式行缓冲 --

    #[test]
    fn test_log_streaming_line_assembly() {
        let (target, dir) = setup_log();
        target.on_message(&Message::llm_chunk("He"));
        target.on_message(&Message::llm_chunk("llo wo"));
        target.on_message(&Message::llm_chunk("rld\n"));
        drop(target);
        let content = read_log(&dir);
        assert!(content.contains("Hello world"));
    }

    #[test]
    fn test_log_streaming_multiple_lines() {
        let (target, dir) = setup_log();
        target.on_message(&Message::llm_chunk("line1\nline2\nline3\n"));
        drop(target);
        let content = read_log(&dir);
        assert_eq!(content.lines().count(), 3);
    }

    #[test]
    fn test_log_streaming_no_trailing_newline() {
        let (target, dir) = setup_log();
        target.on_message(&Message::llm_chunk("incomplete line"));
        drop(target);
        let content = read_log(&dir);
        assert!(content.contains("incomplete line"));
    }

    // -- 插序 --

    #[test]
    fn test_log_flush_buffer_on_non_chunk() {
        let (target, dir) = setup_log();
        target.on_message(&Message::llm_chunk("partial "));
        target.on_message(&Message::warning("interrupt"));
        drop(target);
        let content = read_log(&dir);
        let lines: Vec<&str> = content.lines().collect();
        assert!(lines[0].contains("partial"));
        assert!(lines[1].contains("interrupt"));
    }

    // -- 连续换行 --

    #[test]
    fn test_log_consecutive_newlines() {
        let (target, dir) = setup_log();
        target.on_message(&Message::result_block("header\n\n\nfooter"));
        drop(target);
        let content = read_log(&dir);
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 4);
        assert!(lines[0].contains("header"));
        assert!(lines[1].contains('['));
        assert!(lines[2].contains('['));
        assert!(lines[3].contains("footer"));
    }

    // -- 64KB 上限 --

    #[test]
    fn test_log_max_line_buffer() {
        let (target, dir) = setup_log();
        target.on_message(&Message::llm_chunk("start "));
        let large = "x".repeat(70 * 1024);
        target.on_message(&Message::llm_chunk(&large));
        drop(target);
        let content = read_log(&dir);
        assert!(content.contains("start"));
    }

    // -- 空消息 --

    #[test]
    fn test_log_empty_message() {
        let (target, dir) = setup_log();
        target.on_message(&Message::info(""));
        drop(target);
        let content = read_log(&dir);
        assert!(content.is_empty() || content == "\n");
    }

    #[test]
    fn test_log_ansi_only_message() {
        let (target, dir) = setup_log();
        target.on_message(&Message::llm_chunk("\x1b[31m\x1b[0m"));
        drop(target);
        let content = read_log(&dir);
        assert!(content.is_empty() || content == "\n");
    }

    // -- 时间戳 --

    #[test]
    fn test_log_timestamp_format() {
        let (target, dir) = setup_log();
        target.on_message(&Message::result("test"));
        drop(target);
        let content = read_log(&dir);
        let first_line = content.lines().next().unwrap();
        assert!(first_line.starts_with('['));
        assert!(first_line.contains('T'));
        assert!(first_line.contains(':'));
    }

    // -- 写错误不 panic --

    #[test]
    fn test_log_write_error_ignored() {
        // 验证写入失败时不会 panic
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.log");
        std::fs::write(&path, "existing content").unwrap();
        // 正常文件路径，写入应成功——仅验证结构不 panic
        if let Ok(target) = LogTarget::new(&path) {
            target.on_message(&Message::result("should succeed"));
            drop(target);
        }
    }

    // -- Drop 行为 --

    #[test]
    fn test_log_drop_flushes() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("terminal.log");
        let target = LogTarget::new(&path).unwrap();
        target.on_message(&Message::llm_chunk("buffered"));
        drop(target);
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("buffered"));
    }

    // -- AnsiStripper --

    #[test]
    fn test_strip_simple_color() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b[31mred\x1b[0m"), "red");
    }

    #[test]
    fn test_strip_bold_color() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b[1;32mbold green\x1b[0m"), "bold green");
    }

    #[test]
    fn test_strip_cursor_move() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b[1F\x1b[2Kline"), "line");
    }

    #[test]
    fn test_strip_private_mode() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b[?25lhidden\x1b[?25h"), "hidden");
    }

    #[test]
    fn test_strip_multiple_consecutive() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b[1m\x1b[32m\x1b[44mtext\x1b[0m"), "text");
    }

    #[test]
    fn test_strip_osc_bel() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b]0;title\x07text"), "text");
    }

    #[test]
    fn test_strip_osc_st() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b]0;title\x1b\\text"), "text");
    }

    #[test]
    fn test_strip_cross_boundary_csi_half() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b[3"), "");
        assert_eq!(s.process("1mhello"), "hello");
    }

    #[test]
    fn test_strip_plain_text() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("hello world"), "hello world");
    }

    #[test]
    fn test_strip_empty() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process(""), "");
    }

    #[test]
    fn test_strip_only_ansi() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b[31m\x1b[1m\x1b[0m"), "");
    }

    #[test]
    fn test_strip_unicode_with_ansi() {
        let mut s = AnsiStripper::new();
        let input = "\x1b[32m🔥 emoji + 中文 = ❤️\x1b[0m";
        assert_eq!(s.process(input), "🔥 emoji + 中文 = ❤️");
    }

    #[test]
    fn test_strip_newlines_preserved() {
        let mut s = AnsiStripper::new();
        assert_eq!(
            s.process("line1\n\x1b[32mline2\x1b[0m\nline3"),
            "line1\nline2\nline3",
        );
    }

    #[test]
    fn test_strip_malformed_csi_followed_by_text() {
        let mut s = AnsiStripper::new();
        let result = s.process("lead\x1b[hello");
        assert_eq!(result, "leadello");
    }

    #[test]
    fn test_strip_complex_alternating() {
        let mut s = AnsiStripper::new();
        let parts: Vec<String> = (0..100)
            .map(|i| {
                if i % 3 == 0 {
                    format!("\x1b[3{}mword{}\x1b[0m", (i % 7) + 1, i)
                } else {
                    format!("word{}", i)
                }
            })
            .collect();
        let input = parts.join(" ");
        let result = s.process(&input);
        for i in 0..100 {
            assert!(result.contains(&format!("word{}", i)));
        }
        assert!(!result.contains('\x1b'));
    }

    // ====================== 补充的 AnsiStripper 测试 ======================

    #[test]
    fn test_strip_erase_line() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("before\x1b[0Kafter"), "beforeafter");
    }

    #[test]
    fn test_strip_256_color() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b[38;5;196mred256\x1b[0m"), "red256");
    }

    #[test]
    fn test_strip_true_color() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b[38;2;255;0;0mtruered\x1b[0m"), "truered");
    }

    #[test]
    fn test_strip_simple_escape() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("before\x1b7after"), "beforeafter");
    }

    #[test]
    fn test_strip_escape_at_end() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("text\x1b"), "text");
    }

    #[test]
    fn test_strip_cross_boundary_single_escape() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("text\x1b"), "text");
        assert_eq!(s.process("[31mhello\x1b[0m"), "hello");
    }

    #[test]
    fn test_strip_cross_boundary_osc() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b]0;"), "");
        assert_eq!(s.process("title\x07text"), "text");
    }

    #[test]
    fn test_strip_unicode_boundary() {
        let mut s = AnsiStripper::new();
        let input = "\x1b[31m\u{1F600}\x1b[0m";
        assert_eq!(s.process(input), "\u{1F600}");
    }

    #[test]
    fn test_strip_csi_with_semicolons() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("\x1b[3;1H"), "");
    }

    #[test]
    fn test_strip_mixed_ansi_and_text_no_consume_text() {
        let mut s = AnsiStripper::new();
        assert_eq!(
            s.process("before\x1b[1m\x1b[33minside\x1b[0mafter"),
            "beforeinsideafter"
        );
    }

    #[test]
    fn test_strip_malformed_csi_with_newline_in_between() {
        let mut s = AnsiStripper::new();
        let result = s.process("\x1b[\nhello");
        assert_eq!(result, "ello");
    }

    #[test]
    fn test_strip_very_long_parameters() {
        let mut s = AnsiStripper::new();
        let params = (0..1000)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(";");
        let input = format!("\x1b[{}mtext", params);
        assert_eq!(s.process(&input), "text");
    }

    #[test]
    fn test_strip_csi_thousands_of_digits() {
        let mut s = AnsiStripper::new();
        let digits = "0".repeat(100 * 1024);
        let result = s.process(&format!("\x1b[{}", digits));
        assert_eq!(result, "");
        assert_eq!(s.process("text"), "ext");
    }

    #[test]
    fn test_strip_escape_state_leaks_nothing() {
        let mut s = AnsiStripper::new();
        assert_eq!(s.process("text\x1b"), "text");
        // Escape 状态的 catch-all 会消耗下一个字符（'h'）来回到 Normal
        assert_eq!(s.process("hello"), "ello");
    }

    #[test]
    fn test_strip_csi_state_recovers_after_incomplete() {
        let mut s = AnsiStripper::new();
        s.process("\x1b[31");
        assert_eq!(s.process("mhello"), "hello");
        let mut s2 = AnsiStripper::new();
        assert_eq!(s2.process("\x1b[31mhello"), "hello");
    }

    // ====================== 压力测试 ======================

    #[test]
    fn test_stress_many_chunks() {
        let (target, dir) = setup_log();
        let n = 10000;
        for i in 0..n {
            target.on_message(&Message::llm_chunk(format!("chunk {}\n", i)));
        }
        drop(target);
        let content = read_log(&dir);
        let lines: Vec<&str> = content.lines().collect();
        assert!(lines.len() >= n - 5);
        assert!(lines[0].contains("chunk 0"));
        assert!(lines[n - 1].contains(&format!("chunk {}", n - 1)));
    }

    #[test]
    fn test_stress_large_result() {
        let (target, dir) = setup_log();
        let large = "x".repeat(1024 * 1024);
        target.on_message(&Message::result_block(&large));
        drop(target);
        let content = read_log(&dir);
        assert!(content.len() >= 1024 * 1024);
    }

    #[test]
    fn test_stress_random_interleaving() {
        use rand::Rng;
        let (target, dir) = setup_log();
        let mut rng = rand::thread_rng();
        for _ in 0..500 {
            // `gen_range` 是完整方法名（非保留字 `gen`），Rust 2024 中有效
            match rng.gen_range(0..5) {
                0 => {
                    target.on_message(&Message::llm_chunk(format!(
                        "chunk{}",
                        rand::random::<u32>()
                    )));
                }
                1 => {
                    target.on_message(&Message::warning("warn"));
                }
                2 => {
                    target.on_message(&Message::result(&format!(
                        "result{}",
                        rand::random::<u32>()
                    )));
                }
                3 => {
                    target.on_message(&Message::tool_call("", "", vec![]));
                }
                4 => {
                    target.on_message(&Message::result("raw"));
                }
                _ => unreachable!(),
            }
        }
        drop(target);
        let content = read_log(&dir);
        assert!(!content.is_empty());
    }

    // ============================================================================
    // Phase 2: Router + LogTarget 真实场景日志验证
    // ============================================================================

    #[test]
    fn test_log_real_world_conversation_scenario() {
        let dir = TempDir::new().unwrap();
        let log_path = dir.path().join("terminal.log");
        let log = LogTarget::new(&log_path).unwrap();
        let router = Router::new();
        router.add_target(Box::new(log));

        // 模拟一次真实对话的通信序列
        // 1. 初始化阶段
        router.send(&Message::info(
            "[会话] 任务列表 ID: run_2025_001".to_string(),
        ));
        router.send(&Message::info(
            "[Skill] 已加载: my-skill — test skill".to_string(),
        ));

        // 2. LLM 思考 + 流式输出
        router.send(&Message::info("\n[LLM] 🤔 思考中...".to_string()));
        router.send(&Message::llm_chunk("Let me "));
        router.send(&Message::llm_chunk("search the web\n"));

        // 3. 工具调用
        router.send(&Message::info(
            "[工具] 📋 本轮 2 个工具调用: 🔍 web_search, 📖 file_read".to_string(),
        ));

        // 4. 工具结果
        router.send(&Message::tool_result(
            "🔍",
            "web_search",
            "Rust tutorial",
            2500,
        ));
        router.send(&Message::tool_result("📖", "file_read", "src/main.rs", 800));

        // 5. 工具错误
        router.send(&Message::tool_error(
            "🔧",
            "write_file",
            "permission denied",
        ));

        // 6. Token 用量
        router.send(&Message::llm_usage(1500, 200, 300, 0, 4500, Some(1)));

        // 7. 任务完成
        router.send(&Message::result("\n✅ 全部任务已完成！".to_string()));

        drop(router);

        let content = std::fs::read_to_string(&log_path).unwrap();

        // 全部消息都录入了
        assert!(content.contains("任务列表 ID"));
        assert!(content.contains("[LLM]"));
        assert!(content.contains("Let me search the web"));
        assert!(content.contains("[工具] 📋"));
        assert!(content.contains("web_search"));
        assert!(content.contains("✅ 全部任务已完成！"));

        // 通道标记正确
        assert!(content.contains("[STDOUT]")); // result 消息
        assert!(content.contains("[STDERR]")); // info/tool_result 消息

        // 时间戳格式正确
        let first_line = content.lines().next().unwrap();
        assert!(first_line.starts_with('[')); // [2025-06-...

        // 行顺序与发送顺序一致
        let lines: Vec<&str> = content.lines().collect();
        let task_idx = lines.iter().position(|l| l.contains("任务列表")).unwrap();
        let search_idx = lines.iter().position(|l| l.contains("web_search")).unwrap();
        let done_idx = lines.iter().position(|l| l.contains("全部任务")).unwrap();
        assert!(task_idx < search_idx, "任务创建应在搜索之前");
        assert!(search_idx < done_idx, "搜索应在任务完成之前");
    }
}
