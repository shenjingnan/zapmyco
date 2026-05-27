// Phase 2 将使用以下函数和类型，暂时允许 dead_code
#![allow(dead_code)]

/// Settings - ~/.zapmyco/settings.json 配置管理
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const SETTINGS_RELATIVE_PATH: &str = ".zapmyco/settings.json";

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
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(SETTINGS_RELATIVE_PATH)
}

/// 获取设置目录路径
pub fn get_settings_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".zapmyco")
}

/// 旧版 LLM 配置格式
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyLlmSettings {
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
}

/// 检测是否为旧版格式（要求 apiKey 或 model 为字符串类型）
fn is_legacy_format(value: &serde_json::Value) -> bool {
    if let Some(obj) = value.as_object() {
        return obj.get("apiKey").and_then(|v| v.as_str()).is_some()
            || obj.get("model").and_then(|v| v.as_str()).is_some();
    }
    false
}

/// 将旧版格式转换为新版格式
fn convert_legacy_settings(legacy: LegacyLlmSettings) -> LlmSettings {
    let mut providers = std::collections::HashMap::new();
    providers.insert(
        "default".to_string(),
        ProviderConfig {
            api_key: legacy.api_key,
        },
    );

    let mut models = std::collections::HashMap::new();
    models.insert(
        "default".to_string(),
        legacy
            .model
            .unwrap_or_else(|| "deepseek-v4-flash".to_string()),
    );

    LlmSettings {
        providers: Some(providers),
        models: Some(models),
    }
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

/// 加载 ~/.zapmyco/settings.json
///
/// 文件不存在时返回 None，不报错。
/// 自动兼容旧版格式。
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

    let parsed: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("JSON 格式错误: {}", e))?;

    let llm_raw = parsed.get("llm");
    let llm_raw = match llm_raw {
        Some(v) if v.is_object() => v,
        _ => {
            return Ok(Some(Settings { llm: None }));
        }
    };

    // 兼容旧版格式
    if is_legacy_format(llm_raw) {
        let legacy: LegacyLlmSettings = serde_json::from_value(llm_raw.clone())
            .map_err(|e| format!("解析旧版配置失败: {}", e))?;
        return Ok(Some(Settings {
            llm: Some(convert_legacy_settings(legacy)),
        }));
    }

    // 新版格式
    let providers: std::collections::HashMap<String, ProviderConfig> = llm_raw
        .get("providers")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(name, cfg)| {
                    let api_key = cfg.get("apiKey").and_then(|v| v.as_str()).map(String::from);
                    cfg.as_object()
                        .map(|_| (name.clone(), ProviderConfig { api_key }))
                })
                .collect()
        })
        .unwrap_or_default();

    let models: std::collections::HashMap<String, String> = llm_raw
        .get("models")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(name, model_name)| {
                    model_name.as_str().map(|m| (name.clone(), m.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(Some(Settings {
        llm: Some(LlmSettings {
            providers: if providers.is_empty() {
                None
            } else {
                Some(providers)
            },
            models: if models.is_empty() {
                None
            } else {
                Some(models)
            },
        }),
    }))
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

/// 读取设置文件并返回 JSON Value
pub fn read_settings_json() -> Result<serde_json::Value, String> {
    let file_path = get_settings_path();
    let content = std::fs::read_to_string(&file_path).map_err(|_| {
        format!(
            "{} 不存在。请运行 `zapmyco init` 创建。",
            file_path.display()
        )
    })?;
    serde_json::from_str(&content).map_err(|_| "JSON 格式错误。".to_string())
}

/// 脱敏设置文件内容中的 apiKey
fn mask_settings_json(value: &mut serde_json::Value) {
    if let Some(llm) = value.get_mut("llm").and_then(|v| v.as_object_mut()) {
        // 新版: llm.providers.<name>.apiKey
        if let Some(providers) = llm.get_mut("providers").and_then(|v| v.as_object_mut()) {
            for cfg in providers.values_mut() {
                if let Some(obj) = cfg.as_object_mut()
                    && let Some(api_key) = obj.get("apiKey").and_then(|v| v.as_str())
                {
                    let masked = mask_api_key(api_key);
                    obj.insert("apiKey".to_string(), serde_json::Value::String(masked));
                }
            }
        }

        // 旧版: llm.apiKey
        if let Some(api_key) = llm.get("apiKey").and_then(|v| v.as_str()) {
            let masked = mask_api_key(api_key);
            llm.insert("apiKey".to_string(), serde_json::Value::String(masked));
        }
    }
}

/// 读取并脱敏设置文件内容
pub fn display_settings() -> Result<serde_json::Value, String> {
    let mut value = read_settings_json()?;
    mask_settings_json(&mut value);
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn with_temp_home(f: fn(&std::path::Path)) {
        let dir = tempfile::tempdir().unwrap();
        let orig_home = std::env::var("HOME").ok();
        // SAFETY: test environment isolation
        unsafe {
            std::env::set_var("HOME", dir.path());
        }
        f(dir.path());
        match orig_home {
            Some(h) => unsafe {
                std::env::set_var("HOME", h);
            },
            None => unsafe {
                std::env::remove_var("HOME");
            },
        }
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
        // SAFETY: test environment isolation
        unsafe {
            std::env::set_var("HOME", "");
        }
        let result = load_settings().unwrap();
        assert!(result.is_none());
        if let Some(h) = orig_home {
            // SAFETY: test environment isolation
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
    }

    #[test]
    fn test_load_settings_legacy_format() {
        with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            let mut file = std::fs::File::create(settings_dir.join("settings.json")).unwrap();
            file.write_all(
                br#"{"llm":{"apiKey":"test-key","baseURL":"https://test.com","model":"test-model"}}"#,
            )
            .unwrap();

            let result = load_settings().unwrap().unwrap();
            let llm = result.llm.as_ref().unwrap();
            assert_eq!(
                llm.providers
                    .as_ref()
                    .unwrap()
                    .get("default")
                    .unwrap()
                    .api_key,
                Some("test-key".to_string())
            );
            assert_eq!(
                llm.models.as_ref().unwrap().get("default").unwrap(),
                "test-model"
            );
        });
    }

    #[test]
    fn test_load_settings_partial_fields() {
        with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            let mut file = std::fs::File::create(settings_dir.join("settings.json")).unwrap();
            file.write_all(br#"{"llm":{"apiKey":"only-key"}}"#).unwrap();

            let result = load_settings().unwrap().unwrap();
            let llm = result.llm.as_ref().unwrap();
            assert_eq!(
                llm.providers
                    .as_ref()
                    .unwrap()
                    .get("default")
                    .unwrap()
                    .api_key,
                Some("only-key".to_string())
            );
            assert_eq!(
                llm.models.as_ref().unwrap().get("default").unwrap(),
                "deepseek-v4-flash"
            );
        });
    }

    #[test]
    fn test_load_settings_empty_llm() {
        with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            let mut file = std::fs::File::create(settings_dir.join("settings.json")).unwrap();
            file.write_all(br#"{"llm":{}}"#).unwrap();

            let result = load_settings().unwrap().unwrap();
            assert!(result.llm.as_ref().unwrap().providers.is_none());
            assert!(result.llm.as_ref().unwrap().models.is_none());
        });
    }

    #[test]
    fn test_load_settings_llm_not_object() {
        with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            let mut file = std::fs::File::create(settings_dir.join("settings.json")).unwrap();
            file.write_all(br#"{"llm":123}"#).unwrap();

            let result = load_settings().unwrap().unwrap();
            assert!(result.llm.is_none());
        });
    }

    #[test]
    fn test_load_settings_new_format() {
        with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            let mut file = std::fs::File::create(settings_dir.join("settings.json")).unwrap();
            file.write_all(
                br#"{"llm":{"providers":{"deepseek":{"apiKey":"ds-key"},"glm":{"apiKey":"${env.GLM_KEY}"}},"models":{"default":"deepseek-v4-flash","advanced":"deepseek-reasoner"}}}"#,
            )
            .unwrap();

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
    fn test_mask_api_key_long() {
        // len=22, first 3="sk-", last 4="test"
        assert_eq!(mask_api_key("sk-long-key-value-test"), "sk-***test");
    }

    #[test]
    fn test_mask_api_key_short() {
        // len <= 8: first 3 + "***"
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
    fn test_load_settings_invalid_json() {
        with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.json"), "{invalid}").unwrap();

            let result = load_settings();
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("JSON 格式错误"));
        });
    }

    #[test]
    fn test_load_settings_unknown_fields() {
        with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.json"),
                r#"{"llm":{"apiKey":"key","unknownField":"ignored"},"otherSection":{"foo":"bar"}}"#,
            )
            .unwrap();

            let result = load_settings().unwrap().unwrap();
            let llm = result.llm.as_ref().unwrap();
            assert_eq!(
                llm.providers
                    .as_ref()
                    .unwrap()
                    .get("default")
                    .unwrap()
                    .api_key,
                Some("key".to_string())
            );
        });
    }

    #[test]
    fn test_load_settings_skip_non_string() {
        with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.json"),
                r#"{"llm":{"apiKey":123,"baseURL":true,"model":null}}"#,
            )
            .unwrap();

            let result = load_settings().unwrap().unwrap();
            assert!(result.llm.as_ref().unwrap().providers.is_none());
            assert!(result.llm.as_ref().unwrap().models.is_none());
        });
    }
}
