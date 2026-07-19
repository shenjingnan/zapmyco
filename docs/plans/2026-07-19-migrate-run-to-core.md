# 迁移 commands/run.rs 到 Core 层的技术方案

> 日期：2026-07-19
> 状态：草稿
> 版本：v1

## 1. 现状分析

### 1.1 commands/run.rs 结构

`cmd_run()` 函数约 635 行核心逻辑，整体流程如下：

```
cmd_run(content, skill, profile, permission_mode, ...)
│
├── [A] 前置准备（~130 行）
│   ├── 解析 content / skill_name
│   ├── 扫描 skill 文件
│   ├── 加载指定 skill
│   ├── 构建 system prompt
│   └── 构建 AiAgentOptions → new AiAgent()
│
├── [B] 外围设施（~20 行）
│   ├── 注册 terminal.log
│   ├── 注册 app.log
│   └── 注册 Ctrl+C 处理器
│
├── [C] 工具注册（~140 行）
│   ├── 注册 16 种工具（含权限/技能过滤）
│   ├── 注册 task_manager
│   └── 根据 permission_mode 过滤工具
│
├── [D] 会话历史（~10 行）
│   └── 如果指定 --session，加载历史
│
├── [E] 执行（~230 行）
│   ├── Plan 模式（~200 行）
│   │   ├── Phase 1: 分析规划（只读工具，Progress 面板）
│   │   ├── Phase 2: 审批循环（用户批准/反馈）
│   │   ├── Phase 3: 执行 + task loop
│   │   └── Phase 4: 总结
│   │
│   └── Base 模式（~30 行）
│       └── 单次 chat_with_tools + task loop
│
├── [F] 收尾（~90 行）
│   ├── 检查子 Agent
│   ├── 交互式继续循环
│   └── finish_session()
│
└── [G] 辅助函数（~620 行）
    ├── run_task_loop()
    ├── build_skill_preamble()
    ├── build_run_options()
    ├── generate_session_id()
    ├── register_terminal_log()
    ├── register_app_log()
    └── 测试（~490 行）
```

### 1.2 替换的关键点

需要将 `[E] 执行` 部分的 `agent.chat_with_tools()` 替换为 `agent_loop()`。

但 `chat_with_tools` 的调用散布在三个地方：

| 位置 | 用途 | 难度 |
|------|------|------|
| Base 模式（行 527-536） | 单次对话 | 低 |
| Plan phase 1（行 339-348） | 分析规划 | 中 |
| Plan phase 3（行 474-483） | 执行 | 中 |
| Plan phase 4（行 491-500） | 总结 | 低 |
| Plan 反馈优化（行 401-416） | 反馈后重新规划 | 中 |
| run_task_loop（行 671） | 任务循环 | 高 |
| 交互式继续（行 610-619） | 多轮对话 | 中 |

### 1.3 核心依赖

`chat_with_tools` 的依赖链：

```
chat_with_tools(input, progress, on_chunk, on_thinking)
  ├── self: &mut AiAgent    → 需要状态保持（messages, tools, stats, logger）
  ├── progress              → RunProgress（ProgressReporter trait）
  ├── on_chunk              → 流式文本回调（→ output::send）
  └── on_thinking           → thinking 回调（→ output::send）
```

对应 Core：

```
agent_loop(config, messages, input, event_tx)
  ├── config: Arc<AgentConfig>  → 纯数据
  ├── messages: &mut Vec<...>   → 调用者管理
  ├── input: String             → 用户输入
  └── event_tx                  → 事件流
```

## 2. 迁移策略：增量替换，而非重写

### 核心原则

1. **不删旧代码** — 旧路径和新路径共存，可切换
2. **从简单场景开始** — 先替换 Base 模式，再替换 Plan 模式
3. **提取共享逻辑** — 工具注册、配置解析等逻辑提取为公用函数
4. **可对比验证** — 新旧路径的行为应一致

### 3. 实施步骤

#### 步骤一：提取配置解析函数

**目标**：把 `AiAgent::new()` 中的配置解析逻辑（模型选择、API Key 解析、base URL 解析）提取为一个独立函数，新旧路径共用。

**当前问题**：
```rust
let agent = AiAgent::new(options)?;                    // 创建 agent
let api_key = agent.api_key();                          // 之后才能取
let tools = WebSearch::new(agent.api_key(), ...)?;      // 构造工具需要
agent.register_tool(ToolHandler::WebSearch(web_search));
```

**改造后**：
```rust
let resolved = resolve_llm_config(options)?;             // 纯配置解析
// resolved.api_key, resolved.base_url, resolved.model, resolved.max_tokens

let tools = build_tools(&resolved, ...)?;                // 工具构造用 resolved 值
let config = AgentConfig::new(resolved.model, ...)       // 构建 Core config
    .with_tools(from_tool_handlers(tools));

// 旧路径也可以使用 resolved 值来构造 AiAgent
```

**变更范围**：
- 新增：`src/commands/config_resolver.rs` — `resolve_llm_config()` 函数
- 修改：`src/commands/run.rs` — 使用新的 resolver
- 不修改：`src/agent/chat.rs`（AiAgent 保持不变）

---

#### 步骤二：创建 Core 执行路径 — Base 模式

**目标**：新增 `cmd_run_core()` 函数，实现 Base 模式的 Core 路径。

```
cmd_run_core()                                  cmd_run() 保持不变
├── 解析 content / skill                           ├── ...（现有逻辑）
├── 扫描 skill                                   ├── 使用 AiAgent
├── resolve_llm_config()                          ├── 使用 AiAgent
├── build_tools() → from_tool_handlers()           └── 使用 AiAgent
├── build AgentConfig                             
├── agent_loop() ← core_event_handler()           
└── 跟随交互循环                                 
```

**与原路径的差异**：

| 方面 | 旧路径 | 新 Core 路径 |
|------|--------|-------------|
| agent 创建 | `AiAgent::new(options)` — 自动读 settings.toml | `resolve_llm_config()` + `AgentConfig::new()` |
| 工具注册 | `agent.register_tool()` → AiAgent 内部 | `from_tool_handlers()` → AgentConfig |
| 执行 | `agent.chat_with_tools(input, progress, cb)` | `agent_loop(config, messages, input, tx)` |
| 输出 | `on_chunk` 回调 → `output::send()` | `core_event_handler(&event)` → `output::send()` |
| 进度条 | `RunProgress`（ProgressReporter trait） | 自行从 AgentEvent 重建 |
| 错误 | `Result<(), String>` | `AgentError` → 可适配 |

**CLI 集成**：
```bash
# 新命令
zapmyco run "prompt"               # 旧路径（默认）
zapmyco run "prompt" --use-core    # 新路径（新增 --use-core 标志）

# 或者新子命令
zapmyco core-run "prompt"          # 新路径
```

---

#### 步骤三：实现 Plan 模式的 Core 路径

**目标**：将 Plan 模式的四个阶段（分析→审批→执行→总结）迁移到 Core。

**关键难点**：

1. **Phase 1-3 间切换工具集** — 分析阶段只有只读工具，执行阶段有全部工具
   - Core 方案：每次 `agent_loop` 调用用不同的 `AgentConfig`（浅拷贝 + 不同工具集）

2. **Phase 2 审批循环** — 用户批准/反馈后，需要追加消息并重新调用
   - Core 方案：`messages` 由调用者管理，追加反馈消息后再次调 `agent_loop`

3. **run_task_loop** — 从 task_manager 读取 pending 任务，驱动 LLM 执行
   - Core 方案：用 `agent_loop` 替换 `agent.chat_with_tools`，事件输出相同

---

#### 步骤四：迁移收尾设施

**目标**：处理日志、会话管理、交互式继续循环。

- **session 日志**：当前 `AiAgent::new` 自动创建 `SessionLogger`。Core 路径需要自行创建。
- **terminal.log**：当前通过 `agent.session_id()` 获取路径。Core 路径需要自行生成 session ID。
- **交互式继续**：当前每次循环用 `agent.chat_with_tools()`。Core 路径用 `agent_loop()` + 消息累积。

## 3. 增量实施计划

建议分 3 个 PR 完成迁移：

### PR 1：配置提取 + Core 路径骨架

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/commands/config_resolver.rs` | 新建 | `resolve_llm_config()` 函数 |
| `src/commands/core_run.rs` | 新建 | `cmd_run_core()` 函数（仅 Base 模式） |
| `src/commands/mod.rs` | 修改 | 注册新模块 |
| `src/cli.rs` | 修改 | 新增 `--use-core` 标志或 `core-run` 子命令 |

**验收标准**：
- `zapmyco core-run "hello"` 能正常输出 AI 回复
- `zapmyco run "hello"` 行为不变
- 所有测试通过

### PR 2：Plan 模式迁移

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/commands/core_run.rs` | 修改 | 添加 Plan 模式逻辑 |
| `src/commands/run.rs` | — | 不动 |

**验收标准**：
- `zapmyco core-run --plan "task"` 能走完 Plan 模式
- 方案审批、反馈循环正常

### PR 3：收尾设施 + 旧路径切换

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/commands/core_run.rs` | 修改 | 日志、session、交互式继续 |
| `src/commands/run.rs` | 修改 | 默认切换到 Core 路径 |
| `src/cli.rs` | 修改 | 移除 `--use-core`，改 `--legacy` |

**验收标准**：
- `zapmyco run "hello"` 默认使用 Core 路径
- `zapmyco run --legacy "hello"` 使用旧路径
- 所有测试通过

## 4. 风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| 配置解析差异导致行为不同 | 中 | 提取 resolver 后新旧路径共用，消除差异 |
| Plan 模式审批循环复杂 | 高 | 保持在旧路径不变，Core 路径先只做 Base 模式 |
| run_task_loop 深度耦合 AiAgent | 高 | 第一阶段不迁移 task loop，留在旧路径 |
| 日志/会话管理缺失 | 中 | Core 路径初期不做日志，仅输出到终端 |

## 5. 第一阶段（PR 1）详细任务

```
1. 创建 src/commands/config_resolver.rs
   └── resolve_llm_config() → 返回 (model, api_key, base_url, max_tokens)

2. 创建 src/commands/core_run.rs
   ├── cmd_run_core() → Base 模式
   │   ├── 调用 resolve_llm_config()
   │   ├── 构建 tool handlers（复用现有代码）
   │   ├── from_tool_handlers() → Vec<Box<dyn AgentTool>>
   │   ├── 构建 AgentConfig
   │   ├── 创建事件通道
   │   ├── 启动 event handler 任务
   │   ├── agent_loop()
   │   └── 输出结果
   └── core_event_handler() — 终端渲染

3. 修改 src/cli.rs
   └── 新增子命令或 --use-core 标志

4. 修改 src/commands/mod.rs
   └── 注册 core_run 模块

5. 测试
   ├── 单元测试（config_resolver）
   ├── 单元测试（core_run 工具构建）
   └── 手动验证（跑通一次真实对话）
```
