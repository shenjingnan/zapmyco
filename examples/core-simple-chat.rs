//! 使用 core 层进行简单 AI 对话。
//!
//! ```bash
//! # 先设置环境变量
//! export ZAPMYCO_API_KEY="sk-xxx"
//! export ZAPMYCO_BASE_URL="https://api.deepseek.com/anthropic"
//! export ZAPMYCO_MODEL="deepseek-v4-flash"
//!
//! # 运行
//! cargo run --example core-simple-chat
//! ```

use std::sync::Arc;
use tokio::sync::mpsc;
use zapmyco_core::*;

#[tokio::main]
async fn main() -> Result<(), AgentError> {
    // ── 从环境变量读取配置 ──
    let api_key = std::env::var("ZAPMYCO_API_KEY").expect("请设置 ZAPMYCO_API_KEY 环境变量");
    let base_url = std::env::var("ZAPMYCO_BASE_URL")
        .unwrap_or_else(|_| "https://api.deepseek.com/anthropic".to_string());
    let model = std::env::var("ZAPMYCO_MODEL").unwrap_or_else(|_| "deepseek-v4-flash".to_string());

    println!("模型: {}", model);
    println!("API:  {}", base_url);
    println!();

    // ── 创建 Agent 配置 ──
    let config = Arc::new(
        AgentConfig::new(&model, &api_key, &base_url)
            .with_system_prompt("你是一个简洁的 AI 助手。请用中文回答，每次回答不超过 200 字。"),
    );

    // ── 事件通道 ──
    let (event_tx, mut event_rx) = mpsc::channel(256);

    // ── 消费事件（在后台任务中） ──
    let display = tokio::spawn(async move {
        use std::io::Write;

        let mut stdout = std::io::stdout();
        let mut stderr = std::io::stderr();

        while let Some(event) = event_rx.recv().await {
            match event {
                AgentEvent::TextChunk { delta } => {
                    print!("{}", delta);
                    stdout.flush().ok();
                }
                AgentEvent::ThinkingChunk { .. } => {
                    // Extended Thinking 内容，这里忽略
                }
                AgentEvent::ToolInvocationStarted { name, input, .. } => {
                    writeln!(stderr, "\n\n🛠  调用工具: {}", name).ok();
                    writeln!(stderr, "   参数: {}", input).ok();
                    stderr.flush().ok();
                }
                AgentEvent::ToolInvocationFinished { result, .. } => {
                    match result {
                        Ok(r) => {
                            let preview = if r.len() > 100 { &r[..100] } else { &r };
                            let _ = writeln!(stderr, "   ✅ 成功: {}", preview);
                        }
                        Err(e) => {
                            let _ = writeln!(stderr, "   ❌ 失败: {}", e);
                        }
                    }
                    stderr.flush().ok();
                }
                AgentEvent::TokenUsage {
                    input_tokens,
                    output_tokens,
                    ..
                } => {
                    writeln!(
                        stderr,
                        "\n\n📊 Token 用量: 输入 {} | 输出 {}",
                        input_tokens, output_tokens
                    )
                    .ok();
                    stderr.flush().ok();
                }
                AgentEvent::Finished { reason } => {
                    writeln!(stderr, "\n\n🏁 完成 (reason: {})", reason).ok();
                    stderr.flush().ok();
                }
                _ => {}
            }
        }
    });

    // ── 运行 Agent ──
    let mut messages = vec![];
    let prompt = "用 Rust 实现一个斐波那契数列函数，并解释时间复杂度。";

    eprintln!("📤 发送: {}\n", prompt);
    eprintln!("📥 回复:\n");

    agent_loop(config, &mut messages, prompt, event_tx).await?;

    // 等待事件显示任务完成
    display.await.ok();

    // ── 打印完整回复 ──
    if let Some(last) = messages.last() {
        println!("\n\n最终回复 ({:?}/{}):", last.role, messages.len());
        println!("{}", last.content);
    }

    Ok(())
}
