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

    // 2. 绑定端口（被占用时询问用户如何处理）
    let (listener, actual_port) = resolve_port(&host, port).await?;

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
    // 6. 尝试自动打开浏览器（无头/容器环境会自动降级为提示，不影响服务器）
    let url = format!("http://{}:{}", host, actual_port);
    tokio::task::spawn_blocking(move || {
        if webbrowser::open(&url).is_ok() {
            info!("浏览器已自动打开: {}", url);
        } else {
            info!(
                "无法自动打开浏览器（无桌面环境或无默认浏览器），请手动访问: {}",
                url
            );
        }
    });
    // 7. 启动服务器，按 Ctrl+C 立即退出
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

/// 尝试绑定端口，被占用时询问用户如何处理。
async fn resolve_port(host: &str, port: u16) -> Result<(TcpListener, u16), String> {
    // 先试一次请求的端口
    if let Ok(listener) = TcpListener::bind(format!("{}:{}", host, port)).await {
        return Ok((listener, port));
    }

    // 端口被占用，探测下一个可用端口（持有 listener 避免竞争）
    let probe = bind_first_available(host, port).await;

    let opt_kill = format!("使用 {} (杀掉原有进程)", port);
    let opt_next = match probe {
        Some((_, p)) => format!("使用 {}", p),
        None => "使用其他端口".to_string(),
    };

    let choice = inquire::Select::new("端口被占，请选择:", vec![opt_kill.clone(), opt_next])
        .with_vim_mode(true)
        .prompt()
        .map_err(|e| format!("无法选择: {}", e))?;

    if choice == opt_kill {
        // 丢弃 probe 持有的 listener
        drop(probe);
        kill_process_on_port(port).await;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Ok(listener) = TcpListener::bind(format!("{}:{}", host, port)).await {
            return Ok((listener, port));
        }
        // 杀进程后仍绑不上，fallback
        bind_fallback(host, port).await
    } else if let Some((listener, p)) = probe {
        output::send(&Message::info(format!(
            "⚠️  端口 {} 被占用，已切换到 {}",
            port, p
        )));
        Ok((listener, p))
    } else {
        bind_fallback(host, port).await
    }
}

/// 尝试绑定端口的 fallback 序列。
async fn bind_fallback(host: &str, port: u16) -> Result<(TcpListener, u16), String> {
    for attempt in 1..10 {
        let p = port + attempt;
        match TcpListener::bind(format!("{}:{}", host, p)).await {
            Ok(listener) => {
                output::send(&Message::info(format!(
                    "⚠️  端口 {} 被占用，已切换到 {}",
                    port, p
                )));
                return Ok((listener, p));
            }
            Err(_) => continue,
        }
    }
    Err(format!("端口 {}-{} 均不可用", port, port + 9))
}

/// 绑定下一个可用端口（从 port+1 开始试），返回 (listener, port)。
async fn bind_first_available(host: &str, port: u16) -> Option<(TcpListener, u16)> {
    for attempt in 1..10 {
        let p = port + attempt;
        if let Ok(listener) = TcpListener::bind(format!("{}:{}", host, p)).await {
            return Some((listener, p));
        }
    }
    None
}

/// 查找并终止占用指定端口的进程（Unix: lsof + kill）。
async fn kill_process_on_port(port: u16) {
    #[cfg(unix)]
    {
        // lsof -ti :port 查找占用端口的 PID
        let port_str = format!(":{}", port);
        let output = std::process::Command::new("lsof")
            .args(["-ti", &port_str])
            .output()
            .ok();

        if let Some(out) = output
            && out.status.success()
        {
            let pids = String::from_utf8_lossy(&out.stdout);
            for line in pids.lines() {
                if let Ok(pid) = line.trim().parse::<i32>() {
                    // 先 SIGTERM
                    let _ = std::process::Command::new("kill")
                        .args(["-TERM", &pid.to_string()])
                        .output();
                    info!("已终止进程 PID {}", pid);
                }
            }
            // 给进程一点时间释放端口
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }
    }
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
