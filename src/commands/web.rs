//! `zapmyco web` 子命令 — 启动内置 Web Server。
//!
//! 用户通过浏览器与 AI Agent 交互。
//! 仅在 `127.0.0.1` 上监听，保证本地安全。
//! 如需远程访问，使用 `--host 0.0.0.0` + `--auth-token`。

use axum::Router;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::output::{self, Message};

/// 启动 Web Server 并等待关闭信号。
pub async fn cmd_web(port: u16, host: String, auth_token: Option<&str>) -> Result<(), String> {
    // 1. 确定 token
    let token = resolve_token(auth_token)?;

    // 2. 绑定端口（自动 fallback）
    let (listener, actual_port) = bind_with_fallback(&host, port)
        .await
        .map_err(|e| format!("端口绑定失败: {}", e))?;

    // 3. 创建共享状态
    let shared_state = crate::web::AppState::new(token.clone());

    // 4. 构建 axum router
    let app = Router::new()
        .merge(crate::web::create_router(shared_state))
        .layer(TraceLayer::new_for_http())
        .layer(RequestBodyLimitLayer::new(1024 * 1024)) // 1MB
        .layer(CorsLayer::permissive());

    // 5. 打印启动信息
    info!("🌐 Web UI 已启动: http://{}:{}/api/chat", host, actual_port);
    output::send(&Message::info(format!(
        "🌐 Web UI 已启动: http://{}:{}",
        host, actual_port
    )));
    if host != "127.0.0.1" {
        output::send(&Message::info(format!("🔑 认证 Token: {}", token)));
    }
    if actual_port != port {
        output::send(&Message::info(format!(
            "⚠️  端口 {} 被占用，已自动切换到 {}",
            port, actual_port
        )));
    }

    // 6. 启动服务器，按 Ctrl+C 立即退出
    tokio::select! {
        result = axum::serve(listener, app) => {
            if let Err(e) = result {
                return Err(format!("服务器错误: {}", e));
            }
        }
        _ = shutdown_signal() => {
            info!("用户中断，正在停止 Web Server...");
        }
    }

    output::send(&Message::info("👋 Web Server 已关闭".to_string()));
    Ok(())
}

/// 解析 token：优先用 `--auth-token`，未指定则不认证（本地模式安全）。
fn resolve_token(arg: Option<&str>) -> Result<String, String> {
    if let Some(token) = arg {
        if token.is_empty() {
            return Err("--auth-token 不能为空".to_string());
        }
        return Ok(token.to_string());
    }

    // 从 settings.toml 读取（将来可配置 web_auth_token 字段）
    if let Ok(_settings) = crate::config::settings::load_settings() {
        // TODO: 支持 settings 中的 web_auth_token 字段
    }

    // 本地模式无 token（安全），远程模式需要 --auth-token
    Ok(String::new())
}

/// 绑定端口，被占用时自动尝试下一个端口。
async fn bind_with_fallback(host: &str, port: u16) -> Result<(TcpListener, u16), String> {
    for attempt in 0..10 {
        let p = port + attempt;
        match TcpListener::bind(format!("{}:{}", host, p)).await {
            Ok(listener) => return Ok((listener, p)),
            Err(_) if attempt < 9 => continue,
            Err(e) => {
                return Err(format!("端口 {}-{} 均不可用: {}", port, port + 9, e));
            }
        }
    }
    unreachable!()
}

/// 优雅关闭信号：Ctrl+C 或 SIGTERM（Docker stop）。
async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    let sigterm = async {
        #[cfg(unix)]
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
        #[cfg(not(unix))]
        std::future::pending::<()>().await;
    };
    tokio::select! {
        _ = ctrl_c => {
            info!("收到 Ctrl+C 信号，正在关闭...");
        }
        _ = sigterm => {
            info!("收到 SIGTERM 信号，正在关闭...");
        }
    }
}
