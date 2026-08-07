//! # zapmyco-providers
//!
//! 内置模型注册表、供应商元数据与 LLM 配置解析 —— 供应商中立的"模型目录"。
//!
//! 配合 `zapmyco-core` / `zapmyco-tools` 组装 agent 时，本 crate 提供模型目录
//! 与纯函数配置解析；所有供应商均走 Anthropic Messages API 兼容通道，
//! 供应商差异（base_url / api_key）由此集中管理。

pub mod models;
pub mod providers;
pub mod resolve;

// 便捷重导出
pub use models::{
    BuiltInModel, ModelCapability, format_model_help, get_built_in_base_host_info,
    get_built_in_base_hosts, get_built_in_base_urls, get_built_in_model_names, get_model_info,
    guess_provider_from_model_name,
};
pub use providers::{
    LlmSettings, PROVIDER_METADATA, ProviderConfig, ProviderMeta, all_provider_names, provider_meta,
};
pub use resolve::{
    ResolvedLlmConfig, get_internal_max_tokens, get_search_model, resolve_api_key, resolve_env_ref,
    resolve_llm_config,
};
