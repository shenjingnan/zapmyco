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
            MessageKind::LlmChunk | MessageKind::LlmThinkingDelta => Channel::Stream,
            MessageKind::ResultLine
            | MessageKind::ResultBlock
            | MessageKind::TaskDone
            | MessageKind::UpgradePhase
            | MessageKind::UpgradeDone
            | MessageKind::NoteInfo => Channel::Stdout,
            _ => Channel::Stderr,
        }
    }
}

impl Target for TerminalTarget {
    fn name(&self) -> &'static str {
        "terminal"
    }

    fn on_message(&self, msg: &Message) {
        // RunProgress 面板活跃时，静默 TerminalTarget 的视觉输出
        if crate::output::SUPPRESS_TERMINAL.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
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
    use crate::output::{Channel, LogTarget, Message, MessageKind, Router};
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
    }

    #[test]
    fn test_channel_stream_kind() {
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::LlmChunk),
            Channel::Stream
        );
    }

    /// 所有 19 种 kind 都有通道映射
    #[test]
    fn test_all_kinds_have_channel() {
        for kind in all_message_kinds() {
            let _channel = TerminalTarget::channel_for(kind);
            // 不 panic 即通过
        }
    }

    // -- 通道映射一致性（与 LogTarget） --

    #[test]
    fn test_all_kinds_channel_consistency() {
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
            MessageKind::LlmThinkingDelta,
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
        ]
    }

    // ============================================================================
    // Phase 2: Router + TerminalTarget 输出一致性
    // ============================================================================

    /// 收集消息的测试 target
    struct CollectTarget {
        messages: std::sync::Mutex<Vec<Message>>,
    }

    impl CollectTarget {
        fn new() -> Self {
            CollectTarget {
                messages: std::sync::Mutex::new(Vec::new()),
            }
        }
        fn received(&self) -> Vec<Message> {
            self.messages.lock().unwrap().clone()
        }
    }

    impl Target for CollectTarget {
        fn name(&self) -> &'static str {
            "phase2_collector"
        }
        fn on_message(&self, msg: &Message) {
            self.messages.lock().unwrap().push(msg.clone());
        }
    }

    impl Target for std::sync::Arc<CollectTarget> {
        fn name(&self) -> &'static str {
            (**self).name()
        }
        fn on_message(&self, msg: &Message) {
            (**self).on_message(msg)
        }
    }

    #[test]
    fn test_terminal_output_consistency_after_migration() {
        // 验证所有迁移用到的消息类型通过 Router 分发给 TerminalTarget 后，
        // 消息内容与工厂方法定义的格式一致。
        // 使用 CollectTarget 收集消息来验证 Router 正确分发，
        // TerminalTarget 的通道映射由 channel_for 测试覆盖。

        let router = Router::new();
        router.add_target(Box::new(TerminalTarget));
        let collector = std::sync::Arc::new(CollectTarget::new());
        router.add_target(Box::new(collector.clone()));

        // Info
        router.send(&Message::info("[Skill] 已加载: test — desc"));
        let msgs = collector.received();
        assert_eq!(msgs[0].kind, MessageKind::Info);
        assert!(msgs[0].text.contains("[Skill] 已加载"));
        assert_eq!(TerminalTarget::channel_for(msgs[0].kind), Channel::Stderr);
        router.send(&Message::info("[会话] 任务列表 ID: run_001"));

        // Result
        router.send(&Message::result("✅ 全部任务已完成！"));

        // tool_result
        router.send(&Message::tool_result(
            "🔧",
            "read_file",
            "src/main.rs",
            1500,
        ));

        // tool_error
        router.send(&Message::tool_error(
            "🔧",
            "write_file",
            "permission denied",
        ));

        // tool_output
        router.send(&Message::tool_output("tool output text"));

        // llm_usage
        router.send(&Message::llm_usage(100, 50, 0, 0, 2000, Some(3)));

        // llm_chunk
        router.send(&Message::llm_chunk("Hello "));
        router.send(&Message::llm_chunk("World"));

        // Warning
        router.send(&Message::warning("自动更新 settings.toml 失败"));

        // Error
        router.send(&Message::error("something broke"));

        // upgrade_done
        router.send(&Message::upgrade_done("0.38", "0.39"));

        // result_block
        router.send(&Message::result_block("line1\nline2\nline3"));

        // 验证 13 条消息全部送达
        let msgs = collector.received();
        assert_eq!(msgs.len(), 13);

        // 验证每种消息的 kind 和 text 格式
        assert_eq!(msgs[0].kind, MessageKind::Info);
        assert_eq!(msgs[1].kind, MessageKind::Info);
        assert_eq!(msgs[2].kind, MessageKind::ResultLine);
        assert_eq!(msgs[3].kind, MessageKind::ToolResult);
        assert_eq!(msgs[4].kind, MessageKind::ToolError);
        assert_eq!(msgs[5].kind, MessageKind::ToolOutput);
        assert_eq!(msgs[6].kind, MessageKind::LlmUsage);
        assert_eq!(msgs[7].kind, MessageKind::LlmChunk);
        assert_eq!(msgs[8].kind, MessageKind::LlmChunk);
        assert_eq!(msgs[9].kind, MessageKind::Warning);
        assert_eq!(msgs[10].kind, MessageKind::Error);
        assert_eq!(msgs[11].kind, MessageKind::UpgradeDone);
        assert_eq!(msgs[12].kind, MessageKind::ResultBlock);

        // 验证各消息的终端通道映射正确
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::Info),
            Channel::Stderr
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::ResultLine),
            Channel::Stdout
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::ToolResult),
            Channel::Stderr
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::ToolError),
            Channel::Stderr
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::LlmUsage),
            Channel::Stderr
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::LlmChunk),
            Channel::Stream
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::Warning),
            Channel::Stderr
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::Error),
            Channel::Stderr
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::UpgradeDone),
            Channel::Stdout
        );
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::ResultBlock),
            Channel::Stdout
        );

        // 验证结构化消息的 data 字段
        let tool_result_data = msgs[3].data.as_ref().unwrap();
        assert_eq!(tool_result_data["name"], "read_file");
        assert_eq!(tool_result_data["duration_ms"], 1500);

        let llm_usage_data = msgs[6].data.as_ref().unwrap();
        assert_eq!(llm_usage_data["input_tokens"], 100);
        assert_eq!(llm_usage_data["round"], 3);

        // 验证 upgrade_done 包含结构化数据
        let upgrade_data = msgs[11].data.as_ref().unwrap();
        assert_eq!(upgrade_data["from"], "0.38");
        assert_eq!(upgrade_data["to"], "0.39");
    }

    // ============================================================================
    // Phase 3: LlmThinkingDelta
    // ============================================================================

    #[test]
    fn test_channel_for_thinking_delta() {
        assert_eq!(
            TerminalTarget::channel_for(MessageKind::LlmThinkingDelta),
            Channel::Stream
        );
    }

    #[test]
    fn test_llm_thinking_delta_message_format() {
        let msg = Message::llm_thinking_delta("test thinking");
        assert_eq!(msg.kind, MessageKind::LlmThinkingDelta);
        assert!(msg.text.starts_with("\x1b[2m\u{2394} "));
        assert!(msg.text.ends_with("\x1b[0m"));
        assert!(msg.text.contains("test thinking"));
    }

    #[test]
    fn test_log_target_strips_ansi_from_thinking() {
        let dir = TempDir::new().unwrap();
        let log_path = dir.path().join("test.log");
        let target = LogTarget::new(&log_path).unwrap();
        let msg = Message::llm_thinking_delta("hello 世界");
        target.on_message(&msg);
        drop(target);

        let content = std::fs::read_to_string(&log_path).unwrap();
        assert!(
            !content.contains("\x1b[2m"),
            "ANSI dim code should be stripped"
        );
        assert!(
            !content.contains("\x1b[0m"),
            "ANSI reset code should be stripped"
        );
        assert!(content.contains("hello 世界"));
        assert!(content.contains('\u{2394}'));
    }
}
