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
    fn write_log(&self, channel: &str, text: &str) {
        use chrono::Local;
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S");
        if let Ok(mut file) = self.file.lock() {
            for line in text.lines() {
                let _ = writeln!(file, "[{}] [{}] {}", now, channel, line);
            }
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
            | MessageKind::NoteInfo
            | MessageKind::RawStdout => {
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

            // 桥接
            MessageKind::RawStderr => {
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
        target.on_message(&Message::stderr("\x1b[31m\x1b[0m"));
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
}
