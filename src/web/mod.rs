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
    http::{HeaderValue, header::CACHE_CONTROL},
    middleware,
    response::Response,
    routing::{get, post},
};
use rust_embed::RustEmbed;
use std::sync::Arc;

use crate::web::session::SessionManager;

/// 通过 rust-embed 在编译时嵌入 `web/dist/` 目录的前端静态资源。
#[derive(RustEmbed)]
#[folder = "web/dist"]
struct Assets;

/// 为 SPA 路由提供最佳匹配逻辑：
/// 1. 精确匹配请求路径；
/// 2. 如果路径不含扩展名（如 `/chat`），fallback 到 `index.html`（SPA 路由）；
/// 3. 如果路径含扩展名但找不到资源，返回 404。
async fn handle_embedded(uri: axum::http::Uri) -> Result<Response<Body>, axum::http::StatusCode> {
    let path = uri.path().trim_start_matches('/');

    // SPA 路由：空路径或不含扩展名 → index.html
    let asset_path = if path.is_empty() || !path.contains('.') {
        "index.html"
    } else {
        path
    };

    let asset = Assets::get(asset_path).ok_or(axum::http::StatusCode::NOT_FOUND)?;

    let content_type = mime_type_for_path(asset_path);
    let body = Body::from(asset.data.to_vec());

    let mut response = Response::builder()
        .header("content-type", content_type)
        .body(body)
        .unwrap();

    // HTML 资源不缓存，确保 Vite 构建后浏览器获取最新版本
    if asset_path == "index.html" {
        response
            .headers_mut()
            .insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }

    Ok(response)
}

/// 根据文件扩展名返回 MIME 类型。
fn mime_type_for_path(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext {
        "html" => "text/html",
        "js" => "text/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "json" => "application/json",
        "map" => "application/json",
        _ => "application/octet-stream",
    }
}

/// 检查 Web 前端资源是否已嵌入二进制。
pub fn has_embedded_assets() -> bool {
    Assets::get("index.html").is_some()
}

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

    // 静态文件（前端页面）— 使用 rust-embed 在编译时嵌入 web/dist/
    let static_router = Router::new().fallback(get(handle_embedded));

    Router::new()
        .merge(api_routes)
        .merge(static_router)
        .with_state(state)
}
