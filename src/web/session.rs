//! Session 管理器 — 管理 AiAgent 生命周期和工具审批 channel。

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;
use tokio::sync::Mutex;

use crate::agent::chat::AiAgent;
use crate::tools::confirm::{
    AskBackend, AskUserResponse, ConfirmBackend, PendingApprovals, PendingAsks,
    ShellConfirmDecision,
};

/// Web 模式下的会话状态
pub struct Session {
    /// AI Agent 实例
    pub agent: AiAgent,
    /// 最近活动时间（用于超时清理）
    pub last_active: Instant,
    /// 工具审批 channel
    pub pending_approvals: PendingApprovals,
    /// ask_user 提问 channel
    pub pending_asks: PendingAsks,
    /// 审批后端引用（注入到 ShellExec 工具）
    pub confirm_backend: ConfirmBackend,
    /// 提问后端引用（注入到 AskUser 工具）
    pub ask_backend: AskBackend,
}

/// Session 管理器
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    next_id: AtomicU64,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    /// 创建新的 Session 管理器。
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        }
    }

    /// 获取或创建 session。返回 session_id 和 session 的可变引用。
    pub async fn get_or_create(
        &self,
        session_id: Option<&str>,
        agent_factory: impl FnOnce() -> AiAgent,
    ) -> (String, SessionGuard<'_>) {
        let mut sessions = self.sessions.lock().await;

        if let Some(id) = session_id
            && let Some(session) = sessions.get_mut(id)
        {
            session.last_active = Instant::now();
            return (
                id.to_string(),
                SessionGuard {
                    sessions,
                    key: id.to_string(),
                },
            );
        }

        let id = format!("web_{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let approvals = PendingApprovals::new();
        let asks = PendingAsks::new();

        let session = Session {
            agent: agent_factory(),
            last_active: Instant::now(),
            pending_approvals: approvals.clone(),
            pending_asks: asks.clone(),
            confirm_backend: ConfirmBackend::Channel(approvals),
            ask_backend: AskBackend::Channel(asks),
        };

        sessions.insert(id.clone(), session);
        (id.clone(), SessionGuard { sessions, key: id })
    }

    /// 提交工具审批结果。返回 true 表示找到对应的待审批项。
    pub async fn resolve_approval(
        &self,
        session_id: &str,
        tool_approval_id: &str,
        decision: ShellConfirmDecision,
    ) -> bool {
        let sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(session_id) {
            session
                .pending_approvals
                .resolve(tool_approval_id, decision)
        } else {
            false
        }
    }

    /// 提交 ask_user 回答。返回 true 表示找到对应的待提问项。
    pub async fn resolve_ask(
        &self,
        session_id: &str,
        ask_id: &str,
        response: AskUserResponse,
    ) -> bool {
        let sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(session_id) {
            session.pending_asks.resolve(ask_id, response)
        } else {
            false
        }
    }

    /// 清理过期 session（30 分钟无活动）。
    pub async fn cleanup(&self) {
        let mut sessions = self.sessions.lock().await;
        let timeout = std::time::Duration::from_secs(1800);
        sessions.retain(|_, s| s.last_active.elapsed() < timeout);
    }

    /// 返回共享的 Arc<Mutex<HashMap>> 引用（给 handler 使用）。
    pub fn inner(&self) -> Arc<Mutex<HashMap<String, Session>>> {
        self.sessions.clone()
    }
}

/// Session 访问守卫 — drop 时自动释放锁。
pub struct SessionGuard<'a> {
    sessions: tokio::sync::MutexGuard<'a, HashMap<String, Session>>,
    key: String,
}

impl<'a> std::ops::Deref for SessionGuard<'a> {
    type Target = Session;
    fn deref(&self) -> &Self::Target {
        &self.sessions[&self.key]
    }
}

impl<'a> std::ops::DerefMut for SessionGuard<'a> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.sessions.get_mut(&self.key).unwrap()
    }
}
