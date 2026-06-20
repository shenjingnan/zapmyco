//! Chat handler — 流式 AI 对话端点。

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{
        IntoResponse,
        sse::{Event, Sse},
    },
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::sync::Arc;

use crate::agent::progress::HandleLike;
use crate::agent::progress::ProgressReporter;

use super::AppState;

// ── Request/Response 类型 ──

/// POST /api/chat 请求体
#[derive(Deserialize)]
pub struct ChatRequest {
    /// 用户输入的 prompt
    pub prompt: String,
    /// 可选的 session_id（继续已有会话）
    pub session_id: Option<String>,
}

/// POST /api/tool/approve 请求体
#[derive(Deserialize)]
pub struct ApproveRequest {
    /// 会话 ID
    pub session_id: String,
    /// 工具审批 ID
    pub tool_approval_id: String,
    /// 是否允许
    pub approved: bool,
    /// 用户编辑后的命令（可选）
    pub edited_command: Option<String>,
}

/// POST /api/ask/respond 请求体
#[derive(Deserialize)]
pub struct AskRespondRequest {
    /// 会话 ID
    pub session_id: String,
    /// 提问 ID
    pub ask_id: String,
    /// 选项索引
    pub selected_idx: Option<usize>,
    /// 自定义输入文本
    pub custom_text: Option<String>,
}

/// 流式事件（JSON Lines 格式）
#[derive(Serialize)]
#[serde(tag = "type")]
pub enum StreamEvent {
    #[serde(rename = "text")]
    Text { content: String },
    #[serde(rename = "text_delta")]
    TextDelta { content: String },
    #[serde(rename = "thinking_delta")]
    ThinkingDelta { content: String },
    #[serde(rename = "status")]
    Status { content: String },
    #[serde(rename = "tool_call")]
    ToolCall {
        id: String,
        tool: String,
        args: serde_json::Value,
    },
    #[serde(rename = "tool_progress")]
    ToolProgress { id: String, status: String },
    #[serde(rename = "tool_result")]
    ToolResult { id: String, content: String },
    #[serde(rename = "tool_approval_required")]
    ToolApprovalRequired {
        id: String,
        tool: String,
        command: String,
        description: Option<String>,
    },
    #[serde(rename = "ask_user")]
    AskUser {
        id: String,
        question: String,
        options: Vec<String>,
    },
    #[serde(rename = "done")]
    Done { reason: String },
    #[serde(rename = "error")]
    Error { code: String, message: String },
}

/// Web 模式的进度上报器 — 将进度事件通过 channel 发送到 HTTP 流。
pub struct WebProgress {
    tx: tokio::sync::mpsc::UnboundedSender<StreamEvent>,
}

/// Web 模式的进度句柄。
#[derive(Clone)]
pub struct WebHandle {
    tx: tokio::sync::mpsc::UnboundedSender<StreamEvent>,
    label: String,
}

impl HandleLike for WebHandle {
    fn set_running(&self, _status: Option<&str>) {
        self.tx
            .send(StreamEvent::ToolProgress {
                id: self.label.clone(),
                status: "running".to_string(),
            })
            .ok();
    }

    fn set_success(&self, summary: Option<&str>) {
        self.tx
            .send(StreamEvent::ToolResult {
                id: self.label.clone(),
                content: summary.unwrap_or("").to_string(),
            })
            .ok();
    }

    fn set_failed(&self, error: &str) {
        self.tx
            .send(StreamEvent::ToolResult {
                id: self.label.clone(),
                content: format!("failed: {}", error),
            })
            .ok();
    }
}

impl WebProgress {
    pub fn new(tx: tokio::sync::mpsc::UnboundedSender<StreamEvent>) -> Self {
        Self { tx }
    }
}

impl ProgressReporter for WebProgress {
    type Handle = WebHandle;

    fn set_status(&self, text: &str) {
        self.tx
            .send(StreamEvent::Status {
                content: text.to_string(),
            })
            .ok();
    }

    fn start_item(&self, label: &str) -> WebHandle {
        self.tx
            .send(StreamEvent::ToolProgress {
                id: label.to_string(),
                status: "running".to_string(),
            })
            .ok();
        WebHandle {
            tx: self.tx.clone(),
            label: label.to_string(),
        }
    }

    fn finish_item(&self, handle: &WebHandle, _success: bool, summary: Option<&str>) {
        handle.set_success(summary);
    }

    fn mark_item_completed(&self, handle: &WebHandle) {
        handle.set_success(None);
    }

    fn tick(&self) {}

    fn pause(&self) {}

    fn resume(&self) {}
}

// ── Handler ──

/// POST /api/chat — 流式 AI 对话
pub async fn handle_chat(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ChatRequest>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, AppError> {
    if body.prompt.trim().is_empty() {
        return Err(AppError::bad_request("prompt 不能为空"));
    }

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<StreamEvent>();
    let progress = WebProgress::new(tx.clone());

    let sessions = state.sessions.inner();
    let session_id = body
        .session_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // 获取或创建 session
    {
        let mut sessions_map = sessions.lock().await;
        if !sessions_map.contains_key(&session_id) {
            let mut approvals = crate::tools::confirm::PendingApprovals::new();
            let mut asks = crate::tools::confirm::PendingAsks::new();

            // 设置 PendingApprovals 回调 — 向 SSE 流发送 tool_approval_required 事件
            {
                let tx_for_approval = tx.clone();
                approvals.on_pending = Some(std::sync::Arc::new(
                    move |id: &str, tool: &str, command: &str, description: Option<&str>| {
                        tx_for_approval
                            .send(StreamEvent::ToolApprovalRequired {
                                id: id.to_string(),
                                tool: tool.to_string(),
                                command: command.to_string(),
                                description: description.map(|s| s.to_string()),
                            })
                            .ok();
                    },
                ));
            }

            // 设置 PendingAsks 回调 — 向 SSE 流发送 ask_user 事件
            {
                let tx_for_ask = tx.clone();
                asks.on_pending = Some(std::sync::Arc::new(
                    move |id: &str, question: &str, options: &[String]| {
                        tx_for_ask
                            .send(StreamEvent::AskUser {
                                id: id.to_string(),
                                question: question.to_string(),
                                options: options.to_vec(),
                            })
                            .ok();
                    },
                ));
            }

            // 创建 AiAgent（从 settings 读取配置）
            let mut agent = crate::agent::AiAgent::new(crate::agent::AiAgentOptions {
                ..Default::default()
            })
            .map_err(|e| AppError::internal(format!("创建 AiAgent 失败: {}", e)))?;

            // 注册 Web 模式工具（使用 Channel 后端）
            agent.register_tool(crate::agent::chat::ToolHandler::AskUser(
                crate::tools::ask_user::AskUser::with_backend(
                    crate::tools::confirm::AskBackend::Channel(asks.clone()),
                ),
            ));

            // 注册 shell_exec（使用 Channel 确认后端）
            agent.register_tool(crate::agent::chat::ToolHandler::ShellExec(
                crate::tools::shell_exec::ShellExec::new(
                    crate::tools::shell_exec::ShellExecOptions {
                        confirm_backend: crate::tools::confirm::ConfirmBackend::Channel(
                            approvals.clone(),
                        ),
                        ..Default::default()
                    },
                ),
            ));

            // 注册其他工具（使用默认配置）
            let _ = crate::tools::web_fetch::WebFetch::new(Default::default())
                .map(|t| agent.register_tool(crate::agent::chat::ToolHandler::WebFetch(t)));
            agent.register_tool(crate::agent::chat::ToolHandler::FileSearch(
                crate::tools::file_search::FileSearch::new(Default::default()),
            ));
            agent.register_tool(crate::agent::chat::ToolHandler::FileFind(
                crate::tools::file_find::FileFind::new(Default::default()),
            ));
            agent.register_tool(crate::agent::chat::ToolHandler::FileRead(
                crate::tools::file_read::FileRead::new(Default::default()),
            ));
            agent.register_tool(crate::agent::chat::ToolHandler::FileEdit(
                crate::tools::file_edit::FileEdit::new(Default::default()),
            ));
            agent.register_tool(crate::agent::chat::ToolHandler::FileWrite(
                crate::tools::file_write::FileWrite::new(Default::default()),
            ));

            sessions_map.insert(
                session_id.clone(),
                crate::web::session::Session {
                    agent: Some(agent),
                    last_active: std::time::Instant::now(),
                    pending_approvals: approvals,
                    pending_asks: asks,
                    confirm_backend: crate::tools::confirm::ConfirmBackend::Channel(
                        crate::tools::confirm::PendingApprovals::new(),
                    ),
                    ask_backend: crate::tools::confirm::AskBackend::Channel(
                        crate::tools::confirm::PendingAsks::new(),
                    ),
                },
            );
        }
    }

    // 发送 session_id 给前端
    tx.send(StreamEvent::Status {
        content: format!("session_id: {}", session_id),
    })
    .ok();

    // 在后台执行 chat_with_tools
    let tx_clone = tx.clone();
    tokio::spawn(async move {
        // 从 session 中取出 agent，释放锁后再执行（避免 ask_user 死锁）
        let mut agent = {
            let mut sessions_map = sessions.lock().await;
            sessions_map.get_mut(&session_id).and_then(|s| {
                s.last_active = std::time::Instant::now();
                s.agent.take()
            })
        };
        // 释放锁 — 此时 handle_ask_respond / handle_approve 可以正常获取锁

        let result = if let Some(agent) = agent.as_mut() {
            // 调用 chat_with_tools
            agent
                .chat_with_tools(
                    &body.prompt,
                    &progress,
                    |chunk| {
                        // 流式文本块
                        tx_clone
                            .send(StreamEvent::TextDelta {
                                content: chunk.to_string(),
                            })
                            .ok();
                    },
                    |thinking_chunk| {
                        // 流式 thinking 块
                        tx_clone
                            .send(StreamEvent::ThinkingDelta {
                                content: thinking_chunk.to_string(),
                            })
                            .ok();
                    },
                )
                .await
        } else {
            tx_clone
                .send(StreamEvent::Error {
                    code: "SESSION_LOST".to_string(),
                    message: "会话已丢失".to_string(),
                })
                .ok();
            return;
        };

        // 把 agent 放回 session
        {
            let mut sessions_map = sessions.lock().await;
            if let Some(session) = sessions_map.get_mut(&session_id) {
                session.agent = agent;
                session.last_active = std::time::Instant::now();
            }
        }

        match result {
            Ok(_final_text) => {
                tx_clone
                    .send(StreamEvent::Done {
                        reason: "end_turn".to_string(),
                    })
                    .ok();
            }
            Err(e) => {
                tx_clone
                    .send(StreamEvent::Error {
                        code: "AGENT_ERROR".to_string(),
                        message: e,
                    })
                    .ok();
                tx_clone
                    .send(StreamEvent::Done {
                        reason: "error".to_string(),
                    })
                    .ok();
            }
        }
    });

    // 构建 SSE 流
    let stream = tokio_stream::wrappers::UnboundedReceiverStream::new(rx);
    let sse_stream = stream.map(|event| {
        let json = serde_json::to_string(&event).unwrap_or_default();
        Ok::<_, Infallible>(Event::default().data(json))
    });

    Ok(Sse::new(sse_stream))
}

/// POST /api/tool/approve — 工具审批
pub async fn handle_approve(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ApproveRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let decision = crate::tools::confirm::ShellConfirmDecision {
        approved: body.approved,
        edited_command: body.edited_command,
    };

    let found = state
        .sessions
        .resolve_approval(&body.session_id, &body.tool_approval_id, decision)
        .await;

    if found {
        Ok(Json(serde_json::json!({"status": "ok"})))
    } else {
        Err(AppError::not_found("审批 ID 不存在或已过期"))
    }
}

/// POST /api/ask/respond — 回答 AI 提问
pub async fn handle_ask_respond(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AskRespondRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let response = crate::tools::confirm::AskUserResponse {
        selected_idx: body.selected_idx,
        custom_text: body.custom_text,
    };

    let found = state
        .sessions
        .resolve_ask(&body.session_id, &body.ask_id, response)
        .await;

    if found {
        Ok(Json(serde_json::json!({"status": "ok"})))
    } else {
        Err(AppError::not_found("提问 ID 不存在或已过期"))
    }
}

/// GET /api/health — 健康检查
pub async fn handle_health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

// ── 错误类型 ──

pub struct AppError {
    status: StatusCode,
    code: String,
    message: String,
}

impl AppError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "INVALID_INPUT".to_string(),
            message: msg.into(),
        }
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "NOT_FOUND".to_string(),
            message: msg.into(),
        }
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "INTERNAL_ERROR".to_string(),
            message: msg.into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let body = serde_json::json!({
            "type": "error",
            "code": self.code,
            "message": self.message,
        });
        (self.status, Json(body)).into_response()
    }
}
