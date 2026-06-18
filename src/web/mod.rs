//! Web Server 模块 — 基于 axum 的内置 HTTP 服务器。
//!
//! 提供 REST API 端点，供浏览器与 AI Agent 交互。
//! 使用 Streamable HTTP（JSON Lines）流式返回 AI 响应。

pub mod auth;
pub mod chat;
pub mod session;

use axum::{
    Router,
    body::Body,
    http::{HeaderValue, Request, header::CACHE_CONTROL},
    middleware,
    response::Response,
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

    // 静态文件（前端页面）— 使用 fallback_service 替代 nest_service
    // (axum 0.8 不允许在根路径 nesting)
    // 独立的路由器，方便为静态文件单独配置中间件
    let static_router = Router::new()
        .fallback_service(ServeDir::new("web/dist"))
        .layer(middleware::from_fn(static_file_cache_headers));

    Router::new()
        .merge(api_routes)
        .merge(static_router)
        .with_state(state)
}

/// 为 HTML 响应设置 `Cache-Control: no-cache`，防止浏览器缓存 `index.html`。
///
/// Vite 构建时 JS/CSS 文件带有内容哈希，更新后哈希变化，浏览器会自动请求新文件。
/// 但 `index.html` 没有哈希后缀，浏览器可能缓存旧版本导致引用旧的 CSS/JS。
async fn static_file_cache_headers(request: Request<Body>, next: middleware::Next) -> Response {
    let mut response = next.run(request).await;

    // 仅对 HTML 响应设置 no-cache，避免浏览器缓存 index.html
    if response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/html"))
    {
        response
            .headers_mut()
            .insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }

    response
}
