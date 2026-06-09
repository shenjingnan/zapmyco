//! 终端输出目标——将消息渲染到 stdout/stderr。
//!
//! TerminalTarget 不做格式化——消息的 text 已包含终端需要的内容和 ANSI。
//! 只负责：根据 MessageKind 决定 text 写到 stdout 还是 stderr。

use crate::output::{Channel, Message, MessageKind, Target};

/// 终端消息目标
pub struct TerminalTarget;

impl TerminalTarget {
    /// 根据 MessageKind 决定终端输出通道
    pub(crate) fn channel_for(kind: MessageKind) -> Channel {
        match kind {
            MessageKind::LlmChunk => Channel::Stream,
            MessageKind::ResultLine
            | MessageKind::ResultBlock
            | MessageKind::TaskDone
            | MessageKind::UpgradePhase
            | MessageKind::UpgradeDone
            | MessageKind::NoteInfo
            | MessageKind::RawStdout => Channel::Stdout,
            _ => Channel::Stderr,
        }
    }
}

impl Target for TerminalTarget {
    fn name(&self) -> &'static str {
        "terminal"
    }

    fn on_message(&self, msg: &Message) {
        use std::io::Write;
        match Self::channel_for(msg.kind) {
            Channel::Stdout => {
                println!("{}", msg.text);
            }
            Channel::Stderr => {
                eprintln!("{}", msg.text);
            }
            Channel::Stream => {
                eprint!("{}", msg.text);
                std::io::stderr().flush().ok();
            }
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::{Channel, LogTarget, Message, MessageKind};
    use tempfile::TempDir;

    // -- 通道路由 --

    #[test]
    fn test_channel_stdout_kinds() {
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::ResultLine),
            Channel::Stdout
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::ResultBlock),
            Channel::Stdout
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::TaskDone),
            Channel::Stdout
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::UpgradePhase),
            Channel::Stdout
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::UpgradeDone),
            Channel::Stdout
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::NoteInfo),
            Channel::Stdout
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::RawStdout),
            Channel::Stdout
        );
    }

    #[test]
    fn test_channel_stderr_kinds() {
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::Info),
            Channel::Stderr
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::Warning),
            Channel::Stderr
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::ToolCall),
            Channel::Stderr
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::RawStderr),
            Channel::Stderr
        );
    }

    #[test]
    fn test_channel_stream_kind() {
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::LlmChunk),
            Channel::Stream
        );
    }

    /// 所有 21 种 kind 都有通道映射
    #[test]
    fn test_all_kinds_have_channel() {
        for kind in all_message_kinds() {
            let _channel = TerminalTarget::channel_for(kind);
            // 不 panic 即通过
        }
    }

    // -- 通道映射一致性（与 LogTarget） --

    #[test]
    fn test_all_21_kinds_channel_consistency() {
        for kind in all_message_kinds() {
            let channel = TerminalTarget::channel_for(kind);
            let dir = TempDir::new().unwrap();
            let target = LogTarget::new(&dir.path().join("log")).unwrap();
            let msg = Message {
                kind,
                text: "test".into(),
                data: None,
            };
            target.on_message(&msg);
            drop(target);
            let content = std::fs::read_to_string(&dir.path().join("log")).unwrap();
            let expected_label = match channel {
                Channel::Stdout => "[STDOUT]",
                Channel::Stderr | Channel::Stream => "[STDERR]",
            };
            assert!(
                content.contains(expected_label),
                "kind {:?} maps to {:?} but LogTarget wrote {}",
                kind,
                channel,
                expected_label,
            );
        }
    }

    fn all_message_kinds() -> Vec<MessageKind> {
        vec![
            MessageKind::LlmThinking,
            MessageKind::LlmChunk,
            MessageKind::LlmUsage,
            MessageKind::ToolCall,
            MessageKind::ToolResult,
            MessageKind::ToolError,
            MessageKind::ToolOutput,
            MessageKind::TaskPending,
            MessageKind::TaskDone,
            MessageKind::ResultLine,
            MessageKind::ResultBlock,
            MessageKind::Info,
            MessageKind::Warning,
            MessageKind::Error,
            MessageKind::UpgradePhase,
            MessageKind::UpgradeDone,
            MessageKind::NoteInfo,
            MessageKind::SubAgentInfo,
            MessageKind::SkillLoaded,
            MessageKind::RawStdout,
            MessageKind::RawStderr,
        ]
    }
}
