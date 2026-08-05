pub mod models;
pub mod settings;

// 旧路径兼容: zapmyco::settings::* → zapmyco::config::settings::*
pub use settings::{
    LlmSettings, ProviderConfig, SessionLogSettings, Settings, display_settings, get_home_dir,
    get_settings_dir, get_settings_path, is_session_log_enabled, load_settings, resolve_env_ref,
    update_settings_model,
};

// 旧路径兼容: zapmyco::models::* → zapmyco::config::models::*
pub use models::{
    BuiltInModel, ModelCapability, get_built_in_model_names, get_model_info,
    guess_provider_from_model_name,
};

/// 解析 API Key
///
/// 优先级：命令行显式指定 > settings.toml 供应商配置（含 `${ENV}` 引用）> 环境变量。
pub fn resolve_api_key(
    explicit_key: Option<&str>,
    llm: Option<&LlmSettings>,
    provider_name: &str,
) -> Result<String, String> {
    if let Some(key) = explicit_key.filter(|k| !k.is_empty()) {
        return Ok(key.to_string());
    }

    if let Some(llm) = llm
        && let Some(providers) = &llm.providers
        && let Some(cfg) = providers.get(provider_name)
        && let Some(ref api_key) = cfg.api_key
        && !api_key.is_empty()
    {
        return resolve_env_ref(api_key);
    }

    // 回退到环境变量
    if let Ok(key) = std::env::var("DEEPSEEK_API_KEY")
        && !key.is_empty()
    {
        return Ok(key);
    }

    Err(
        "DEEPSEEK_API_KEY 未设置。请运行 `zapmyco init` 或设置环境变量 DEEPSEEK_API_KEY。"
            .to_string(),
    )
}
