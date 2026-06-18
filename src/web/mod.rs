//! Web Server 模块 — 基于 axum 的内置 HTTP 服务器。
//!
//! 提供 REST API 端点，供浏览器与 AI Agent 交互。
//! 使用 Streamable HTTP（JSON Lines）流式返回 AI 响应。

pub mod auth;
pub mod chat;
pub mod session;

use axum::{
    Router, middleware,
    routing::{get, post},
};
use std::sync::Arc;
use tower_http::services::ServeDir;

use crate::web::session::SessionManager;

/// 全局应用状态
pub struct AppState {
    /// Web 认证 Token（空 = 无认证）
    pub auth_token: String,
    /// Session 管理器
    pub sessions: SessionManager,
}

impl AppState {
    /// 创建新的应用状态。
    pub fn new(auth_token: String) -> Arc<Self> {
        Arc::new(Self {
            auth_token,
            sessions: SessionManager::new(),
        })
    }
}

/// 创建 axum Router，注册所有 API 路由。
pub fn create_router(state: Arc<AppState>) -> Router {
    let auth_token = state.auth_token.clone();
    let auth_middleware = move |req: axum::extract::Request, next: middleware::Next| {
        let token = auth_token.clone();
        async move {
            // 将 token 注入请求扩展，供 auth middleware 使用
            let mut req = req;
            req.extensions_mut().insert(token);
            auth::auth_middleware(req, next).await
        }
    };

    let api_routes = Router::new()
        .route("/api/chat", post(chat::handle_chat))
        .route("/api/tool/approve", post(chat::handle_approve))
        .route("/api/ask/respond", post(chat::handle_ask_respond))
        .route("/api/health", get(chat::handle_health))
        .layer(middleware::from_fn(auth_middleware));

    // 静态文件（前端页面）— 开发时从 web/ 目录加载
    // 发布时使用 rust-embed
    let static_routes = Router::new().nest_service("/", ServeDir::new("web"));

    Router::new()
        .merge(api_routes)
        .merge(static_routes)
        .with_state(state)
}
