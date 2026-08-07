//! LLM 配置解析 — 将 settings.toml + CLI 参数解析为确定的配置值。
//!
//! 解析逻辑已迁移至独立 crate `zapmyco-providers`，本模块保留文件 I/O
//! （`load_settings`）与旧路径兼容门面。

use crate::config::settings::load_settings;

pub use zapmyco_providers::resolve::{
    ResolvedLlmConfig, get_internal_max_tokens, get_search_model,
};

/// 从 settings.toml 和 CLI 参数中解析最终的 LLM 配置
///
/// 文件 I/O 层：读取 settings.toml 后委托给
/// `zapmyco_providers::resolve::resolve_llm_config` 完成纯解析。
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
    zapmyco_providers::resolve::resolve_llm_config(llm, profile, model, api_key, base_url)
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
