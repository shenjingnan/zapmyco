# zapmyco-core

<p align="center">
  <a href="https://crates.io/crates/zapmyco-core"><img src="https://img.shields.io/crates/v/zapmyco-core.svg?color=brightgreen" alt="crates.io"></a>
  <a href="https://docs.rs/zapmyco-core"><img src="https://docs.rs/zapmyco-core/badge.svg" alt="docs.rs"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-brightgreen.svg" alt="License: MIT"></a>
</p>

环境无关的 AI Agent 运行时核心 —— ReAct 循环、工具抽象、事件系统。

`zapmyco-core` 是 [zapmyco](https://github.com/shenjingnan/zapmyco) 的核心抽象层，可独立作为库嵌入到任意 Rust 项目，用于构建基于 Anthropic API 兼容接口的 Agent。

## 特性

- **零环境依赖**：不读文件、不写终端、不碰环境变量，可嵌入 CLI / Web / 后台任务等任意环境
- **依赖注入**：所有外部依赖通过 `AgentConfig` 传入
- **事件驱动**：所有输出通过 `AgentEvent` 流发送，由调用方决定如何渲染
- **工具即 Trait**：通过 `AgentTool` trait 注册工具，不通过枚举硬编码，可自由扩展

## 快速开始

添加依赖：

```toml
[dependencies]
zapmyco-core = "0.1"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync"] }
serde_json = "1"
async-trait = "0.1"
```

最小示例：

```rust
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::mpsc;
use zapmyco_core::{agent_loop, AgentConfig, AgentEvent, AgentTool};

// 1. 定义自定义工具：任何实现 `AgentTool` 的类型都可注册
struct GreetTool;

#[async_trait::async_trait]
impl AgentTool for GreetTool {
    fn name(&self) -> &str {
        "greet"
    }
    fn description(&self) -> &str {
        "向用户打招呼"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }
    async fn execute(&self, _input: Value) -> Result<String, String> {
        Ok("Hello from zapmyco-core!".to_string())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 2. 通过 AgentConfig 注入外部依赖
    let config = AgentConfig::new(
        "claude-sonnet-5",
        std::env::var("ANTHROPIC_API_KEY").unwrap_or_default(),
        "https://api.anthropic.com",
    )
    .with_system_prompt("You are a helpful assistant")
    .with_tools(vec![Box::new(GreetTool)]);

    // 3. 运行 ReAct 循环，通过事件通道消费输出
    let (event_tx, mut event_rx) = mpsc::channel(64);
    let mut messages = Vec::new();
    agent_loop(Arc::new(config), &mut messages, "你好", event_tx).await?;

    while let Some(event) = event_rx.recv().await {
        match event {
            AgentEvent::TextChunk { delta } => print!("{delta}"),
            AgentEvent::Finished { reason } => println!("\n完成: {reason}"),
            _ => {}
        }
    }
    Ok(())
}
```

## 核心概念

### AgentConfig —— 依赖注入

所有外部依赖（模型、API Key、端点、工具、提示词等）通过 `AgentConfig` 传入，Core 层不读取任何外部配置。

```rust
let config = AgentConfig::new(model, api_key, base_url)
    .with_system_prompt("...")
    .with_tools(vec![Box::new(MyTool)])
    .with_max_tool_rounds(10)
    .with_thinking(false);
```

### AgentTool —— 工具即 Trait

实现 `AgentTool` trait 即可为 Agent 添加自定义工具，支持 `Send + Sync`，可跨 crate 边界使用：

```rust
#[async_trait]
impl AgentTool for GreetTool {
    fn name(&self) -> &str { "greet" }
    fn description(&self) -> &str { "向用户打招呼" }
    fn input_schema(&self) -> Value { json!({}) }
    async fn execute(&self, input: Value) -> Result<String, String> { /* ... */ }
}
```

### agent_loop —— ReAct 循环

核心入口，驱动「推理 → 工具调用 → 继续/结束」的循环，返回 `Result<(), AgentError>`。

```rust
agent_loop(Arc::new(config), &mut messages, user_input, event_tx).await?;
```

### AgentEvent —— 事件流

Core 层通过 `mpsc::Sender<AgentEvent>` 向外输出所有状态变化：

| 事件 | 说明 |
| ---- | ---- |
| `TextChunk` | LLM 输出的文本片段（流式） |
| `ThinkingChunk` | Extended Thinking 思考过程 |
| `ToolInvocationStarted` / `ToolInvocationFinished` | 工具调用开始 / 结束 |
| `TurnFinished` | 一轮请求完成 |
| `TokenUsage` | Token 用量统计 |
| `Finished` | Agent 执行结束 |

### ConversationMessage —— 对话历史

```rust
let mut messages = Vec::new();
messages.push(ConversationMessage::user("你好"));
messages.push(ConversationMessage::assistant("你好，有什么可以帮你？"));
messages.push(ConversationMessage::tool_result("查询结果"));
```

## 错误处理

`AgentError` 覆盖核心循环的常见失败场景：

| 变体 | 说明 |
| ---- | ---- |
| `Api` | API 调用失败 |
| `ToolExecution` | 工具执行失败 |
| `MaxRoundsReached` | 达到最大工具调用轮次 |
| `ChannelClosed` | 事件通道关闭 |
| `Conversion` | 消息转换失败 |

## 设计原则

- **零环境依赖**：不读文件、不写终端、不碰环境变量
- **依赖注入**：所有外部依赖通过 `AgentConfig` 传入
- **事件驱动**：所有输出通过 `AgentEvent` 流发送
- **工具即 Trait**：通过 `AgentTool` trait 注册，不通过枚举硬编码

## 文档

完整 API 文档见 [docs.rs/zapmyco-core](https://docs.rs/zapmyco-core)。

## License

[MIT](https://opensource.org/licenses/MIT)
