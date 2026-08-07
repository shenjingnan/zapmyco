# Changelog

## [Unreleased]

- 初始版本：内置模型注册表（22 模型 / 8 供应商）与供应商元数据表（`ProviderMeta` / `PROVIDER_METADATA`）。
- 供应商配置类型 `ProviderConfig` / `LlmSettings`（serde，camelCase）。
- 纯函数 LLM 配置解析：`resolve_llm_config` / `resolve_api_key` / `resolve_env_ref` / `get_search_model` / `get_internal_max_tokens`，settings 由调用方注入、零文件 I/O。
