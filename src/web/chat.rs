//! Chat handler — 流式 AI 对话端点（基于 zapmyco_core::agent_loop）。

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
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::commands::config_resolver::resolve_llm_config;
use crate::prompts::{BEHAVIORAL_GUIDANCE, DEFAULT_SYSTEM_PROMPT};
use zapmyco_core::{AgentConfig, agent_loop};

use super::AppState;
use super::events::agent_event_to_stream_event;
use super::tools::build_web_tools;

// ── Request/Response 类型 ──

/// POST /api/chat 请求体
#[derive(Deserialize)]
pub struct ChatRequest {
    pub prompt: String,
    pub session_id: Option<String>,
}

/// POST /api/tool/approve 请求体
#[derive(Deserialize)]
pub struct ApproveRequest {
    pub session_id: String,
    pub tool_approval_id: String,
    pub approved: bool,
    pub edited_command: Option<String>,
}

/// POST /api/ask/respond 请求体
#[derive(Deserialize)]
pub struct AskRespondRequest {
    pub session_id: String,
    pub ask_id: String,
    pub selected_idx: Option<usize>,
    pub custom_text: Option<String>,
}

// ── SSE 事件类型 ──

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
    #[serde(rename = "current_dir")]
    CurrentDir { path: String },
}

// ── Chat 端点 ──

/// POST /api/chat — 流式对话（基于 agent_loop + AgentEvent→SSE 适配器）
pub async fn handle_chat(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ChatRequest>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, AppError> {
    if body.prompt.trim().is_empty() {
        return Err(AppError::bad_request("prompt 不能为空"));
    }

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<StreamEvent>();
    let sessions = state.sessions.inner();
    let session_id = body
        .session_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // ── 获取或创建 session（锁内构建 config + tools） ──
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

            // 解析 LLM 配置并构建 AgentConfig
            let resolved = resolve_llm_config(None, None, None, None)
                .map_err(|e| AppError::internal(format!("解析 LLM 配置失败: {}", e)))?;
            let system_prompt = format!("{}{}", DEFAULT_SYSTEM_PROMPT, BEHAVIORAL_GUIDANCE);
            let cwd = Arc::new(Mutex::new(
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            ));

            let tools =
                build_web_tools(&approvals, &asks, cwd.clone()).map_err(AppError::internal)?;
            let config = Arc::new(
                AgentConfig::new(&resolved.model, &resolved.api_key, &resolved.base_url)
                    .with_max_tokens(resolved.max_tokens)
                    .with_system_prompt(&system_prompt)
                    .with_tools(tools),
            );

            let cwd_path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let agents_md = crate::agents_md::load_agents_md(&cwd_path);
            let context_reminder = crate::prompts::build_context_reminder(agents_md.as_deref());

            sessions_map.insert(
                session_id.clone(),
                crate::web::session::Session {
                    messages: Some(Vec::new()),
                    config,
                    cwd,
                    last_active: std::time::Instant::now(),
                    pending_approvals: approvals,
                    pending_asks: asks,
                    context_reminder,
                    context_injected: false,
                },
            );
        }
    }

    // 发送 session_id 给前端
    tx.send(StreamEvent::Status {
        content: format!("session_id: {}", session_id),
    })
    .ok();

    // ── 后台执行 agent_loop（不持有 sessions 锁，避免审批/提问死锁） ──
    let tx_clone = tx.clone();
    tokio::spawn(async move {
        // 取出会话数据，释放锁后再执行
        let (mut messages, config, cwd, context_reminder, mut context_injected) = {
            let mut sessions_map = sessions.lock().await;
            let Some(session) = sessions_map.get_mut(&session_id) else {
                tx_clone
                    .send(StreamEvent::Error {
                        code: "SESSION_LOST".to_string(),
                        message: "会话已丢失".to_string(),
                    })
                    .ok();
                return;
            };
            session.last_active = std::time::Instant::now();
            let Some(msgs) = session.messages.take() else {
                tx_clone
                    .send(StreamEvent::Error {
                        code: "SESSION_LOST".to_string(),
                        message: "会话正在处理中，请稍后重试".to_string(),
                    })
                    .ok();
                return;
            };
            (
                msgs,
                session.config.clone(),
                session.cwd.clone(),
                session.context_reminder.clone(),
                session.context_injected,
            )
        };
        // 释放锁 — 此时 handle_ask_respond / handle_approve 可以正常获取锁

        // 发送初始工作目录
        tx_clone
            .send(StreamEvent::CurrentDir {
                path: cwd.lock().unwrap().to_string_lossy().to_string(),
            })
            .ok();

        // context_reminder 仅首条注入
        let prompt = if !context_injected {
            context_injected = true;
            format!("{}{}", context_reminder, body.prompt)
        } else {
            body.prompt.clone()
        };

        // 事件桥：AgentEvent → SSE
        let (agent_tx, mut agent_rx) = tokio::sync::mpsc::channel(256);
        let fwd_tx = tx_clone.clone();
        let fwd_cwd = cwd.clone();
        let forwarder = tokio::spawn(async move {
            while let Some(event) = agent_rx.recv().await {
                for sse in agent_event_to_stream_event(&event, &fwd_cwd) {
                    fwd_tx.send(sse).ok();
                }
            }
        });

        let result = agent_loop(config, &mut messages, prompt, agent_tx).await;
        forwarder.await.ok(); // 排空剩余事件

        // 放回会话
        {
            let mut sessions_map = sessions.lock().await;
            if let Some(session) = sessions_map.get_mut(&session_id) {
                session.messages = Some(messages);
                session.context_injected = context_injected;
                session.last_active = std::time::Instant::now();
            }
        }

        match result {
            Ok(()) => {
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
                        message: e.to_string(),
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
