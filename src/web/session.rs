//! Web 会话状态管理器 — 基于 `zapmyco_core::agent_loop` 管理对话历史与工具审批 channel。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::Mutex as AsyncMutex;

use crate::tools::confirm::{AskUserResponse, PendingApprovals, PendingAsks, ShellConfirmDecision};
use zapmyco_core::{AgentConfig, ConversationMessage};

/// Web 模式下的会话状态
pub struct Session {
    /// 对话历史（Some = 会话可用；None = 有请求在途，并发请求返回 SESSION_LOST）
    pub messages: Option<Vec<ConversationMessage>>,
    /// 8 个工具（Channel 后端）+ 模型配置，Arc 共享，跨轮复用
    pub config: Arc<AgentConfig>,
    /// 跨命令跟踪的工作目录（CwdShellExec 与事件适配器共享）
    pub cwd: Arc<Mutex<PathBuf>>,
    /// 最近活动时间（用于超时清理）
    pub last_active: Instant,
    /// 工具审批 channel
    pub pending_approvals: PendingApprovals,
    /// ask_user 提问 channel
    pub pending_asks: PendingAsks,
    /// 首条消息注入的 context_reminder（会话创建时算好）
    pub context_reminder: String,
    /// 是否已注入 context_reminder
    pub context_injected: bool,
}

/// Session 管理器
pub struct SessionManager {
    sessions: Arc<AsyncMutex<HashMap<String, Session>>>,
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
            sessions: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }

    /// 提交工具审批结果。返回 true 表示找到对应的待审批项。
    pub async fn resolve_approval(
        &self,
        session_id: &str,
        tool_approval_id: &str,
        decision: ShellConfirmDecision,
    ) -> bool {
        let approvals = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .map(|s| s.pending_approvals.clone())
        };
        if let Some(approvals) = approvals {
            approvals.resolve(tool_approval_id, decision)
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
        let asks = {
            let sessions = self.sessions.lock().await;
            sessions.get(session_id).map(|s| s.pending_asks.clone())
        };
        if let Some(asks) = asks {
            asks.resolve(ask_id, response)
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

    /// 返回共享的 Arc<AsyncMutex<HashMap>> 引用（给 handler 使用）。
    pub fn inner(&self) -> Arc<AsyncMutex<HashMap<String, Session>>> {
        self.sessions.clone()
    }
}
