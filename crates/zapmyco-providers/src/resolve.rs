//! LLM 配置解析 —— 纯函数，settings 由调用方注入，零文件 I/O。
//!
//! 提取自主 crate 的 `config_resolver.rs` 与 `config/mod.rs`：
//! 文件读取（`load_settings`）与错误文案留在宿主，本模块只做纯路由。

use crate::models::get_model_info;
use crate::providers::LlmSettings;

/// 设置文件相对路径（`resolve_env_ref` 错误提示用）
const SETTINGS_RELATIVE_PATH: &str = ".zapmyco/settings.toml";

const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const DEFAULT_BASE_URL: &str = "https://api.deepseek.com/anthropic";
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// 解析后的 LLM 配置（纯数据，无 I/O）
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedLlmConfig {
    pub model: String,
    pub api_key: String,
    pub base_url: String,
    pub max_tokens: u32,
    pub provider_name: String,
}

/// 解析 `${env.VAR}` 引用
///
/// - "${env.DEEPSEEK_API_KEY}" → 从环境变量 DEEPSEEK_API_KEY 读取
/// - "sk-xxx" → 原样返回
pub fn resolve_env_ref(value: &str) -> Result<String, String> {
    if let Some(captures) = value
        .strip_prefix("${env.")
        .and_then(|s| s.strip_suffix('}'))
    {
        let env_var = captures;
        match std::env::var(env_var) {
            Ok(resolved) => Ok(resolved),
            Err(_) => Err(format!(
                "环境变量 {} 未设置。请在 {} 中配置或设置环境变量 {}。",
                env_var, SETTINGS_RELATIVE_PATH, env_var
            )),
        }
    } else {
        Ok(value.to_string())
    }
}

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

/// 从 LLM 配置与 CLI 参数中解析最终的 LLM 配置（纯函数，零文件 I/O）
///
/// # 参数
/// - `llm`: settings.toml 的 `[llm]` 配置（由调用方加载后传入，`None` 表示无配置）
/// - `profile`: 模型配置档名称（对应 `[llm.models]` 中的 key）
/// - `model`: 直接指定的模型名（优先级最高）
/// - `api_key`: 直接指定的 API Key
/// - `base_url`: 直接指定的 base URL
///
/// # 解析顺序
///
/// **模型名称**: `model > profile 中的模型名 > DEFAULT_MODEL`
/// **API Key**: `api_key > settings.providers[provider].apiKey > 环境变量`
/// **Base URL**: `base_url > settings.providers[provider].base_url > 内置注册表 > DEFAULT_BASE_URL`
pub fn resolve_llm_config(
    llm: Option<&LlmSettings>,
    profile: Option<&str>,
    model: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
) -> Result<ResolvedLlmConfig, String> {
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
    let api_key = resolve_api_key(api_key, llm, &provider_name)?;

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
    use crate::providers::ProviderConfig;
    use std::collections::HashMap;

    /// 设置临时环境变量，测试结束后恢复原值
    fn with_env_var(key: &str, value: Option<&str>, f: impl FnOnce()) {
        let orig = std::env::var(key).ok();
        match value {
            Some(v) => unsafe { std::env::set_var(key, v) },
            None => unsafe { std::env::remove_var(key) },
        }
        f();
        match orig {
            Some(v) => unsafe { std::env::set_var(key, v) },
            None => unsafe { std::env::remove_var(key) },
        }
    }

    #[test]
    fn test_resolve_env_ref_literal() {
        assert_eq!(resolve_env_ref("sk-xxx").unwrap(), "sk-xxx");
        assert_eq!(resolve_env_ref("").unwrap(), "");
    }

    #[test]
    fn test_resolve_env_ref_env_var() {
        with_env_var("ZAPMYCO_TEST_ENV_REF", Some("secret"), || {
            assert_eq!(
                resolve_env_ref("${env.ZAPMYCO_TEST_ENV_REF}").unwrap(),
                "secret"
            );
        });
    }

    #[test]
    fn test_resolve_env_ref_missing() {
        let err = resolve_env_ref("${env.ZAPMYCO_TEST_UNDEFINED_XYZ}").unwrap_err();
        assert!(err.contains("ZAPMYCO_TEST_UNDEFINED_XYZ"));
    }

    #[test]
    fn test_resolve_env_ref_malformed() {
        assert_eq!(resolve_env_ref("${env.").unwrap(), "${env.");
        assert_eq!(resolve_env_ref("${env}").unwrap(), "${env}");
    }

    fn make_llm(providers: HashMap<String, ProviderConfig>) -> LlmSettings {
        LlmSettings {
            providers: Some(providers),
            models: None,
        }
    }

    #[test]
    fn test_resolve_api_key_explicit_wins() {
        let llm = make_llm(HashMap::from([(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: Some("settings-key".to_string()),
                base_url: None,
            },
        )]));
        let key = resolve_api_key(Some("explicit-key"), Some(&llm), "deepseek").unwrap();
        assert_eq!(key, "explicit-key");
    }

    #[test]
    fn test_resolve_api_key_from_settings() {
        let llm = make_llm(HashMap::from([(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: Some("settings-key".to_string()),
                base_url: None,
            },
        )]));
        let key = resolve_api_key(None, Some(&llm), "deepseek").unwrap();
        assert_eq!(key, "settings-key");
    }

    #[test]
    fn test_resolve_api_key_from_settings_env_ref() {
        with_env_var("ZAPMYCO_TEST_SETTINGS_KEY", Some("env-resolved"), || {
            let llm = make_llm(HashMap::from([(
                "deepseek".to_string(),
                ProviderConfig {
                    api_key: Some("${env.ZAPMYCO_TEST_SETTINGS_KEY}".to_string()),
                    base_url: None,
                },
            )]));
            let key = resolve_api_key(None, Some(&llm), "deepseek").unwrap();
            assert_eq!(key, "env-resolved");
        });
    }

    #[test]
    fn test_resolve_api_key_env_fallback() {
        with_env_var("DEEPSEEK_API_KEY", Some("env-fallback"), || {
            let key = resolve_api_key(None, None, "deepseek").unwrap();
            assert_eq!(key, "env-fallback");
        });
    }

    #[test]
    fn test_resolve_api_key_error() {
        with_env_var("DEEPSEEK_API_KEY", None, || {
            let err = resolve_api_key(None, None, "deepseek").unwrap_err();
            assert!(err.contains("DEEPSEEK_API_KEY 未设置"));
        });
    }

    #[test]
    fn test_resolve_llm_config_basic() {
        let resolved =
            resolve_llm_config(None, None, Some("deepseek-v4-flash"), Some("sk-key"), None)
                .unwrap();
        assert_eq!(resolved.model, "deepseek-v4-flash");
        assert_eq!(resolved.provider_name, "deepseek");
        assert_eq!(resolved.api_key, "sk-key");
        assert_eq!(resolved.base_url, "https://api.deepseek.com/anthropic");
        assert_eq!(resolved.max_tokens, 384_000);
    }

    #[test]
    fn test_resolve_llm_config_profile_model() {
        let mut models = HashMap::new();
        models.insert("my-profile".to_string(), "glm-5v-turbo".to_string());
        let llm = LlmSettings {
            providers: None,
            models: Some(models),
        };
        let resolved =
            resolve_llm_config(Some(&llm), Some("my-profile"), None, Some("sk-key"), None).unwrap();
        assert_eq!(resolved.model, "glm-5v-turbo");
        assert_eq!(resolved.provider_name, "glm");
    }

    #[test]
    fn test_resolve_llm_config_provider_base_url_override() {
        let llm = make_llm(HashMap::from([(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: Some("sk-key".to_string()),
                base_url: Some("https://custom.example.com".to_string()),
            },
        )]));
        let resolved =
            resolve_llm_config(Some(&llm), None, Some("deepseek-v4-flash"), None, None).unwrap();
        assert_eq!(resolved.base_url, "https://custom.example.com");
        assert_eq!(resolved.api_key, "sk-key");
    }

    #[test]
    fn test_resolve_llm_config_explicit_base_url_wins() {
        let llm = make_llm(HashMap::from([(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: Some("sk-key".to_string()),
                base_url: Some("https://settings.example.com".to_string()),
            },
        )]));
        let resolved = resolve_llm_config(
            Some(&llm),
            None,
            Some("deepseek-v4-flash"),
            None,
            Some("https://cli.example.com"),
        )
        .unwrap();
        assert_eq!(resolved.base_url, "https://cli.example.com");
    }

    #[test]
    fn test_resolve_llm_config_unknown_model_default_provider() {
        let resolved =
            resolve_llm_config(None, None, Some("some-random-model"), Some("sk-key"), None)
                .unwrap();
        assert_eq!(resolved.provider_name, "default");
        assert_eq!(resolved.base_url, DEFAULT_BASE_URL);
        assert_eq!(resolved.max_tokens, DEFAULT_MAX_TOKENS);
    }

    #[test]
    fn test_resolve_llm_config_requires_api_key() {
        with_env_var("DEEPSEEK_API_KEY", None, || {
            let err =
                resolve_llm_config(None, None, Some("deepseek-v4-flash"), None, None).unwrap_err();
            assert!(err.contains("DEEPSEEK_API_KEY 未设置"));
        });
    }

    #[test]
    fn test_get_search_model() {
        assert_eq!(get_search_model("deepseek"), "deepseek-v4-flash");
        assert_eq!(get_search_model("anthropic"), "claude-sonnet-4-6");
        assert_eq!(get_search_model("glm"), DEFAULT_MODEL);
        assert_eq!(get_search_model("custom"), DEFAULT_MODEL);
    }

    #[test]
    fn test_get_internal_max_tokens() {
        assert_eq!(
            get_internal_max_tokens("deepseek-v4-flash"),
            384_000,
            "deepseek-v4-flash 的 max_output_tokens 应为 384K"
        );
        assert_eq!(get_internal_max_tokens("unknown-model"), DEFAULT_MAX_TOKENS);
    }
}
