# zapmyco Core 层架构设计方案

> 日期：2026-07-19
> 状态：草稿
> 版本：v1

## 1. 现状分析

### 1.1 当前架构

zapmyco 目前是一个**单体架构**，所有核心逻辑集中在 `src/agent/chat.rs` 的 `AiAgent` 结构体中（约 5570 行）。

```
main.rs
  │
  ├── cli.rs → 解析参数
  ├── commands/run.rs → 编排执行流程
  │     │
  │     └── agent/chat.rs
  │           ├── AiAgent（~5570 行）
  │           │   ├── 配置解析（读 settings.toml）
  │           │   ├── LLM 客户端管理
  │           │   ├── 模型选择逻辑
  │           │   ├── 对话历史管理
  │           │   ├── 流式请求/响应
  │           │   ├── 工具注册和调度
  │           │   ├── 工具执行循环
  │           │   ├── 并发控制
  │           │   ├── 日志记录
  │           │   ├── 会话元数据管理
  │           │   └── 进度上报
  │           │
  │           ├── tools/（16 种工具，通过枚举分发）
  │           └── output/（全局静态 Router + 终端/日志 Target）
  │
  └── web/ → 独立但共享 AiAgent
```

### 1.2 核心问题

| 问题 | 表现 | 影响 |
|------|------|------|
| **强环境耦合** | AiAgent::new() 读 `~/.zapmyco/settings.toml` | 无法在没有文件系统的环境使用（浏览器/WASM） |
| **全局静态输出** | `output::send()` 依赖全局 ROUTER | 无法同时运行多个独立 Agent 实例 |
| **工具枚举硬编码** | `ToolHandler` 是 enum，新增工具需改源码 | 外部无法注册自定义工具（如 CAD 绘图命令） |
| **单一体积大** | AiAgent 在一个文件 5570 行 | 难以理解、测试、维护 |
| **状态封装过深** | `messages` 在 AiAgent 内部管理 | 外部无法观察或注入对话历史 |

### 1.3 为什么现在要改

- 项目已是 v0.43.0，架构固化前拆分成本最低
- 已有 Web 模式、TUI 模式、CLI 模式三种前端，拆分后可共享 Core
- 社区已出现类似方案（如 Pi 的 pi-agent-core），验证了方向
- 外部嵌入场景需求明确（CAD/EDA/PS 等桌面软件）

## 2. 目标架构

```
┌─────────────────────────────────────────────────────────┐
│                       Adapters                           │
│  ┌──────────┐  ┌──────────┐  ┌──────┐  ┌────────────┐  │
│  │ CLI Adpt │  │ Web Adpt │  │WASM  │  │ Custom     │  │
│  │ (现有)   │  │ (现有)   │  │(未来)│  │ (FFI/嵌入)  │  │
│  └────┬─────┘  └────┬─────┘  └──┬───┘  └──────┬─────┘  │
│       │             │           │              │         │
├───────┼─────────────┼───────────┼──────────────┼─────────┤
│       │     Core API（稳定公开接口）             │         │
│       ▼             ▼           ▼              ▼         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              AgentCore                            │   │
│  │  ┌────────────────────────────────────────────┐  │   │
│  │  │  agent_loop(config, messages, input)       │  │   │
│  │  │  → EventStream<AgentEvent>                 │  │   │
│  │  │  → Vec<ConversationMessage>                │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  │                                                   │   │
│  │  ┌────────────────────┐  ┌────────────────────┐   │   │
│  │  │ AgentTool trait    │  │ AgentEvent enum    │   │   │
│  │  │ (可外部实现)        │  │ (事件流契约)        │   │   │
│  │  └────────────────────┘  └────────────────────┘   │   │
│  │                                                   │   │
│  │  ┌────────────────────┐  ┌────────────────────┐   │   │
│  │  │ AgentConfig        │  │ ConversationMessage │   │   │
│  │  │ (纯数据)            │  │ (纯数据)            │   │   │
│  │  └────────────────────┘  └────────────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                    SDK / 基础设施                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  zapmyco-anthropic-ai-sdk（已分离的 vendored 包）  │   │
│  │  zapmyco-grep（已分离的 vendored 包）               │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 2.1 分层职责

| 层 | 职责 | 依赖 |
|----|------|------|
| **Core** | 输入→LLM→工具→循环→事件。纯逻辑，无 I/O，无环境假设。 | 仅 SDK |
| **Adapter** | 配置来源、输出渲染、权限控制、日志记录。按场景替换。 | Core + 具体环境 |
| **SDK** | LLM 通信、文件搜索等基础设施 | — |

### 2.2 核心原则

1. **依赖注入** — Core 不读取任何配置文件，所有参数通过 `AgentConfig` 注入
2. **事件驱动** — Core 不直接渲染输出，通过 `AgentEvent` 流通知外部
3. **工具即 Trait** — `AgentTool` 是一个公开 trait，任何人可以实现
4. **纯数据流转** — 对话历史是值类型 `Vec<ConversationMessage>`，出入显式

## 3. Core 层详细设计

### 3.1 模块结构

```
src/core/
├── mod.rs               # 模块声明 + 重新导出
├── types.rs             # 基础数据类型
├── agent_tool.rs        # AgentTool trait
├── agent_event.rs       # AgentEvent 枚举
├── agent_config.rs      # AgentConfig 配置
└── agent_loop.rs        # agent_loop() 核心函数
```

### 3.2 核心数据类型（types.rs）

```rust
/// 对话角色
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
    Tool,
}

/// 一条对话消息
#[derive(Debug, Clone)]
pub struct ConversationMessage {
    pub role: Role,
    pub content: String,
}

impl ConversationMessage {
    pub fn user(content: impl Into<String>) -> Self { /* ... */ }
    pub fn assistant(content: impl Into<String>) -> Self { /* ... */ }
    pub fn tool(content: impl Into<String>) -> Self { /* ... */ }
}
```

**设计说明**：与现有 `crate::agent::chat::ConversationMessage` 结构相同但更简洁。现有版本包含 `blocks` 字段（用于 ToolUse/ToolResult 的结构化内容），Core 层暂时不包含，在 Adapter 层处理 SDK 的具体类型。

### 3.3 AgentTool Trait（agent_tool.rs）

```rust
/// 工具定义：Agent 可以调用的操作
///
/// 外部代码可以实现此 trait 来注册自定义工具。
/// 例如：CAD 插件可以实现 `DrawLine` 工具注册到 Agent。
#[async_trait]
pub trait AgentTool: Send + Sync {
    /// 工具名称（LLM 使用的标识符）
    fn name(&self) -> &str;

    /// 工具描述（LLM 决定是否调用时的参考）
    fn description(&self) -> &str;

    /// 工具参数的 JSON Schema
    fn input_schema(&self) -> serde_json::Value;

    /// 执行工具
    ///
    /// # 参数
    /// - `input`: 已通过 schema 校验的输入参数
    ///
    /// # 返回
    /// - Ok(String): 工具执行结果文本
    /// - Err(String): 工具执行失败，错误信息会传给 LLM
    async fn execute(&self, input: serde_json::Value) -> Result<String, String>;
}
```

**设计说明**：

- 使用 `#[async_trait]` 支持异步执行（当前所有工具都是 async）
- `Send + Sync` 确保工具可以在 tokio 多线程运行时中安全使用
- 相比当前 `ToolHandler` 枚举设计，trait 方案：
  - 允许外部 crate 实现自定义工具
  - 允许动态注册/注销
  - 简化单元测试（可以 mock）

### 3.4 AgentEvent 枚举（agent_event.rs）

```rust
/// Core 层发出的事件流
///
/// Adapter 层消费这些事件来决定如何渲染/处理。
/// 例如：CLI Adapter 将 TextChunk 输出到终端，
/// Web Adapter 将事件转为 SSE 发送给浏览器。
#[derive(Debug, Clone)]
pub enum AgentEvent {
    /// LLM 输出的文本片段（流式）
    TextChunk { delta: String },

    /// LLM 的思考过程（Extended Thinking）
    ThinkingChunk { delta: String },

    /// Agent 开始调用工具
    ToolInvocationStarted {
        id: String,
        name: String,
        input: serde_json::Value,
    },

    /// Agent 完成工具调用
    ToolInvocationFinished {
        id: String,
        result: Result<String, String>,
    },

    /// 一轮请求完成
    TurnFinished {
        tool_calls_count: usize,
    },

    /// Token 用量统计
    TokenUsage {
        input_tokens: u32,
        output_tokens: u32,
        cache_read_tokens: Option<u32>,
        cache_creation_tokens: Option<u32>,
    },

    /// Agent 执行结束
    Finished {
        reason: String,  // "completed" | "max_tool_rounds" | "error"
    },
}
```

**设计说明**：

- 相比当前 `output::MessageKind`（16 种变体），Core 事件更精简（7 种）
- 不包含渲染格式信息（如颜色、图标），Adapter 层负责添加
- 取消全局 ROUTER 模式，改为每个 Agent 实例独立的事件流
- 与 Pi 的 `AgentEvent` 设计对齐

### 3.5 AgentConfig（agent_config.rs）

```rust
/// Agent 的配置——所有的外部依赖都从这里注入
#[derive(Debug, Clone)]
pub struct AgentConfig {
    // ======= LLM 相关 =======
    /// 模型名称
    pub model: String,
    /// API Key
    pub api_key: String,
    /// API 端点
    pub base_url: String,
    /// API 版本
    pub api_version: String,
    /// 最大输出 tokens
    pub max_tokens: u32,

    // ======= 提示词 =======
    /// 系统提示词
    pub system_prompt: String,

    // ======= 工具 =======
    /// 注册的工具列表
    pub tools: Vec<Box<dyn AgentTool>>,

    // ======= 循环控制 =======
    /// 最大工具调用轮次
    pub max_tool_rounds: u32,

    // ======= 扩展特性 =======
    /// 是否启用 Extended Thinking
    pub thinking_enabled: bool,
}

impl AgentConfig {
    /// 创建基础配置
    pub fn new(
        model: impl Into<String>,
        api_key: impl Into<String>,
        base_url: impl Into<String>,
    ) -> Self { /* ... */ }
}
```

**设计说明**：

- 所有字段都是纯数据，没有引用、没有文件路径
- `tools` 使用 `Vec<Box<dyn AgentTool>>` 实现动态注册
- 提供 builder 模式方便按需配置
- SDK 的 `AnthropicClient` 在 Adapter 层或 Core 内部根据此配置创建，不在配置结构体中

### 3.6 核心函数（agent_loop.rs）

```rust
/// Agent 核心循环
///
/// # 参数
/// * `config` - Agent 配置（模型、工具等）
/// * `messages` - 对话历史（传入传出）
/// * `user_input` - 用户输入
/// * `event_tx` - 事件发送端
///
/// # 返回
/// 完整的对话历史（包含新添加的轮次）
///
/// # 设计
/// 这是一个纯异步函数，不持有任何状态。
/// 调用者负责管理消息队列、处理事件、控制生命周期。
pub async fn agent_loop(
    config: Arc<AgentConfig>,
    messages: &mut Vec<ConversationMessage>,
    user_input: impl Into<String>,
    event_tx: mpsc::Sender<AgentEvent>,
) -> Result<(), AgentError> {
    let user_input = user_input.into();
    messages.push(ConversationMessage::user(user_input));

    // 构建 SDK 客户端
    let client = AnthropicClient::builder(&config.api_key, &config.api_version)
        .with_api_base_url(&config.base_url)
        .build()
        .map_err(AgentError::Client)?;

    // 转化工具列表为 SDK 格式
    let tool_defs: Vec<Tool> = config.tools.iter()
        .map(|t| /* 将 AgentTool 转为 SDK Tool 格式 */)
        .collect();

    for _round in 0..config.max_tool_rounds {
        // ── 请求 LLM ──
        let params = build_params(&config, &messages, &tool_defs);
        let stream = client.create_message_streaming(&params)
            .await
            .map_err(AgentError::Api)?;

        // ── 处理流式响应 ──
        let round = process_stream(stream, &event_tx).await?;

        // ── 记录助手回复 ──
        messages.push(ConversationMessage::assistant(&round.full_text));

        // ── 没有工具调用 → 结束 ──
        if round.tool_uses.is_empty() {
            event_tx.send(AgentEvent::Finished { reason: "completed".into() }).await;
            return Ok(());
        }

        // ── 执行工具 ──
        for (id, name, input) in &round.tool_uses {
            event_tx.send(AgentEvent::ToolInvocationStarted {
                id: id.clone(), name: name.clone(), input: input.clone(),
            }).await;

            let result = match config.tools.iter().find(|t| t.name() == name) {
                Some(tool) => tool.execute(input.clone()).await,
                None => Err(format!("Unknown tool: {}", name)),
            };

            event_tx.send(AgentEvent::ToolInvocationFinished {
                id: id.clone(),
                result: result.clone(),
            }).await;

            // 工具结果作为用户消息追加
            let content = match result {
                Ok(text) => text,
                Err(e) => format!("Error: {}", e),
            };
            messages.push(ConversationMessage::tool(content));
        }

        event_tx.send(AgentEvent::TurnFinished {
            tool_calls_count: round.tool_uses.len(),
        }).await;
    }

    event_tx.send(AgentEvent::Finished { reason: "max_tool_rounds".into() }).await;
    Ok(())
}
```

**设计说明**：

- **无自持有状态** — 所有状态由调用者管理（`messages` 传出）
- **纯粹的函数式调用** — 输入 → 处理 → 输出，没有 builder、setter、初始化顺序等问题
- **事件流驱动** — 所有输出通过 `event_tx` channel 发送
- **与当前设计的映射**：

| 当前 AiAgent | 新 Core |
|-------------|---------|
| `chat_with_tools(input, progress, on_chunk)` | `agent_loop(config, messages, input, event_tx)` |
| `self.messages.push(...)` | 调用者传入的 `&mut messages` |
| `output::send(Message::llm_chunk(...))` | `event_tx.send(AgentEvent::TextChunk{...})` |
| `self.tools.iter().find(...)` | `config.tools.iter().find(...)` |
| `self.client.create_message_streaming(...)` | 内部创建的 client |

## 4. Adapter 层设计

Adapter 层是 Core 与具体环境的桥梁。下面以 CLI 和 Web 为例说明。

### 4.1 CLI Adapter（现有 commands/run.rs 改造方向）

```rust
// 伪代码：CLI Adapter 使用 Core 的方式
pub async fn cmd_run(options: RunOptions) -> Result<()> {
    // 1. 从 settings.toml 读取配置，构建 AgentConfig
    let settings = load_settings()?;
    let config = AgentConfig {
        model: options.model.unwrap_or(settings.default_model),
        api_key: resolve_api_key(&settings)?,
        base_url: resolve_base_url(&settings)?,
        system_prompt: build_system_prompt(),
        tools: build_tools(&settings),
        max_tool_rounds: u32::MAX,
        thinking_enabled: true,
    };

    // 2. 创建事件通道
    let (event_tx, mut event_rx) = mpsc::channel(256);

    // 3. 启动 Agent
    let mut messages = vec![];
    let config = Arc::new(config);

    // 4. 消费事件并渲染到终端
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            match event {
                AgentEvent::TextChunk { delta } => print!("{}", delta),
                AgentEvent::ToolInvocationStarted { name, .. } => {
                    println!("  🛠  {} ...", name);
                }
                AgentEvent::ToolInvocationFinished { result, .. } => {
                    match result {
                        Ok(_) => println!("  ✓"),
                        Err(e) => println!("  ✗ {}", e),
                    }
                }
                AgentEvent::TokenUsage { .. } => { /* 打印用量 */ }
                AgentEvent::Finished { .. } => break,
                _ => {}
            }
        }
    });

    // 5. 运行核心循环
    agent_loop(config, &mut messages, user_input, event_tx).await?;

    Ok(())
}
```

### 4.2 Web Adapter（现有 web/ 模块改造方向）

```rust
// 伪代码：Web Adapter
pub async fn handle_chat_request(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ChatRequest>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let (event_tx, event_rx) = mpsc::channel(256);

    // 从 session 获取或创建 AgentConfig
    let config = state.get_config_for_session(&req.session_id);

    let mut messages = state.get_history(&req.session_id);

    // 后台运行 Agent
    tokio::spawn(agent_loop(config, &mut messages, req.prompt, event_tx));

    // 将事件转为 SSE
    let stream = async_stream::stream! {
        while let Some(event) = event_rx.recv().await {
            match event {
                AgentEvent::TextChunk { delta } => {
                    yield Event::json(&StreamEvent::TextDelta { content: delta });
                }
                AgentEvent::ToolInvocationStarted { name, .. } => {
                    yield Event::json(&StreamEvent::ToolCall { tool: name, .. });
                }
                AgentEvent::Finished { .. } => {
                    yield Event::json(&StreamEvent::Done { reason: "completed" });
                }
                // ...
            }
        }
    };

    Sse::new(stream)
}
```

## 5 实施计划

### 阶段一：确立契约（当前步骤）

**目标**：在现有代码旁建立 `core/` 模块，定义核心抽象

**任务**：

| # | 任务 | 产出 |
|---|------|------|
| 1.1 | 创建 `src/core/types.rs` | `Role`, `ConversationMessage` |
| 1.2 | 创建 `src/core/agent_tool.rs` | `AgentTool` trait |
| 1.3 | 创建 `src/core/agent_event.rs` | `AgentEvent` 枚举 |
| 1.4 | 创建 `src/core/agent_config.rs` | `AgentConfig` 结构体 |
| 1.5 | 创建 `src/core/mod.rs` | 模块导出 |
| 1.6 | 编写单元测试 | 验证所有类型满足 Send + Sync |

**验收标准**：
- `cargo build` 通过
- `cargo test` 通过
- 所有类型定义完整，文档注释齐全
- 不修改任何现有代码

### 阶段二：实现 Core 循环

**目标**：实现 `agent_loop()` 函数，不依赖现有 AiAgent

**任务**：
1. 在 `agent_loop.rs` 中实现核心循环
2. 编写单元测试（使用 mock LLM API 或 wiremock）
3. 确保 Send + Sync 正确

**验收标准**：
- `cargo test` — 核心循环的单元测试通过
- 可以用纯 Core 层跑通一个完整对话（不含任何现有代码）

### 阶段三：适配器改造

**目标**：将现有 CLI 和 Web 模式改为基于 Core

**任务**：
1. 为现有工具实现 `AgentTool` trait（Adapter 包一层）
2. 改造 `commands/run.rs` 使用 `agent_loop()`
3. 改造 `web/` 使用 `agent_loop()`
4. 迁移输出渲染从全局 ROUTER 到事件消费

**验收标准**：
- `zapmyco run "xxx"` 行为与改造前一致
- `zapmyco web` 行为与改造前一致
- 所有现有测试通过

### 阶段四：清理与优化

**目标**：删除旧代码，清理抽象边界

**任务**：
1. 确认 `AiAgent` 不再被任何代码引用
2. 移除旧 `agent/chat.rs`（或精简为 Adapter 辅助）
3. 清理 `output/` 模块的全局状态
4. 性能对比基准测试

**验收标准**：
- `cargo build` 无 warning
- `cargo clippy -- -D warnings` 通过
- `cargo test` 全部通过

## 6. 风险与注意事项

### 6.1 兼容性风险

- 当前 `pub` 导出的 `AiAgent` 可能被外部使用（虽然不是 library，但存在可能）
- 每个阶段都要确保现有功能完全不受影响

### 6.2 性能考虑

- Core 使用 `mpsc::channel` 传递事件，有单次拷贝开销（对比当前直接调用 `output::send`）
- 应在阶段二加入性能基准测试，确保差异在可接受范围

### 6.3 工具生命周期

- 当前部分工具需要共享状态（如 `TaskManager` 用 `Arc`）
- `AgentTool` trait 需要 `Arc` 支持：`impl AgentTool for Arc<MyTool>`

### 6.4 与 vendored SDK 的关系

- Core 层应尽量不依赖 `zapmyco-anthropic-ai-sdk` 的具体类型
- 可通过核心函数内部使用 SDK，暴露接口使用纯 Rust 类型

## 7. 设计参考

- [Pi 的 pi-agent-core 架构](https://github.com/earendil-works/pi) — 事件驱动的 agent 循环
- [SQLite 的嵌入策略](https://www.sqlite.org/arch.html) — 单文件、零依赖、C ABI
- [FFmpeg 的 libav* 架构](https://ffmpeg.org/doxygen/trunk/index.html) — CLI + libraries 双模式
- 当前 zapmyco 的 `agent/chat.rs` — 需要重构的现状
