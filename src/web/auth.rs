//! Bearer Token 认证中间件。

use axum::{
    extract::Request,
    http::{StatusCode, header},
    middleware::Next,
    response::Response,
};

/// 认证中间件 — 验证 `Authorization: Bearer <token>` header。
///
/// 如果 token 为空（本地模式），跳过认证。
pub async fn auth_middleware(req: Request, next: Next) -> Result<Response, StatusCode> {
    let expected = req
        .extensions()
        .get::<String>()
        .cloned()
        .unwrap_or_default();

    // 空 token = 无认证（本地 localhost 模式）
    if expected.is_empty() {
        return Ok(next.run(req).await);
    }

    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if let Some(token) = auth_header.strip_prefix("Bearer ")
        && token == expected
    {
        return Ok(next.run(req).await);
    }

    Err(StatusCode::UNAUTHORIZED)
}
