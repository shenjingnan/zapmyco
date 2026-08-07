# zapmyco-providers

<p align="center">
  <a href="https://crates.io/crates/zapmyco-providers"><img src="https://img.shields.io/crates/v/zapmyco-providers.svg?color=brightgreen" alt="crates.io"></a>
  <a href="https://docs.rs/zapmyco-providers"><img src="https://docs.rs/zapmyco-providers/badge.svg" alt="docs.rs"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-brightgreen.svg" alt="License: MIT"></a>
</p>

内置模型注册表、供应商元数据与 LLM 配置解析 —— 供应商中立的"模型目录"。

`zapmyco-providers` 是 [zapmyco](https://github.com/shenjingnan/zapmyco) 的供应商/模型层，为 `zapmyco-core` 与 `zapmyco-tools` 组装的 agent 提供模型目录与配置解析能力。所有供应商（DeepSeek / GLM / Anthropic / MiniMax / Kimi / Doubao / Qwen / MIMO）均提供 Anthropic Messages API 兼容端点，差异仅在于 `base_url` 与 `api_key`，本 crate 将这部分"供应商知识"集中管理。

## 特性

- **模型注册表**：22 个内置模型的元信息（供应商归属、baseURL、能力、上下文窗口）
- **供应商元数据**：`ProviderMeta` 表（显示名、默认搜索模型、环境变量约定、API 版本）
- **纯函数配置解析**：`resolve_llm_config` / `resolve_api_key`，settings 由调用方注入，零文件 I/O
- **超轻量**：仅依赖 `serde`，无 tokio / reqwest，可嵌入任意环境

## 快速开始

```toml
[dependencies]
zapmyco-providers = "0.1"
```

```rust
use zapmyco_providers::{LlmSettings, ResolvedLlmConfig, get_model_info, resolve_llm_config};

// 查询内置模型元信息
let info = get_model_info("deepseek-v4-flash").unwrap();
assert_eq!(info.provider, "deepseek");

// 供应商元数据
let meta = zapmyco_providers::provider_meta("anthropic").unwrap();
assert_eq!(meta.display_name, "Anthropic");

// 纯函数配置解析（settings 由调用方注入，零文件 I/O）
let llm = LlmSettings { providers: None, models: None };
let resolved: ResolvedLlmConfig =
    resolve_llm_config(Some(&llm), None, Some("deepseek-v4-flash"), Some("sk-xxx"), None).unwrap();
assert_eq!(resolved.provider_name, "deepseek");
```

## 相关链接

- [crates.io / zapmyco-providers](https://crates.io/crates/zapmyco-providers)
- [docs.rs / zapmyco-providers](https://docs.rs/zapmyco-providers)
- [GitHub 源码](https://github.com/shenjingnan/zapmyco/tree/main/crates/zapmyco-providers)
