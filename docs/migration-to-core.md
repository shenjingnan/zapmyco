# 从 AiAgent 迁移到 Core 层的迁移指南

> 日期：2026-07-19
> 状态：草稿
> 对应架构文档：`docs/plans/2026-07-19-zapmyco-core-design.md`

## 概述

本文档指导如何将现有的基于 `AiAgent` 的代码迁移到新的 `core::agent_loop()` API。

**当前状态**：Core 层（阶段一～三）已完成，适配器层已就绪，但 `commands/run.rs` 和 `web/` 模块仍使用旧的 `AiAgent`。

## 新旧 API 对照

### 创建 Agent

| 旧 API | 新 API |
|--------|--------|
| `AiAgent::new(options)` → 读 settings.toml | `AgentConfig::new(model, api_key, base_url)` → 纯数据注入 |

```rust
// 旧
let agent = AiAgent::new(AiAgentOptions {
    model: Some("deepseek-v4-flash".into()),
    api_key: Some("sk-xxx".into()),
    ..Default::default()
})?;

// 新
let config = Arc::new(
    AgentConfig::new("deepseek-v4-flash", "sk-xxx", "https://api.deepseek.com/anthropic")
        .with_system_prompt("...")
        .with_tools(from_tool_handlers(handlers)),
);
```

### 注册工具

| 旧 API | 新 API |
|--------|--------|
| `agent.register_tool(ToolHandler::FileRead(...))` | `AgentConfig::with_tools(from_tool_handlers(vec![...]))` |

```rust
// 旧
agent.register_tool(ToolHandler::FileRead(FileRead::new(options)));
agent.register_tool(ToolHandler::WebFetch(WebFetch::new(options)));

// 新（批量转换）
let handlers = vec![
    ToolHandler::FileRead(FileRead::new(FileReadOptions::default())),
    ToolHandler::WebFetch(WebFetch::new(WebFetchOptions::default())),
];
let config = AgentConfig::new(..).with_tools(from_tool_handlers(handlers));
```

也可以单独添加自定义工具：
```rust
// 新：混合使用现有工具和自定义工具
let mut tools: Vec<Box<dyn AgentTool>> = from_tool_handlers(handlers);
tools.push(Box::new(MyCustomTool));
let config = AgentConfig::new(..).with_tools(tools);
```

### 运行对话

| 旧 API | 新 API |
|--------|--------|
| `agent.chat_with_tools(input, progress, callback)` | `agent_loop(config, messages, input, event_tx)` |

```rust
// 旧（带状态的结构体方法）
agent.chat_with_tools("hello", &mut progress, |chunk| {
    output::send(&Message::llm_chunk(chunk));
}).await?;

// 新（纯函数 + 事件流）
let (event_tx, mut event_rx) = mpsc::channel(256);

// 消费事件
tokio::spawn(async move {
    while let Some(event) = event_rx.recv().await {
        match event {
            AgentEvent::TextChunk { delta } => print!("{}", delta),
            AgentEvent::ToolInvocationStarted { name, .. } => {
                eprintln!("🛠 {} ...", name);
            }
            AgentEvent::Finished { .. } => break,
            _ => {}
        }
    }
});

let mut messages = vec![];
agent_loop(Arc::new(config), &mut messages, "hello", event_tx).await?;
```

### 事件对比

| AiAgent 输出 | Core 事件 |
|--------------|-----------|
| `output::send(Message::llm_chunk(...))` | `AgentEvent::TextChunk { delta }` |
| `output::send(Message::llm_thinking_delta(...))` | `AgentEvent::ThinkingChunk { delta }` |
| `output::send(Message::tool_call(...))` | `AgentEvent::ToolInvocationStarted { id, name, input }` |
| `output::send(Message::tool_result(...))` | `AgentEvent::ToolInvocationFinished { id, result }` |
| `output::send(Message::llm_usage(...))` | `AgentEvent::TokenUsage { input_tokens, output_tokens }` |
| — | `AgentEvent::TurnFinished { tool_calls_count }` |
| — | `AgentEvent::Finished { reason }` |

## 使用适配器过渡

如果不想立即完全迁移，可以使用适配器层调用 Core：

```rust
use zapmyco::core::*;
use zapmyco::core::adapters::*;

// 1. 用现有配置逻辑构建 AgentConfig
let config = build_config_from_settings()?; // 你现有的配置读取逻辑

// 2. 用 LegacyToolAdapter 包装现有工具
let tools = from_tool_handlers(build_tool_handlers());
let config = config.with_tools(tools);

// 3. 用 core_event_handler 渲染到终端
let (event_tx, mut event_rx) = mpsc::channel(256);
tokio::spawn(async move {
    while let Some(event) = event_rx.recv().await {
        core_event_handler(&event);
    }
});

// 4. 运行
let mut messages = vec![];
agent_loop(Arc::new(config), &mut messages, prompt, event_tx).await?;
```

## 迁移注意事项

### 配置来源
- **旧**: `AiAgent::new()` 自动读 `~/.zapmyco/settings.toml`，解析模型选择、API Key
- **新**: `AgentConfig` 是纯数据，配置读取由 Adapter 层负责

迁移时需要把配置读取逻辑提取出来：
```rust
// 提取配置 → 构建 AgentConfig
let settings = load_settings()?;
let config = AgentConfig::new(
    resolve_model(&settings),
    resolve_api_key(&settings),
    resolve_base_url(&settings),
)
.with_system_prompt(build_system_prompt())
.with_tools(tools);
```

### 对话历史管理
- **旧**: `AiAgent` 内部持有 `messages: Vec<ConversationMessage>`，通过方法操作
- **新**: `messages` 由调用者管理，传入传出

```rust
// 多轮对话
let mut messages = vec![];
agent_loop(config.clone(), &mut messages, "第一轮", tx1).await?;
agent_loop(config.clone(), &mut messages, "第二轮", tx2).await?;
```

### 进度显示
- **旧**: 注入 `ProgressReporter` trait
- **新**: 通过 `AgentEvent` 自行决定进度显示方式（当前 Core 不内置进度条）

需要监听 `ToolInvocationStarted` / `TurnFinished` 等事件来实现进度显示。

### 日志记录
- **旧**: `SessionLogger` 在 `AiAgent::new()` 中自动初始化
- **新**: Core 不内置日志，需要在 Adapter 层自行监听事件写入日志

## 迁移路线图

```
1. 提取配置逻辑       ← 把 settings.toml 读取从 AiAgent 构造函数中拆出
2. 适配事件处理       ← 实现 AgentEvent → 输出/日志的转换
3. 替换单条调用路径   ← 选择一个简单场景替换（如 zapmyco run 的非交互模式）
4. 功能对比测试       ← 新旧路径并行运行，对比结果一致性
5. 全面切换           ← 确认无差异后，删除旧路径
```

当前进度：✅ 适配器层已完成，可随时开始步骤 1-2。
