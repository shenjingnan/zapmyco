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
    /// API 基础地址（可选），覆盖内置模型注册表中的 base_url
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
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

/// 对话日志配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogSettings {
    /// 是否启用对话日志（默认 true）
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Session 日志级别：info / debug / trace（默认 info，通过 ZAPMYCO_LOG 环境变量控制）
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

fn default_enabled() -> bool {
    true
}

fn default_log_level() -> String {
    "info".to_string()
}

/// 权限配置
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    /// 命令权限（白名单/黑名单）
    #[serde(default)]
    pub commands: CommandPermissions,
    // 未来扩展：
    // pub domains: DomainPermissions,
    // pub paths: PathPermissions,
}

/// 命令权限：白名单（allow）和黑名单（deny）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandPermissions {
    /// 自动放行的命令前缀列表
    #[serde(default)]
    pub allow: Vec<String>,
    /// 自动拒绝的命令前缀列表（优先于 allow）
    #[serde(default)]
    pub deny: Vec<String>,
}

/// 顶层配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm: Option<LlmSettings>,
    /// 对话日志配置
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_log: Option<SessionLogSettings>,
    /// 权限配置（白名单/黑名单）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Permissions>,
}

/// 检查对话日志是否启用（默认启用）
pub fn is_session_log_enabled(settings: &Settings) -> bool {
    settings
        .session_log
        .as_ref()
        .map(|c| c.enabled)
        .unwrap_or(true)
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
                                base_url: cfg.base_url.clone(),
                            },
                        )
                    })
                    .collect()
            }),
            models: llm.models.clone(),
        });
        Settings {
            llm,
            session_log: self.session_log.clone(),
            permissions: self.permissions.clone(),
        }
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

/// 更新 settings.toml 中的默认模型名称（default profile）并持久化
pub fn update_settings_model(new_model: &str) -> Result<(), String> {
    let mut settings = load_settings()?.ok_or_else(|| "设置文件不存在".to_string())?;

    if let Some(llm) = settings.llm.as_mut() {
        if let Some(models) = llm.models.as_mut() {
            if let Some(default) = models.get_mut("default") {
                *default = new_model.to_string();
            } else {
                models.insert("default".to_string(), new_model.to_string());
            }
        } else {
            let mut models = std::collections::HashMap::new();
            models.insert("default".to_string(), new_model.to_string());
            llm.models = Some(models);
        }
    }

    let content = toml::to_string(&settings).map_err(|e| format!("序列化设置失败: {}", e))?;
    std::fs::write(get_settings_path(), content).map_err(|e| format!("写入设置文件失败: {}", e))?;

    Ok(())
}

/// 添加命令到白名单并持久化到 settings.toml
///
/// 文件不存在则自动创建；命令已存在则去重跳过。
/// command 会被 .trim() 后存储，确保与 is_safe_command 的匹配规则一致。
pub fn add_to_command_allowlist(command: &str) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let mut settings = match load_settings()? {
        Some(s) => s,
        None => Settings {
            llm: None,
            session_log: None,
            permissions: None,
        },
    };

    if settings.permissions.is_none() {
        settings.permissions = Some(Permissions::default());
    }
    let perms = settings.permissions.as_mut().unwrap();

    // 去重（精确匹配）
    if perms.commands.allow.iter().any(|c| c == trimmed) {
        return Ok(());
    }
    perms.commands.allow.push(trimmed.to_string());

    // 确保设置目录存在
    if let Some(parent) = get_settings_path().parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建设置目录失败: {}", e))?;
    }

    let content = toml::to_string(&settings).map_err(|e| format!("序列化设置失败: {}", e))?;
    std::fs::write(get_settings_path(), content).map_err(|e| format!("写入设置文件失败: {}", e))?;

    Ok(())
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
advanced = "deepseek-v4-flash"
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
                "deepseek-v4-flash"
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
            session_log: None,
            permissions: None,
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
                        base_url: None,
                    },
                )])),
                models: None,
            }),
            session_log: None,
            permissions: None,
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
        let settings = Settings {
            llm: None,
            session_log: None,
            permissions: None,
        };
        let masked = settings.masked();
        assert!(masked.llm.is_none());
    }

    #[test]
    fn test_is_session_log_enabled_default_true() {
        let settings = Settings {
            llm: None,
            session_log: None,
            permissions: None,
        };
        assert!(is_session_log_enabled(&settings));
    }

    #[test]
    fn test_is_session_log_enabled_explicit_true() {
        let settings = Settings {
            llm: None,
            session_log: Some(SessionLogSettings {
                enabled: true,
                log_level: "info".to_string(),
            }),
            permissions: None,
        };
        assert!(is_session_log_enabled(&settings));
    }

    #[test]
    fn test_is_session_log_enabled_explicit_false() {
        let settings = Settings {
            llm: None,
            session_log: Some(SessionLogSettings {
                enabled: false,
                log_level: "info".to_string(),
            }),
            permissions: None,
        };
        assert!(!is_session_log_enabled(&settings));
    }

    #[test]
    fn test_update_settings_model_updates_existing() {
        with_temp_home(|home| {
            write_toml_settings(
                home,
                "[llm]\n\n[llm.providers.deepseek]\napiKey = \"key\"\n\n[llm.models]\ndefault = \"deepseek-v3\"\n",
            );

            // 确保原始配置已加载
            let loaded = load_settings().unwrap().unwrap();
            let default_model = loaded
                .llm
                .as_ref()
                .unwrap()
                .models
                .as_ref()
                .unwrap()
                .get("default")
                .unwrap()
                .clone();
            assert_eq!(default_model, "deepseek-v3");

            // 更新模型名
            update_settings_model("deepseek-v4-flash").unwrap();

            // 验证已更新
            let updated = load_settings().unwrap().unwrap();
            let new_model = updated
                .llm
                .as_ref()
                .unwrap()
                .models
                .as_ref()
                .unwrap()
                .get("default")
                .unwrap()
                .clone();
            assert_eq!(new_model, "deepseek-v4-flash");

            // 确保其他配置未受影响
            let provider = updated
                .llm
                .as_ref()
                .unwrap()
                .providers
                .as_ref()
                .unwrap()
                .get("deepseek")
                .unwrap();
            assert_eq!(provider.api_key, Some("key".to_string()));
        });
    }

    #[test]
    fn test_update_settings_model_adds_default_when_missing() {
        with_temp_home(|home| {
            write_toml_settings(
                home,
                "[llm]\n\n[llm.providers.deepseek]\napiKey = \"key\"\n",
            );

            update_settings_model("deepseek-v4-flash").unwrap();

            let updated = load_settings().unwrap().unwrap();
            let new_model = updated
                .llm
                .as_ref()
                .unwrap()
                .models
                .as_ref()
                .unwrap()
                .get("default")
                .unwrap()
                .clone();
            assert_eq!(new_model, "deepseek-v4-flash");
        });
    }

    #[test]
    fn test_update_settings_model_no_llm_section() {
        with_temp_home(|home| {
            write_toml_settings(home, "[other]\nfoo = \"bar\"\n");

            let result = update_settings_model("deepseek-v4-flash");
            assert!(result.is_ok());

            let updated = load_settings().unwrap().unwrap();
            // llm section 不存在时，不会创建
            assert!(updated.llm.is_none());
        });
    }

    #[test]
    fn test_update_settings_model_file_not_found() {
        with_temp_home(|_home| {
            let result = update_settings_model("deepseek-v4-flash");
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("不存在"));
        });
    }

    // ── Permissions 序列化/反序列化测试 ──

    #[test]
    fn test_permissions_commands_deserialize_empty() {
        let toml_str = r#"
[permissions.commands]
allow = []
deny = []
"#;
        let settings: Settings = toml::from_str(toml_str).unwrap();
        let cmds = settings.permissions.unwrap().commands;
        assert!(cmds.allow.is_empty());
        assert!(cmds.deny.is_empty());
    }

    #[test]
    fn test_permissions_commands_deserialize_with_items() {
        let toml_str = r#"
[permissions.commands]
allow = ["git status", "cargo check"]
deny = ["rm -rf"]
"#;
        let settings: Settings = toml::from_str(toml_str).unwrap();
        let cmds = settings.permissions.unwrap().commands;
        assert_eq!(cmds.allow.len(), 2);
        assert_eq!(cmds.allow[0], "git status");
        assert_eq!(cmds.deny.len(), 1);
        assert_eq!(cmds.deny[0], "rm -rf");
    }

    #[test]
    fn test_permissions_commands_default_empty() {
        let toml_str = r#"
[permissions]
"#;
        let settings: Settings = toml::from_str(toml_str).unwrap();
        let cmds = settings.permissions.unwrap().commands;
        assert!(cmds.allow.is_empty());
        assert!(cmds.deny.is_empty());
    }

    #[test]
    fn test_permissions_not_configured() {
        let toml_str = r#"
[llm]
[llm.models]
default = "deepseek-v4-flash"
"#;
        let settings: Settings = toml::from_str(toml_str).unwrap();
        assert!(settings.permissions.is_none());
    }

    #[test]
    fn test_serialize_settings_without_permissions() {
        let settings = Settings {
            llm: None,
            session_log: None,
            permissions: None,
        };
        let toml_str = toml::to_string(&settings).unwrap();
        assert!(
            !toml_str.contains("permissions"),
            "permissions=None 不应出现在序列化输出中"
        );
    }

    #[test]
    fn test_serialize_settings_with_permissions() {
        let settings = Settings {
            llm: None,
            session_log: None,
            permissions: Some(Permissions {
                commands: CommandPermissions {
                    allow: vec!["git status".to_string()],
                    deny: vec![],
                },
            }),
        };
        let toml_str = toml::to_string(&settings).unwrap();
        assert!(toml_str.contains("allow"));
        assert!(toml_str.contains("git status"));
        assert!(toml_str.contains("deny"));
    }

    #[test]
    fn test_load_settings_with_permissions() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                r#"
[permissions.commands]
allow = ["git diff", "cargo check"]
deny = ["sudo"]
"#,
            )
            .unwrap();

            let settings = load_settings().unwrap().unwrap();
            let cmds = settings.permissions.unwrap().commands;
            assert_eq!(cmds.allow.len(), 2);
            assert_eq!(cmds.deny.len(), 1);
        });
    }

    #[test]
    fn test_load_settings_invalid_permissions_toml() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[permissions.commands]\nallow = invalid\n",
            )
            .unwrap();
            let result = load_settings();
            assert!(result.is_err());
        });
    }

    #[test]
    fn test_load_settings_permissions_wrong_type() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[permissions.commands]\nallow = \"not an array\"\n",
            )
            .unwrap();
            let result = load_settings();
            assert!(result.is_err());
        });
    }

    #[test]
    fn test_permissions_with_full_config() {
        let toml_str = r#"
[llm]
[llm.providers.deepseek]
apiKey = "test-key"

[llm.models]
default = "deepseek-v4-flash"

[permissions.commands]
allow = ["git status"]
deny = ["rm -rf"]

[session_log]
enabled = true
"#;
        let settings: Settings = toml::from_str(toml_str).unwrap();
        assert!(settings.llm.is_some());
        assert!(settings.permissions.is_some());
        assert!(settings.session_log.unwrap().enabled);
    }

    #[test]
    fn test_permissions_deny_only() {
        // 只有 deny 没有 allow 的场景
        let toml_str = r#"
[permissions.commands]
deny = ["sudo", "rm -rf"]
"#;
        let settings: Settings = toml::from_str(toml_str).unwrap();
        let cmds = settings.permissions.unwrap().commands;
        assert!(cmds.allow.is_empty());
        assert_eq!(cmds.deny.len(), 2);
        assert_eq!(cmds.deny[0], "sudo");
    }

    #[test]
    fn test_permissions_allow_only() {
        // 只有 allow 没有 deny 的场景（向后兼容）
        let toml_str = r#"
[permissions.commands]
allow = ["git status"]
"#;
        let settings: Settings = toml::from_str(toml_str).unwrap();
        let cmds = settings.permissions.unwrap().commands;
        assert_eq!(cmds.allow.len(), 1);
        assert!(cmds.deny.is_empty());
    }

    // ── add_to_command_allowlist 测试 ──

    #[test]
    fn test_add_to_command_allowlist_creates_new_file() {
        run_with_temp_home(|home| {
            let path = home.join(".zapmyco/settings.toml");
            assert!(!path.exists());

            let result = add_to_command_allowlist("git status");
            assert!(result.is_ok());
            assert!(path.exists());

            let content = std::fs::read_to_string(&path).unwrap();
            assert!(content.contains("git status"));
        });
    }

    #[test]
    fn test_add_to_command_allowlist_dedup() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                r#"[permissions.commands]
allow = ["git status"]
"#,
            )
            .unwrap();

            let result = add_to_command_allowlist("git status");
            assert!(result.is_ok());

            let settings = load_settings().unwrap().unwrap();
            let allow = settings.permissions.unwrap().commands.allow;
            assert_eq!(allow.len(), 1);
            assert_eq!(allow[0], "git status");
        });
    }

    #[test]
    fn test_add_to_command_allowlist_preserves_existing() {
        run_with_temp_home(|home| {
            write_toml_settings(
                home,
                r#"
[llm]
[llm.providers.deepseek]
apiKey = "key"

[llm.models]
default = "deepseek-v4-flash"
"#,
            );

            add_to_command_allowlist("cargo check").unwrap();

            let settings = load_settings().unwrap().unwrap();
            assert!(settings.llm.is_some());
            let model = settings
                .llm
                .as_ref()
                .unwrap()
                .models
                .as_ref()
                .unwrap()
                .get("default")
                .unwrap()
                .clone();
            assert_eq!(model, "deepseek-v4-flash");
            let allow = settings.permissions.unwrap().commands.allow;
            assert_eq!(allow, vec!["cargo check"]);
        });
    }

    #[test]
    fn test_add_to_command_allowlist_trim() {
        run_with_temp_home(|home| {
            add_to_command_allowlist("  git status  ").unwrap();

            let settings = load_settings().unwrap().unwrap();
            let allow = settings.permissions.unwrap().commands.allow;
            assert_eq!(allow, vec!["git status"]);
        });
    }

    #[test]
    fn test_add_to_command_allowlist_empty_after_trim() {
        run_with_temp_home(|home| {
            let result = add_to_command_allowlist("   ");
            assert!(result.is_ok());

            let settings = load_settings().unwrap();
            assert!(settings.is_none(), "纯空白不应创建 settings.toml");
        });
    }

    #[test]
    fn test_add_to_command_allowlist_special_chars() {
        run_with_temp_home(|home| {
            let cmd = r#"git commit -m "fix: important bug""#;
            let result = add_to_command_allowlist(cmd);
            assert!(result.is_ok());

            let settings = load_settings().unwrap().unwrap();
            let allow = settings.permissions.unwrap().commands.allow;
            assert_eq!(allow, vec![cmd]);
        });
    }

    #[test]
    fn test_add_to_command_allowlist_multiple_commands() {
        run_with_temp_home(|home| {
            add_to_command_allowlist("git status").unwrap();
            add_to_command_allowlist("cargo check").unwrap();
            add_to_command_allowlist("npm test").unwrap();

            let settings = load_settings().unwrap().unwrap();
            let allow = settings.permissions.unwrap().commands.allow;
            assert_eq!(allow.len(), 3);
            assert_eq!(allow[0], "git status");
            assert_eq!(allow[1], "cargo check");
            assert_eq!(allow[2], "npm test");
        });
    }

    #[test]
    fn test_add_to_command_allowlist_unicode() {
        run_with_temp_home(|home| {
            add_to_command_allowlist("echo 你好世界").unwrap();
            let settings = load_settings().unwrap().unwrap();
            let allow = settings.permissions.unwrap().commands.allow;
            assert_eq!(allow, vec!["echo 你好世界"]);
        });
    }

    #[test]
    fn test_add_to_command_allowlist_emoji() {
        run_with_temp_home(|home| {
            add_to_command_allowlist("echo 🚀 test").unwrap();
            let settings = load_settings().unwrap().unwrap();
            let allow = settings.permissions.unwrap().commands.allow;
            assert_eq!(allow, vec!["echo 🚀 test"]);
        });
    }

    #[test]
    fn test_add_to_command_allowlist_long_command() {
        run_with_temp_home(|home| {
            let long_arg = "a".repeat(10_000);
            let cmd = format!("echo {}", long_arg);
            let result = add_to_command_allowlist(&cmd);
            assert!(result.is_ok());

            let settings = load_settings().unwrap().unwrap();
            let allow = settings.permissions.unwrap().commands.allow;
            assert_eq!(allow.len(), 1);
            assert!(allow[0].starts_with("echo "));
            assert_eq!(allow[0].len(), cmd.len());
        });
    }

    #[test]
    fn test_add_to_command_allowlist_existing_deny_only() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                r#"[permissions.commands]
deny = ["rm -rf"]
"#,
            )
            .unwrap();

            add_to_command_allowlist("git status").unwrap();

            let settings = load_settings().unwrap().unwrap();
            let cmds = settings.permissions.unwrap().commands;
            assert_eq!(cmds.allow, vec!["git status"]);
            assert_eq!(cmds.deny, vec!["rm -rf"]);
        });
    }

    #[test]
    fn test_add_to_command_allowlist_corrupted_toml() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "{{{NOT VALID TOML}}}").unwrap();

            let result = add_to_command_allowlist("git status");
            assert!(result.is_err());
            let err_msg = result.err().unwrap();
            assert!(
                err_msg.contains("TOML") || err_msg.contains("格式错误"),
                "错误信息应指向 TOML 解析失败: {}",
                err_msg
            );
        });
    }

    #[test]
    fn test_add_to_command_allowlist_empty_file() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "").unwrap();

            add_to_command_allowlist("git status").unwrap();

            let settings = load_settings().unwrap().unwrap();
            let allow = settings.permissions.unwrap().commands.allow;
            assert_eq!(allow, vec!["git status"]);
        });
    }
}
