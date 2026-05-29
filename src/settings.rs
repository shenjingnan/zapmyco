/// Settings - ~/.zapmyco/settings.toml 配置管理
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const SETTINGS_RELATIVE_PATH: &str = ".zapmyco/settings.toml";

/// 获取用户 home 目录（跨平台：macOS/Linux 用 $HOME，Windows 用 %USERPROFILE%）
pub fn get_home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string())
        .into()
}

/// 供应商配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    /// API 密钥，支持 ${env.VAR} 语法
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

/// LLM 配置（新格式）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettings {
    /// 供应商字典
    #[serde(skip_serializing_if = "Option::is_none")]
    pub providers: Option<std::collections::HashMap<String, ProviderConfig>>,
    /// 模型配置档字典
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<std::collections::HashMap<String, String>>,
}

/// 顶层配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm: Option<LlmSettings>,
}

/// 获取设置文件路径
pub fn get_settings_path() -> PathBuf {
    get_home_dir().join(SETTINGS_RELATIVE_PATH)
}

/// 获取设置目录路径
pub fn get_settings_dir() -> PathBuf {
    get_home_dir().join(".zapmyco")
}

/// 解析 ${env.VAR} 引用
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

/// 加载 ~/.zapmyco/settings.toml
///
/// 文件不存在时返回 None，不报错。
pub fn load_settings() -> Result<Option<Settings>, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() {
        return Ok(None);
    }

    let file_path = get_settings_path();

    let content = match std::fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Ok(None),
    };

    let settings: Settings =
        toml::from_str(&content).map_err(|e| format!("TOML 格式错误: {}", e))?;

    Ok(Some(settings))
}

/// 脱敏 API Key
fn mask_api_key(value: &str) -> String {
    // 环境变量引用原样返回
    if value.starts_with("${env.") && value.ends_with('}') {
        return value.to_string();
    }
    if value.len() <= 8 {
        let end = value.len().min(3);
        format!("{}***", &value[..end])
    } else {
        format!("{}***{}", &value[..3], &value[value.len() - 4..])
    }
}

impl Settings {
    /// 返回 API Key 已脱敏的副本（用于显示）
    pub fn masked(&self) -> Self {
        let llm = self.llm.as_ref().map(|llm| LlmSettings {
            providers: llm.providers.as_ref().map(|providers| {
                providers
                    .iter()
                    .map(|(name, cfg)| {
                        (
                            name.clone(),
                            ProviderConfig {
                                api_key: cfg.api_key.as_ref().map(|key| mask_api_key(key)),
                            },
                        )
                    })
                    .collect()
            }),
            models: llm.models.clone(),
        });
        Settings { llm }
    }
}

/// 读取设置文件并返回脱敏后的 TOML 字符串
pub fn display_settings() -> Result<String, String> {
    let settings = load_settings()?.ok_or_else(|| {
        format!(
            "{} 不存在。请运行 `zapmyco init` 创建。",
            get_settings_path().display()
        )
    })?;
    let masked = settings.masked();
    toml::to_string(&masked).map_err(|e| format!("序列化配置失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;
    use std::collections::HashMap;

    fn with_temp_home(f: fn(&std::path::Path)) {
        run_with_temp_home(f);
    }

    fn write_toml_settings(home: &std::path::Path, content: &str) {
        let settings_dir = home.join(".zapmyco");
        std::fs::create_dir_all(&settings_dir).unwrap();
        std::fs::write(settings_dir.join("settings.toml"), content).unwrap();
    }

    #[test]
    fn test_resolve_env_ref_plain_value() {
        assert_eq!(resolve_env_ref("sk-test-key").unwrap(), "sk-test-key");
        assert_eq!(
            resolve_env_ref("https://example.com").unwrap(),
            "https://example.com"
        );
    }

    #[test]
    fn test_resolve_env_ref_from_env() {
        // SAFETY: test environment isolation
        unsafe {
            std::env::set_var("TEST_MY_VAR", "test-resolved-value");
        }
        assert_eq!(
            resolve_env_ref("${env.TEST_MY_VAR}").unwrap(),
            "test-resolved-value"
        );
        // SAFETY: test environment isolation
        unsafe {
            std::env::remove_var("TEST_MY_VAR");
        }
    }

    #[test]
    fn test_resolve_env_ref_missing_var() {
        let result = resolve_env_ref("${env.NONEXISTENT_VAR_XYZ}");
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("NONEXISTENT_VAR_XYZ"));
    }

    #[test]
    fn test_resolve_env_ref_without_env_prefix() {
        assert_eq!(resolve_env_ref("${SOME_VAR}").unwrap(), "${SOME_VAR}");
    }

    #[test]
    fn test_load_settings_file_not_found() {
        with_temp_home(|_| {
            let result = load_settings().unwrap();
            assert!(result.is_none());
        });
    }

    #[test]
    fn test_load_settings_home_not_set() {
        let orig_home = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", "");
        }
        let result = load_settings().unwrap();
        assert!(result.is_none());
        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
    }

    #[test]
    fn test_load_settings_empty_llm() {
        with_temp_home(|home| {
            write_toml_settings(home, "[llm]\n");
            let result = load_settings().unwrap().unwrap();
            assert!(result.llm.as_ref().unwrap().providers.is_none());
            assert!(result.llm.as_ref().unwrap().models.is_none());
        });
    }

    #[test]
    fn test_load_settings_full() {
        with_temp_home(|home| {
            write_toml_settings(
                home,
                r#"[llm]

[llm.providers.deepseek]
apiKey = "ds-key"

[llm.providers.glm]
apiKey = "${env.GLM_KEY}"

[llm.models]
default = "deepseek-v4-flash"
advanced = "deepseek-reasoner"
"#,
            );

            let result = load_settings().unwrap().unwrap();
            let llm = result.llm.as_ref().unwrap();
            assert_eq!(
                llm.providers
                    .as_ref()
                    .unwrap()
                    .get("deepseek")
                    .unwrap()
                    .api_key,
                Some("ds-key".to_string())
            );
            assert_eq!(
                llm.providers.as_ref().unwrap().get("glm").unwrap().api_key,
                Some("${env.GLM_KEY}".to_string())
            );
            assert_eq!(
                llm.models.as_ref().unwrap().get("default").unwrap(),
                "deepseek-v4-flash"
            );
            assert_eq!(
                llm.models.as_ref().unwrap().get("advanced").unwrap(),
                "deepseek-reasoner"
            );
        });
    }

    #[test]
    fn test_load_settings_providers_only() {
        with_temp_home(|home| {
            write_toml_settings(
                home,
                "[llm]\n\n[llm.providers.deepseek]\napiKey = \"key\"\n",
            );

            let result = load_settings().unwrap().unwrap();
            let llm = result.llm.unwrap();
            assert!(llm.providers.is_some());
            assert!(llm.models.is_none());
        });
    }

    #[test]
    fn test_load_settings_models_only() {
        with_temp_home(|home| {
            write_toml_settings(
                home,
                "[llm]\n\n[llm.models]\ndefault = \"deepseek-v4-flash\"\n",
            );

            let result = load_settings().unwrap().unwrap();
            let llm = result.llm.unwrap();
            assert!(llm.providers.is_none());
            assert!(llm.models.is_some());
        });
    }

    #[test]
    fn test_load_settings_invalid_toml() {
        with_temp_home(|home| {
            write_toml_settings(home, "{invalid}");

            let result = load_settings();
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("TOML 格式错误"));
        });
    }

    #[test]
    fn test_load_settings_no_llm_field() {
        with_temp_home(|home| {
            write_toml_settings(home, "[other]\nfoo = \"bar\"\n");

            let result = load_settings().unwrap().unwrap();
            assert!(result.llm.is_none());
        });
    }

    #[test]
    fn test_mask_api_key_long() {
        assert_eq!(mask_api_key("sk-long-key-value-test"), "sk-***test");
    }

    #[test]
    fn test_mask_api_key_short() {
        assert_eq!(mask_api_key("short"), "sho***");
    }

    #[test]
    fn test_mask_api_key_env_ref() {
        assert_eq!(
            mask_api_key("${env.DEEPSEEK_API_KEY}"),
            "${env.DEEPSEEK_API_KEY}"
        );
    }

    #[test]
    fn test_mask_api_key_4_chars() {
        assert_eq!(mask_api_key("abcd"), "abc***");
    }

    #[test]
    fn test_mask_api_key_empty() {
        assert_eq!(mask_api_key(""), "***");
    }

    #[test]
    fn test_mask_api_key_exactly_8_chars() {
        assert_eq!(mask_api_key("12345678"), "123***");
    }

    #[test]
    fn test_mask_api_key_3_chars() {
        assert_eq!(mask_api_key("abc"), "abc***");
    }

    #[test]
    fn test_get_settings_dir() {
        with_temp_home(|home| {
            let dir = get_settings_dir();
            assert_eq!(dir, home.join(".zapmyco"));
        });
    }

    #[test]
    fn test_get_settings_path_format() {
        with_temp_home(|home| {
            let path = get_settings_path();
            assert_eq!(path, home.join(".zapmyco/settings.toml"));
        });
    }

    #[test]
    fn test_get_settings_path_home_not_set() {
        let orig_home = std::env::var("HOME").ok();
        let orig_userprofile = std::env::var("USERPROFILE").ok();
        unsafe {
            std::env::remove_var("HOME");
            std::env::remove_var("USERPROFILE");
        }
        let path = get_settings_path();
        assert_eq!(path, std::path::PathBuf::from("./.zapmyco/settings.toml"));
        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
        if let Some(up) = orig_userprofile {
            unsafe {
                std::env::set_var("USERPROFILE", up);
            }
        }
    }

    #[test]
    fn test_get_settings_dir_home_not_set() {
        let orig_home = std::env::var("HOME").ok();
        let orig_userprofile = std::env::var("USERPROFILE").ok();
        unsafe {
            std::env::remove_var("HOME");
            std::env::remove_var("USERPROFILE");
        }
        let dir = get_settings_dir();
        assert_eq!(dir, std::path::PathBuf::from("./.zapmyco"));
        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
        if let Some(up) = orig_userprofile {
            unsafe {
                std::env::set_var("USERPROFILE", up);
            }
        }
    }

    #[test]
    fn test_display_settings_masked() {
        with_temp_home(|home| {
            write_toml_settings(
                home,
                "[llm]\n\n[llm.providers.deepseek]\napiKey = \"sk-test-1234\"\n",
            );

            let result = display_settings().unwrap();
            // TOML output should contain masked key
            assert!(!result.contains("sk-test-1234"));
            assert!(result.contains("sk-***1234"));
        });
    }

    #[test]
    fn test_display_settings_missing_file() {
        with_temp_home(|_home| {
            let result = display_settings();
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("不存在"));
        });
    }

    #[test]
    fn test_load_settings_read_error() {
        with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            let file_path = settings_dir.join("settings.toml");
            std::fs::create_dir_all(&file_path).unwrap();
            let result = load_settings();
            assert!(result.is_ok());
            assert!(result.unwrap().is_none());
        });
    }

    #[test]
    fn test_resolve_env_ref_empty() {
        assert_eq!(resolve_env_ref("").unwrap(), "");
    }

    #[test]
    fn test_resolve_env_ref_incomplete_prefix() {
        let result = resolve_env_ref("${env.}");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_env_ref_no_closing_brace() {
        assert_eq!(resolve_env_ref("${env.MY_VAR").unwrap(), "${env.MY_VAR");
    }

    #[test]
    fn test_resolve_env_ref_no_env_prefix() {
        assert_eq!(resolve_env_ref("${}").unwrap(), "${}");
    }

    #[test]
    fn test_resolve_env_ref_empty_env_var_name() {
        let result = resolve_env_ref("${env.}");
        assert!(result.is_err());
    }

    #[test]
    fn test_masked_preserves_models() {
        let settings = Settings {
            llm: Some(LlmSettings {
                providers: None,
                models: Some(HashMap::from([(
                    "default".to_string(),
                    "deepseek-v4-flash".to_string(),
                )])),
            }),
        };
        let masked = settings.masked();
        assert_eq!(
            masked
                .llm
                .as_ref()
                .unwrap()
                .models
                .as_ref()
                .unwrap()
                .get("default")
                .unwrap(),
            "deepseek-v4-flash"
        );
    }

    #[test]
    fn test_masked_masks_api_key() {
        let settings = Settings {
            llm: Some(LlmSettings {
                providers: Some(HashMap::from([(
                    "deepseek".to_string(),
                    ProviderConfig {
                        api_key: Some("sk-secret-key-value".to_string()),
                    },
                )])),
                models: None,
            }),
        };
        let masked = settings.masked();
        assert_eq!(
            masked
                .llm
                .as_ref()
                .unwrap()
                .providers
                .as_ref()
                .unwrap()
                .get("deepseek")
                .unwrap()
                .api_key,
            Some("sk-***alue".to_string())
        );
    }

    #[test]
    fn test_masked_no_llm() {
        let settings = Settings { llm: None };
        let masked = settings.masked();
        assert!(masked.llm.is_none());
    }
}
