//! LLM 配置解析 — 将 settings.toml + CLI 参数解析为确定的配置值。
//!
//! 这个模块提取自 `AiAgent::new()` 的配置解析逻辑，新旧路径共用。
//! 旧路径：`cmd_run()` → `AiAgent::new()`（内部自行解析）
//! 新路径：`cmd_core_run()` → `resolve_llm_config()` → `AgentConfig::new()`

use crate::config::models::get_model_info;
use crate::config::settings::load_settings;

/// 解析后的 LLM 配置（纯数据，无 I/O）
pub struct ResolvedLlmConfig {
    pub model: String,
    pub api_key: String,
    pub base_url: String,
    pub max_tokens: u32,
    pub provider_name: String,
}

const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const DEFAULT_BASE_URL: &str = "https://api.deepseek.com/anthropic";
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// 从 settings.toml 和 CLI 参数中解析最终的 LLM 配置
///
/// # 参数
/// - `profile`: 模型配置档名称（对应 settings.toml `[llm.models]` 中的 key）
/// - `model`: 直接指定的模型名（优先级最高）
/// - `api_key`: 直接指定的 API Key
/// - `base_url`: 直接指定的 base URL
///
/// # 解析顺序
///
/// **模型名称**: `options.model > profile 中的模型名 > DEFAULT_MODEL`
/// **API Key**: `options > settings.providers[provider].apiKey > 环境变量`
/// **Base URL**: `options > settings.providers[provider].base_url > 内置注册表 > DEFAULT_BASE_URL`
pub fn resolve_llm_config(
    profile: Option<&str>,
    model: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
) -> Result<ResolvedLlmConfig, String> {
    let settings = load_settings()
        .map_err(|e| format!("读取配置文件失败: {}", e))?
        .ok_or_else(|| {
            format!(
                "未找到配置文件 {}。请先运行 `zapmyco init` 初始化 LLM 配置。",
                crate::config::settings::get_settings_path().display()
            )
        })?;
    let llm = settings.llm.as_ref();

    // ── 解析模型名称 ──
    let profile_name = profile.unwrap_or("default");
    let profile_model_name = llm
        .and_then(|l| l.models.as_ref())
        .and_then(|m| m.get(profile_name))
        .map(|s| s.as_str());

    let initial_model = model
        .or(profile_model_name)
        .unwrap_or(DEFAULT_MODEL)
        .to_string();

    let model_name = initial_model;
    let model_info = get_model_info(&model_name);

    // ── 解析供应商名称 ──
    let provider_name = model_info
        .map(|i| i.provider)
        .unwrap_or("default")
        .to_string();

    // ── 解析 API Key ──
    let api_key = crate::agent::chat::resolve_api_key(api_key, llm, &provider_name)?;

    // ── 解析 Base URL ──
    let base_url = base_url
        .map(|s| s.to_string())
        .or_else(|| {
            llm.and_then(|s| {
                s.providers
                    .as_ref()
                    .and_then(|p| p.get(&provider_name))
                    .and_then(|c| c.base_url.clone())
            })
        })
        .or_else(|| model_info.map(|i| i.base_url.to_string()))
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

    // ── 解析 Max Tokens ──
    let max_tokens = model_info
        .and_then(|i| i.max_output_tokens)
        .unwrap_or(DEFAULT_MAX_TOKENS);

    Ok(ResolvedLlmConfig {
        model: model_name,
        api_key,
        base_url,
        max_tokens,
        provider_name,
    })
}

/// 获取用于 WebSearch 等工具的默认模型名（供应商的搜索模型或主模型）
pub fn get_search_model(provider_name: &str) -> &str {
    match provider_name {
        "deepseek" => "deepseek-v4-flash",
        "anthropic" => "claude-sonnet-4-6",
        _ => DEFAULT_MODEL,
    }
}

/// 获取用于内部子请求的最大 tokens
pub fn get_internal_max_tokens(search_model: &str) -> u32 {
    get_model_info(search_model)
        .and_then(|i| i.max_output_tokens)
        .unwrap_or(DEFAULT_MAX_TOKENS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;

    #[test]
    fn test_resolve_no_settings() {
        run_with_temp_home(|_home| {
            let result = resolve_llm_config(None, None, Some("key"), Some("https://test.com"));
            assert!(result.is_err(), "无 settings.toml 时应报错");
        });
    }

    #[test]
    fn test_resolve_with_minimal_settings() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "[llm]\n").unwrap();

            let result = resolve_llm_config(
                None,
                Some("deepseek-v4-flash"),
                Some("sk-test-key"),
                Some("https://api.test.com"),
            );
            assert!(result.is_ok());
            let cfg = result.unwrap();
            assert_eq!(cfg.model, "deepseek-v4-flash");
            assert_eq!(cfg.api_key, "sk-test-key");
            assert_eq!(cfg.base_url, "https://api.test.com");
        });
    }

    #[test]
    fn test_resolve_uses_profile_model() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                r#"[llm.models]
my-profile = "deepseek-v4-flash"
"#,
            )
            .unwrap();

            let result = resolve_llm_config(
                Some("my-profile"),
                None,
                Some("sk-key"),
                Some("https://test.com"),
            );
            assert!(result.is_ok());
            let cfg = result.unwrap();
            assert_eq!(cfg.model, "deepseek-v4-flash");
        });
    }

    #[test]
    fn test_resolve_provider_name() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "[llm]\n").unwrap();

            let cfg = resolve_llm_config(
                None,
                Some("deepseek-v4-flash"),
                Some("sk-key"),
                Some("https://test.com"),
            )
            .unwrap();
            assert_eq!(cfg.provider_name, "deepseek");
        });
    }

    #[test]
    fn test_search_model() {
        let model = get_search_model("deepseek");
        assert!(!model.is_empty());
    }
}
