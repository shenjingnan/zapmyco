//! 统一输出基础设施——消息分发的核心定义。
//!
//! 应用代码产生"一条内容"（Message），Router 分发给所有注册的 Target。
//! 每条消息携带：
//! - `kind`：这是什么消息（LLM 输出？工具调用？状态信息？）
//! - `text`：已渲染的终端文本（含 ANSI），terminal/log target 直接使用
//! - `data`：结构化载荷，供未来 API/Web target 使用

mod log;
mod terminal;

pub use log::LogTarget;
pub use terminal::TerminalTarget;

use std::sync::{LazyLock, Mutex};

// ============================================================================
// Message & MessageKind
// ============================================================================

/// 一条输出消息——"一条内容"，分发给所有注册的 target
#[derive(Debug, Clone)]
pub struct Message {
    pub kind: MessageKind,
    pub text: String,
    pub data: Option<serde_json::Value>,
}

/// 消息类型——标记"这是什么"
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageKind {
    // === LLM 交互 ===
    /// "🤔 Thinking..." 状态提示
    LlmThinking,
    /// 流式文本片段（eprint! + flush）
    LlmChunk,
    /// Token 用量
    LlmUsage,

    // === 工具执行 ===
    /// 工具调用（含 icon, name, params）
    ToolCall,
    /// 工具执行成功
    ToolResult,
    /// 工具执行失败
    ToolError,
    /// 工具产生的文本输出
    ToolOutput,

    // === 任务系统 ===
    /// 有待完成的任务
    TaskPending,
    /// 全部任务完成
    TaskDone,

    // === 输出通道 ===
    /// 最终结果（单行）
    ResultLine,
    /// 最终结果（多行块）
    ResultBlock,

    // === 系统状态 ===
    /// 普通状态信息（stderr）
    Info,
    /// 警告
    Warning,
    /// 错误
    Error,

    /// 升级阶段
    UpgradePhase,
    /// 升级完成
    UpgradeDone,

    /// 笔记信息
    NoteInfo,
    /// 子代理
    SubAgentInfo,
    /// Skill 加载
    SkillLoaded,

    // === 迁移桥接 ===
    RawStdout,
    RawStderr,
}

// ============================================================================
// Channel
// ============================================================================

/// 输出通道——标记终端输出方式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// println!()
    Stdout,
    /// eprintln!()
    Stderr,
    /// eprint!() + flush（stderr，不换行）
    Stream,
}

// ============================================================================
// Target trait
// ============================================================================

/// 消息目的地——每条消息会发送给所有已注册的 target
pub trait Target: Send + Sync {
    /// 接收一条消息
    fn on_message(&self, msg: &Message);
    /// target 唯一标识（用于 add/remove 管理）
    fn name(&self) -> &'static str;
}

// ============================================================================
// Router
// ============================================================================

/// 消息路由器——将消息分发给所有已注册的 target
pub struct Router {
    targets: Mutex<Vec<Box<dyn Target>>>,
}

impl Default for Router {
    fn default() -> Self {
        Self::new()
    }
}

impl Router {
    /// 创建新路由器
    pub const fn new() -> Self {
        Router {
            targets: Mutex::new(Vec::new()),
        }
    }

    /// 注册 target
    pub fn add_target(&self, target: Box<dyn Target>) {
        if let Ok(mut targets) = self.targets.lock() {
            targets.push(target);
        }
    }

    /// 按 name 移除 target，返回是否找到并移除
    pub fn remove_target(&self, name: &str) -> bool {
        if let Ok(mut targets) = self.targets.lock() {
            let len_before = targets.len();
            targets.retain(|t| t.name() != name);
            targets.len() < len_before
        } else {
            false
        }
    }

    /// 发送消息——同步遍历所有 target
    ///
    /// 使用 `catch_unwind` 隔离每个 target 的 panic。
    /// 一个 target panic 不会影响其他 target 或中毒 Mutex。
    pub fn send(&self, msg: &Message) {
        if let Ok(targets) = self.targets.lock() {
            for target in targets.iter() {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    target.on_message(msg);
                }));
            }
        }
    }
}

/// 全局路由器实例
pub static ROUTER: LazyLock<Router> = LazyLock::new(Router::new);

/// 快捷发送函数
pub fn send(msg: &Message) {
    ROUTER.send(msg);
}

// ============================================================================
// Message 工厂方法
// ============================================================================

impl Message {
    // ==================== 结构化消息（含 data） ====================

    /// 工具调用
    pub fn tool_call(
        icon: impl Into<String>,
        name: impl Into<String>,
        params: Vec<String>,
    ) -> Self {
        let name = name.into();
        let params_str = params.join(" ");
        Message {
            kind: MessageKind::ToolCall,
            text: format!(
                "\n╭─ Tool Call ─────────────────\n│ {} {} {}\n╰────────────────────────────",
                icon.into(),
                name,
                params_str,
            ),
            data: Some(serde_json::json!({ "name": name, "params": params })),
        }
    }

    /// 工具执行结果
    ///
    /// `detail`: 工具的主要参数值，如文件路径。当前代码格式为
    /// `[工具] 🔧 read_file src/main.rs  ✅ 完成 (0.5s)`
    pub fn tool_result(
        icon: impl Into<String>,
        name: impl Into<String>,
        detail: impl Into<String>,
        duration_ms: u64,
    ) -> Self {
        let name = name.into();
        let detail = detail.into();
        Message {
            kind: MessageKind::ToolResult,
            text: format!(
                "[工具] {} {}  {}  ✅ 完成 ({:.1}s)",
                icon.into(),
                name,
                detail,
                duration_ms as f64 / 1000.0,
            ),
            data: Some(
                serde_json::json!({ "name": name, "detail": detail, "duration_ms": duration_ms }),
            ),
        }
    }

    /// 工具执行错误
    pub fn tool_error(
        icon: impl Into<String>,
        name: impl Into<String>,
        error: impl Into<String>,
    ) -> Self {
        let name = name.into();
        let err = error.into();
        Message {
            kind: MessageKind::ToolError,
            text: format!("[工具] ⚠️ {} {}  ❌ {}", icon.into(), name, err),
            data: Some(serde_json::json!({ "name": name, "error": err })),
        }
    }

    /// Token 用量
    ///
    /// `round`: 当前对话轮次（Some(3) 显示为 `[LLM] (round 3) in: ...`，
    /// None 显示为 `[LLM] in: ...`）
    pub fn llm_usage(
        input: u64,
        output: u64,
        cache_read: u64,
        cache_create: u64,
        duration_ms: u64,
        round: Option<u32>,
    ) -> Self {
        let cache_part = if cache_read > 0 || cache_create > 0 {
            let total = input as f64 + output as f64;
            let savings = if total > 0.0 {
                (cache_read as f64 / total * 100.0) as u32
            } else {
                0
            };
            format!(
                " | cache read: {}, create: {} | 节省 {}%",
                cache_read, cache_create, savings
            )
        } else {
            String::new()
        };
        let round_str = match round {
            Some(n) => format!(" (round {})", n),
            None => String::new(),
        };
        Message {
            kind: MessageKind::LlmUsage,
            text: format!(
                "[LLM]{} in: {}, out: {}{} ({:.1}s)",
                round_str,
                input,
                output,
                cache_part,
                duration_ms as f64 / 1000.0,
            ),
            data: Some(serde_json::json!({
                "input_tokens": input, "output_tokens": output,
                "cache_read": cache_read, "cache_create": cache_create,
                "duration_ms": duration_ms,
                "round": round,
            })),
        }
    }

    /// 警告（含结构化数据）
    pub fn warning(text: impl Into<String>) -> Self {
        let t = text.into();
        Message {
            kind: MessageKind::Warning,
            text: format!("[警告] {}", t),
            data: Some(serde_json::json!({ "message": t })),
        }
    }

    /// 错误（含结构化数据）
    pub fn error(text: impl Into<String>) -> Self {
        let t = text.into();
        Message {
            kind: MessageKind::Error,
            text: t.clone(),
            data: Some(serde_json::json!({ "message": t })),
        }
    }

    /// 升级完成（含结构化数据）
    pub fn upgrade_done(from: impl Into<String>, to: impl Into<String>) -> Self {
        let from = from.into();
        let to = to.into();
        Message {
            kind: MessageKind::UpgradeDone,
            text: format!(
                "✅ 已从 v{} 升级到 v{}\n🔔 请运行: source ~/.zshrc (或新开终端 Tab) 刷新命令补全",
                from, to,
            ),
            data: Some(serde_json::json!({ "from": from, "to": to })),
        }
    }

    /// 升级阶段（如"正在下载..."）
    pub fn upgrade_phase(text: impl Into<String>) -> Self {
        Message {
            kind: MessageKind::UpgradePhase,
            text: text.into(),
            data: None,
        }
    }

    // ==================== 流式消息 ====================

    /// LLM 流式文本片段（eprint! + flush，不换行）
    pub fn llm_chunk(text: impl Into<String>) -> Self {
        Message {
            kind: MessageKind::LlmChunk,
            text: text.into(),
            data: None,
        }
    }

    // ==================== 简单终端消息 ====================

    /// 状态信息（stderr）
    pub fn info(text: impl Into<String>) -> Self {
        Message {
            kind: MessageKind::Info,
            text: text.into(),
            data: None,
        }
    }

    /// 结果输出（stdout）
    pub fn result(text: impl Into<String>) -> Self {
        Message {
            kind: MessageKind::ResultLine,
            text: text.into(),
            data: None,
        }
    }

    /// 多行结果（stdout）
    pub fn result_block(text: impl Into<String>) -> Self {
        Message {
            kind: MessageKind::ResultBlock,
            text: text.into(),
            data: None,
        }
    }

    /// 工具输出的文本
    pub fn tool_output(text: impl Into<String>) -> Self {
        Message {
            kind: MessageKind::ToolOutput,
            text: text.into(),
            data: None,
        }
    }

    // ==================== 迁移桥接 ====================

    /// 原始 stderr 文本（迁移期逃生舱）
    pub fn stderr(text: impl Into<String>) -> Self {
        Message {
            kind: MessageKind::RawStderr,
            text: text.into(),
            data: None,
        }
    }

    /// 原始 stdout 文本（迁移期逃生舱）
    pub fn stdout(text: impl Into<String>) -> Self {
        Message {
            kind: MessageKind::RawStdout,
            text: text.into(),
            data: None,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    // -- 辅助测试工具 --

    /// 收集消息的测试 target
    struct CollectTarget {
        name: &'static str,
        messages: Mutex<Vec<Message>>,
    }

    impl CollectTarget {
        fn new(name: &'static str) -> Self {
            CollectTarget {
                name,
                messages: Mutex::new(Vec::new()),
            }
        }
        fn received(&self) -> usize {
            self.messages.lock().unwrap().len()
        }
        fn last_message(&self) -> Message {
            self.messages.lock().unwrap().last().unwrap().clone()
        }
        fn messages(&self) -> Vec<Message> {
            self.messages.lock().unwrap().clone()
        }
    }

    impl Target for CollectTarget {
        fn name(&self) -> &'static str {
            self.name
        }
        fn on_message(&self, msg: &Message) {
            self.messages.lock().unwrap().push(msg.clone());
        }
    }

    impl Target for Arc<CollectTarget> {
        fn name(&self) -> &'static str {
            (**self).name()
        }
        fn on_message(&self, msg: &Message) {
            (**self).on_message(msg)
        }
    }

    struct PanicTarget;

    impl Target for PanicTarget {
        fn name(&self) -> &'static str {
            "panicker"
        }
        fn on_message(&self, _msg: &Message) {
            panic!("intentional panic for testing");
        }
    }

    // -- 基础路由 --

    #[test]
    fn test_empty_router_send() {
        let router = Router::new();
        let msg = Message::info("hello");
        router.send(&msg); // 空 targets，不应 panic
    }

    #[test]
    fn test_send_to_single_target() {
        let router = Router::new();
        let target = Arc::new(CollectTarget::new("collector"));
        router.add_target(Box::new(target.clone()));
        router.send(&Message::info("hello"));
        assert_eq!(target.received(), 1);
        assert_eq!(target.last_message().text, "hello");
    }

    #[test]
    fn test_send_to_multiple_targets() {
        let router = Router::new();
        let a = Arc::new(CollectTarget::new("a"));
        let b = Arc::new(CollectTarget::new("b"));
        router.add_target(Box::new(a.clone()));
        router.add_target(Box::new(b.clone()));
        router.send(&Message::info("hello"));
        assert_eq!(a.received(), 1);
        assert_eq!(b.received(), 1);
    }

    #[test]
    fn test_add_remove_target() {
        let router = Router::new();
        let target = Arc::new(CollectTarget::new("removable"));
        router.add_target(Box::new(target.clone()));
        router.send(&Message::info("before"));
        assert!(router.remove_target("removable"));
        router.send(&Message::info("after"));
        assert_eq!(target.received(), 1); // 只收到 before
    }

    #[test]
    fn test_remove_nonexistent() {
        let router = Router::new();
        assert!(!router.remove_target("nonexistent"));
    }

    #[test]
    fn test_message_order_preserved() {
        let router = Router::new();
        let target = Arc::new(CollectTarget::new("order"));
        router.add_target(Box::new(target.clone()));
        router.send(&Message::info("a"));
        router.send(&Message::info("b"));
        router.send(&Message::info("c"));
        let msgs = target.messages();
        assert_eq!(msgs[0].text, "a");
        assert_eq!(msgs[1].text, "b");
        assert_eq!(msgs[2].text, "c");
    }

    // -- Panic 隔离 --

    #[test]
    fn test_target_panic_does_not_affect_others() {
        let router = Router::new();
        let panicker = PanicTarget;
        let collector = Arc::new(CollectTarget::new("survivor"));
        router.add_target(Box::new(panicker));
        router.add_target(Box::new(collector.clone()));
        router.send(&Message::info("test"));
        assert_eq!(collector.received(), 1);
    }

    #[test]
    fn test_poisoned_mutex_still_works() {
        let router = Router::new();
        let panicker = PanicTarget;
        let collector = Arc::new(CollectTarget::new("after"));
        router.add_target(Box::new(panicker));
        router.send(&Message::info("will panic"));
        // Mutex 中毒，但 send() 使用 if let Ok 安全降级
        router.add_target(Box::new(collector.clone()));
        router.send(&Message::info("after poison"));
        assert_eq!(collector.received(), 1);
    }

    // -- 并发 --

    #[test]
    fn test_concurrent_send_from_multiple_threads() {
        let router = std::sync::Arc::new(Router::new());
        let collector = std::sync::Arc::new(CollectTarget::new("concurrent"));
        router.add_target(Box::new(collector.clone()));

        let mut handles = Vec::new();
        for i in 0..20 {
            let router = router.clone();
            handles.push(std::thread::spawn(move || {
                for _ in 0..100 {
                    router.send(&Message::info(format!("thread {}", i)));
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(collector.received(), 2000);
    }

    // -- 工厂方法 --

    #[test]
    fn test_message_tool_call() {
        let msg = Message::tool_call("🔧", "read_file", vec!["src/main.rs".into()]);
        assert_eq!(msg.kind, MessageKind::ToolCall);
        assert!(msg.text.contains("🔧"));
        assert!(msg.text.contains("read_file"));
        assert!(msg.text.contains("src/main.rs"));
        let data = msg.data.unwrap();
        assert_eq!(data["name"], "read_file");
        assert_eq!(data["params"][0], "src/main.rs");
    }

    #[test]
    fn test_message_tool_result() {
        let msg = Message::tool_result("🔧", "read_file", "file.txt", 1500);
        assert_eq!(msg.kind, MessageKind::ToolResult);
        assert!(msg.text.contains("✅"));
        assert!(msg.text.contains("1.5s"));
        assert_eq!(msg.data.unwrap()["duration_ms"], 1500);
    }

    #[test]
    fn test_message_tool_error() {
        let msg = Message::tool_error("🔧", "write_file", "permission denied");
        assert_eq!(msg.kind, MessageKind::ToolError);
        assert!(msg.text.contains("❌"));
        assert_eq!(msg.data.unwrap()["error"], "permission denied");
    }

    #[test]
    fn test_message_llm_usage_with_round() {
        let msg = Message::llm_usage(100, 50, 0, 0, 2000, Some(3));
        assert!(msg.text.contains("(round 3)"));
        assert!(msg.text.contains("2.0s"));
        let data = msg.data.unwrap();
        assert_eq!(data["round"], 3);
    }

    #[test]
    fn test_message_llm_usage_no_round() {
        let msg = Message::llm_usage(100, 50, 0, 0, 2000, None);
        assert!(!msg.text.contains("(round"));
    }

    #[test]
    fn test_message_llm_usage_with_cache() {
        let msg = Message::llm_usage(200, 100, 50, 10, 1000, None);
        assert!(msg.text.contains("cache read"));
        assert!(msg.text.contains("节省"));
    }

    #[test]
    fn test_message_warning() {
        let msg = Message::warning("disk space low");
        assert_eq!(msg.kind, MessageKind::Warning);
        assert!(msg.text.contains("[警告]"));
        assert_eq!(msg.data.unwrap()["message"], "disk space low");
    }

    #[test]
    fn test_message_error() {
        let msg = Message::error("something broke");
        assert_eq!(msg.kind, MessageKind::Error);
        assert_eq!(msg.text, "something broke");
        assert_eq!(msg.data.unwrap()["message"], "something broke");
    }

    #[test]
    fn test_message_upgrade_done() {
        let msg = Message::upgrade_done("0.38", "0.39");
        assert_eq!(msg.kind, MessageKind::UpgradeDone);
        assert!(msg.text.contains("0.38"));
        assert!(msg.text.contains("0.39"));
        let data = msg.data.clone().unwrap();
        assert_eq!(data["from"], "0.38");
        assert_eq!(data["to"], "0.39");
    }

    #[test]
    fn test_message_llm_chunk() {
        let msg = Message::llm_chunk("Hello world");
        assert_eq!(msg.kind, MessageKind::LlmChunk);
        assert_eq!(msg.text, "Hello world");
        assert!(msg.data.is_none());
    }

    #[test]
    fn test_message_info() {
        let msg = Message::info("status update");
        assert_eq!(msg.kind, MessageKind::Info);
        assert_eq!(msg.text, "status update");
        assert!(msg.data.is_none());
    }

    #[test]
    fn test_message_info_empty() {
        let msg = Message::info("");
        assert_eq!(msg.kind, MessageKind::Info);
        assert_eq!(msg.text, "");
    }

    #[test]
    fn test_message_result() {
        let msg = Message::result("✅ done");
        assert_eq!(msg.kind, MessageKind::ResultLine);
        assert_eq!(msg.text, "✅ done");
    }

    #[test]
    fn test_message_result_block() {
        let msg = Message::result_block("line1\nline2\nline3");
        assert_eq!(msg.kind, MessageKind::ResultBlock);
        assert_eq!(msg.text, "line1\nline2\nline3");
    }

    #[test]
    fn test_message_empty_tool_params() {
        let msg = Message::tool_call("", "", vec![]);
        assert_eq!(msg.kind, MessageKind::ToolCall);
    }

    #[test]
    fn test_message_zero_duration() {
        let msg = Message::tool_result("", "", "", 0);
        assert!(msg.text.contains("0.0s"));
    }

    #[test]
    fn test_message_llm_usage_zero_values() {
        let msg = Message::llm_usage(0, 0, 0, 0, 0, None);
        assert!(msg.text.contains("0"));
    }

    #[test]
    fn test_message_llm_usage_large_values() {
        let msg = Message::llm_usage(u64::MAX, u64::MAX, 0, 0, u64::MAX, None);
        assert!(msg.text.contains("in:"));
    }

    #[test]
    fn test_message_unicode_emoji() {
        let msg = Message::info("🔥 🎉 测试 Unicode 中文 ✓");
        assert_eq!(msg.text, "🔥 🎉 测试 Unicode 中文 ✓");
    }

    #[test]
    fn test_message_unicode_boundary() {
        let msg = Message::info("\u{FFFD}");
        assert_eq!(msg.text, "\u{FFFD}");
    }

    /// 返回所有 MessageKind 变体
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

    #[test]
    fn test_global_send_function() {
        // 全局 ROUTER 在首次访问时初始化
        send(&Message::info("test"));
    }

    // -- 集成测试 --

    #[test]
    fn test_router_with_log() {
        // 6.2 Router + LogTarget
        let router = Router::new();
        let dir = tempfile::TempDir::new().unwrap();
        let log_path = dir.path().join("terminal.log");
        let log = crate::output::LogTarget::new(&log_path).unwrap();
        router.add_target(Box::new(log));

        router.send(&Message::result("output"));
        router.send(&Message::warning("warning!"));
        drop(router);

        let content = std::fs::read_to_string(&log_path).unwrap();
        assert!(content.contains("output"));
        assert!(content.contains("warning!"));
    }

    #[test]
    fn test_router_with_terminal_and_log() {
        let router = Router::new();
        router.add_target(Box::new(crate::output::TerminalTarget));

        let dir = tempfile::TempDir::new().unwrap();
        let log_path = dir.path().join("terminal.log");
        let log = crate::output::LogTarget::new(&log_path).unwrap();
        router.add_target(Box::new(log));

        router.send(&Message::result("to both stdout"));
        router.send(&Message::warning("to both stderr"));
        drop(router);

        let content = match std::fs::read_to_string(&log_path) {
            Ok(c) => c,
            Err(e) => panic!("cannot read log file at {}: {}", log_path.display(), e),
        };
        assert!(content.contains("to both stdout"), "content: {:?}", content);
        assert!(content.contains("to both stderr"));
        assert!(content.contains("[STDOUT]"));
        assert!(content.contains("[STDERR]"));
    }

    // -- Phase 2: print_usage_line 迁移后格式验证 --

    #[test]
    fn test_llm_usage_format_matches_original() {
        // print_usage_line 迁移前输出格式:
        // [LLM] in: {total}, out: {output} | cache read: {n}, create: {n} | 节省 {n}% ({dur:.1}s)
        // Message::llm_usage 输出格式:
        // [LLM] in: {input}, out: {output} | cache read: {}, create: {} | 节省 {}% ({dur:.1}s)

        // 带 round
        let msg = Message::llm_usage(1800, 200, 300, 0, 4500, Some(1));
        assert!(msg.text.starts_with("[LLM]"));
        assert!(msg.text.contains("in: 1800"));
        assert!(msg.text.contains("out: 200"));
        assert!(msg.text.contains("4.5s"));

        // 无 round
        let msg = Message::llm_usage(100, 50, 0, 0, 2000, None);
        assert!(msg.text.starts_with("[LLM]"));
        assert!(!msg.text.contains("round"));

        // 带 cache 节省率
        let msg = Message::llm_usage(200, 100, 50, 10, 1000, None);
        assert!(msg.text.contains("cache read: 50"));
        assert!(msg.text.contains("节省"));
    }
}
