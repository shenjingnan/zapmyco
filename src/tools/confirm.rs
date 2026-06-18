//! Web 模式确认机制 — 将 shell_exec 的审批和 ask_user 的提问从
//! 终端交互改为通过 channel 等待 HTTP 请求注入结果。
//!
//! 终端模式：使用 crossterm/inquire 交互（现有行为不变）。
//! Web 模式：通过 `PendingApprovals` 管理器等待外部 HTTP 请求。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// shell_exec 的审批决策
#[derive(Debug, Clone)]
pub struct ShellConfirmDecision {
    /// 是否允许执行
    pub approved: bool,
    /// 用户编辑后的命令（可选）
    pub edited_command: Option<String>,
}

/// ask_user 的用户回答
#[derive(Debug, Clone)]
pub struct AskUserResponse {
    /// 单项选择索引
    pub selected_idx: Option<usize>,
    /// 自定义输入文本
    pub custom_text: Option<String>,
}

/// 待审批项管理器 — 用于 Web 模式。
///
/// AI Agent 在执行需要用户确认的操作时，通过 `register` 注册一个
/// oneshot channel 并阻塞等待。HTTP handler 收到用户操作后，
/// 通过 `resolve` 发送结果，唤醒等待的 agent。
#[derive(Debug, Clone, Default)]
pub struct PendingApprovals {
    inner: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<ShellConfirmDecision>>>>,
}

impl PendingApprovals {
    /// 创建新的管理器。
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 注册一个待审批项，返回对应的 `Receiver`。
    /// agent 应对该 receiver 执行 `.await` 以等待结果。
    pub fn register(&self, id: String) -> tokio::sync::oneshot::Receiver<ShellConfirmDecision> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.inner.lock().unwrap().insert(id, tx);
        rx
    }

    /// 提交审批结果。返回 `true` 表示找到了对应的待审批项并成功发送。
    pub fn resolve(&self, id: &str, decision: ShellConfirmDecision) -> bool {
        if let Some(tx) = self.inner.lock().unwrap().remove(id) {
            tx.send(decision).is_ok()
        } else {
            false
        }
    }
}

/// 待提问项管理器 — 用于 Web 模式。
///
/// 与 `PendingApprovals` 结构相同但使用不同的消息类型。
#[derive(Debug, Clone, Default)]
pub struct PendingAsks {
    inner: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<AskUserResponse>>>>,
}

impl PendingAsks {
    /// 创建新的管理器。
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 注册一个待提问项，返回对应的 `Receiver`。
    pub fn register(&self, id: String) -> tokio::sync::oneshot::Receiver<AskUserResponse> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.inner.lock().unwrap().insert(id, tx);
        rx
    }

    /// 提交用户回答。返回 `true` 表示找到了对应的提问项并成功发送。
    pub fn resolve(&self, id: &str, response: AskUserResponse) -> bool {
        if let Some(tx) = self.inner.lock().unwrap().remove(id) {
            tx.send(response).is_ok()
        } else {
            false
        }
    }
}

/// 确认后端 — 控制 shell_exec 如何获取用户确认。
#[derive(Debug, Clone, Default)]
pub enum ConfirmBackend {
    /// 终端交互（crossterm select，现有行为）
    #[default]
    Terminal,
    /// 始终允许（Plan 模式自动审批）
    AlwaysAllow,
    /// 通过 channel 等待 HTTP 请求注入结果（Web 模式）
    Channel(PendingApprovals),
}

/// 提问后端 — 控制 ask_user 如何获取用户输入。
#[derive(Debug, Clone, Default)]
pub enum AskBackend {
    #[default]
    /// 终端交互（crossterm select，现有行为）
    Terminal,
    /// 通过 channel 等待 HTTP 请求注入结果（Web 模式）
    Channel(PendingAsks),
}
