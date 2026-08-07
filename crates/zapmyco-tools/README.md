# zapmyco-tools

<p align="center">
  <a href="https://crates.io/crates/zapmyco-tools"><img src="https://img.shields.io/crates/v/zapmyco-tools.svg?color=brightgreen" alt="crates.io"></a>
  <a href="https://docs.rs/zapmyco-tools"><img src="https://docs.rs/zapmyco-tools/badge.svg" alt="docs.rs"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-brightgreen.svg" alt="License: MIT"></a>
</p>

可复用的 `AgentTool` 实现集 —— 文件、搜索、Web、任务、shell、子代理与 skill 工具。

`zapmyco-tools` 是 [zapmyco](https://github.com/shenjingnan/zapmyco) 的工具实现层，配合 [`zapmyco-core`](https://crates.io/crates/zapmyco-core) 组装完整 agent：core 提供引擎（ReAct 循环 / 工具抽象 / 事件流），tools 提供开箱即用的工具实现。

## 特性

- **完整工具集**：文件读写编辑、正则搜索、路径查找、Web 抓取与搜索、任务管理、shell 执行、子代理、skill 加载
- **环境解耦**：终端输出、交互提示、会话日志、白名单持久化、skill 解析均通过注入 trait 抽象，宿主自由替换
- **安全默认**：未注入交互后端时确认/提问自动拒绝，适合无人值守场景
- **纯 Rust 实现**：基于 `zapmyco-core` 的 `AgentTool` trait，零主 crate 依赖

## 快速开始

添加依赖：

```toml
[dependencies]
zapmyco-core = "0.1"
zapmyco-tools = "0.1"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync"] }
serde_json = "1"
async-trait = "0.1"
```

组装一个带文件与任务工具的 Agent：

```rust
use std::sync::Arc;
use tokio::sync::mpsc;
use zapmyco_core::{agent_loop, AgentConfig, AgentTool};
use zapmyco_tools::{
    file_read::FileRead, file_write::FileWrite, task_create::TaskCreate, task_list::TaskList,
    task_manager::TaskManager, ToolsContext,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let api_key = std::env::var("ZAPMYCO_API_KEY").unwrap_or_default();
    let base_url =
        std::env::var("ZAPMYCO_BASE_URL").unwrap_or_else(|_| "https://api.anthropic.com".to_string());

    let ctx = ToolsContext::default(); // 无头默认，可注入自定义后端
    let tm = Arc::new(TaskManager::new());

    let mut tools: Vec<Box<dyn AgentTool>> = vec![
        Box::new(FileRead::new(Default::default())),
        Box::new(FileWrite::new(Default::default())),
        Box::new(TaskCreate { manager: tm.clone() }),
        Box::new(TaskList { manager: tm.clone() }),
    ];

    let config = Arc::new(
        AgentConfig::new("deepseek-v4-flash", api_key, base_url)
            .with_system_prompt("你是一个能操作文件的助手")
            .with_tools(tools),
    );

    let (event_tx, mut event_rx) = mpsc::channel(256);
    tokio::spawn(async move {
        while let Some(ev) = event_rx.recv().await {
            // 渲染 AgentEvent
        }
    });

    let mut messages = vec![];
    agent_loop(config, &mut messages, "读取并总结 README.md", event_tx).await?;
    Ok(())
}
```

## 工具清单

| 类别 | 工具 |
|------|------|
| 文件 | `file_read` / `file_write` / `file_edit` / `file_find` / `file_search` |
| Web | `web_fetch` / `web_search` |
| 任务 | `task_create` / `task_get` / `task_list` / `task_update` / `task_manager` / `task_display` |
| 终端 | `shell_exec` / `ask_user` / `confirm` |
| 子代理 | `subagent` |
| Skill | `skill` |

## 环境注入

`zapmyco-tools` 通过 `ToolsContext` 将环境依赖注入到工具中。未注入时使用安全默认（no-op）：

- 输出静默、交互确认/提问自动拒绝、白名单写入成功、skill 列表为空

宿主可分别实现 `OutputEmitter` / `UserPrompt` / `SessionLogger` / `AllowlistPersister` / `SkillResolver` 五个 trait 并构造 `ToolsContext` 注入。

## 相关链接

- [crates.io / zapmyco-tools](https://crates.io/crates/zapmyco-tools)
- [docs.rs / zapmyco-tools](https://docs.rs/zapmyco-tools)
- [GitHub 源码](https://github.com/shenjingnan/zapmyco/tree/main/crates/zapmyco-tools)
