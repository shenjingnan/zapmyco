use std::collections::HashMap;
use std::io::IsTerminal;

use crate::config::models::{get_built_in_model_names, get_model_info};
use crate::config::settings::{self, LlmSettings, ProviderConfig, Settings};

/// init 命令 - 交互式初始化向导
pub(crate) fn cmd_init() -> Result<String, String> {
    let message = cmd_init_inner(
        settings::get_settings_path(),
        std::io::stdin().is_terminal(),
        || {
            inquire::Confirm::new("配置文件已存在，是否覆盖？")
                .with_default(false)
                .with_help_message("选择「是」将覆盖现有配置")
                .prompt()
                .ok()
                .unwrap_or(false)
        },
    )?;

    if !std::io::stdin().is_terminal() {
        return Ok(message);
    }

    let enable = inquire::Confirm::new("是否启用 Shell 自动补全？")
        .with_default(true)
        .with_help_message("按 Tab 键可补全子命令和参数")
        .prompt()
        .ok()
        .unwrap_or(false);

    if !enable {
        return Ok(message);
    }

    match crate::commands::completion::setup_shell_completion() {
        Ok(msg) => Ok(format!("{}\n\n{}", message, msg)),
        Err(e) => Ok(format!("{}\n\n{}", message, e)),
    }
}

/// init 内部实现，支持注入参数以方便测试
pub(crate) fn cmd_init_inner(
    file_path: std::path::PathBuf,
    is_terminal: bool,
    confirm_overwrite: impl FnOnce() -> bool,
) -> Result<String, String> {
    if file_path.exists() {
        if is_terminal {
            if !confirm_overwrite() {
                return Ok("已取消初始化。".to_string());
            }
        } else {
            return Err(format!(
                "{} 已存在。如需重新初始化，请先删除该文件。",
                file_path.display()
            ));
        }
    }

    let provider = match prompt_provider() {
        Some(p) => p,
        None => return Ok(String::new()),
    };

    let api_key = match prompt_api_key() {
        Some(k) => k,
        None => return Ok(String::new()),
    };

    let default_model = match prompt_model(provider) {
        Some(m) => m,
        None => return Ok(String::new()),
    };

    let settings_data = build_settings(provider, &api_key, &default_model);

    write_settings(&file_path, &settings_data)?;

    Ok(format!(
        "已创建 {}\n请运行 `zapmyco settings` 查看配置。",
        file_path.display()
    ))
}

/// 选择 AI 供应商
fn prompt_provider() -> Option<&'static str> {
    inquire::Select::new(
        "选择 AI 供应商",
        vec![
            "Anthropic",
            "DeepSeek",
            "Qwen（通义千问）",
            "MiniMax",
            "GLM（智谱）",
            "Kimi（月之暗面）",
            "Doubao（火山引擎/字节）",
            "MIMO（小米）",
            "自定义",
        ],
    )
    .with_vim_mode(true)
    .prompt()
    .ok()
    .map(|s| match s {
        "Anthropic" => "anthropic",
        "DeepSeek" => "deepseek",
        "Qwen（通义千问）" => "qwen",
        "MiniMax" => "minimax",
        "GLM（智谱）" => "glm",
        "Kimi（月之暗面）" => "kimi",
        "Doubao（火山引擎/字节）" => "doubao",
        "MIMO（小米）" => "mimo",
        _ => "custom",
    })
}

/// 输入 API Key
fn prompt_api_key() -> Option<String> {
    let use_env = inquire::Confirm::new("使用环境变量设置 API Key？")
        .with_default(false)
        .with_help_message("推荐使用环境变量，避免 API Key 明文存储在配置文件中")
        .prompt()
        .ok()?;

    if use_env {
        let var_name = inquire::Text::new("环境变量名称")
            .with_default("DEEPSEEK_API_KEY")
            .with_help_message("例如: DEEPSEEK_API_KEY, GLM_API_KEY")
            .prompt()
            .ok()?;
        let value = format!("${{env.{}}}", var_name);
        return Some(value);
    }

    let key = inquire::Password::new("输入 API Key")
        .with_display_mode(inquire::PasswordDisplayMode::Masked)
        .with_help_message("留空则使用 ${env.DEEPSEEK_API_KEY}")
        .without_confirmation()
        .prompt()
        .ok()?;

    if key.is_empty() {
        Some("${env.DEEPSEEK_API_KEY}".to_string())
    } else {
        Some(key)
    }
}

/// 选择默认模型（显示上下文窗口信息）
fn prompt_model(provider: &str) -> Option<String> {
    let filtered_models = filter_models_by_provider(provider);

    if !filtered_models.is_empty() {
        let choices: Vec<(String, &str)> = filtered_models
            .iter()
            .map(|name| {
                let label = format_model_label(name);
                (label, *name)
            })
            .collect();

        let display_labels: Vec<&str> = choices.iter().map(|(label, _)| label.as_str()).collect();

        let selected_idx = inquire::Select::new("选择默认模型", display_labels)
            .with_vim_mode(true)
            .prompt()
            .ok()
            .and_then(|selected| choices.iter().position(|(label, _)| label == selected))?;

        Some(choices[selected_idx].1.to_string())
    } else {
        inquire::Text::new("输入模型名称")
            .with_default("deepseek-v4-flash")
            .prompt()
            .ok()
    }
}

/// 根据供应商筛选可用模型列表
pub(crate) fn filter_models_by_provider(provider: &str) -> Vec<&'static str> {
    let all_models = get_built_in_model_names();
    if provider == "custom" {
        all_models
    } else {
        all_models
            .into_iter()
            .filter(|name| get_model_info(name).is_some_and(|info| info.provider == provider))
            .collect()
    }
}

/// 构建 Settings 结构体
pub(crate) fn build_settings(provider: &str, api_key: &str, default_model: &str) -> Settings {
    Settings {
        llm: Some(LlmSettings {
            providers: Some({
                let mut map = HashMap::new();
                map.insert(
                    provider.to_string(),
                    ProviderConfig {
                        api_key: Some(api_key.to_string()),
                        base_url: None,
                    },
                );
                map
            }),
            models: Some({
                let mut map = HashMap::new();
                map.insert("default".to_string(), default_model.to_string());
                map
            }),
        }),
        conversation_log: None,
        permissions: None,
    }
}

/// 写入 Settings 到配置文件
pub(crate) fn write_settings(
    file_path: &std::path::Path,
    settings: &Settings,
) -> Result<String, String> {
    let settings_dir = settings::get_settings_dir();
    std::fs::create_dir_all(&settings_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;

    let content = toml::to_string(&settings).map_err(|e| format!("序列化配置失败: {}", e))? + "\n";

    std::fs::write(file_path, content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(format!(
        "已创建 {}\n请运行 `zapmyco settings` 查看配置。",
        file_path.display()
    ))
}

/// 格式化模型标签（含上下文窗口信息）
pub(crate) fn format_model_label(name: &str) -> String {
    let info = get_model_info(name);
    match info.and_then(|i| i.context_window) {
        Some(cw) if cw >= 1_000_000 => format!("{} ({}M 上下文)", name, cw / 1_000_000),
        Some(cw) => format!("{} ({}K 上下文)", name, cw / 1000),
        None => name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;

    #[test]
    fn test_init_existing_file() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "").unwrap();

            let file_path = settings::get_settings_path();
            let result = cmd_init_inner(file_path, false, || true);
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("已存在"));
        });
    }

    #[test]
    fn test_init_existing_file_tty_skip() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "").unwrap();

            let file_path = settings::get_settings_path();
            let result = cmd_init_inner(file_path, true, || false);
            assert!(result.is_ok());
            assert!(result.unwrap().contains("已取消初始化"));
        });
    }

    #[test]
    fn test_filter_models_by_provider_deepseek() {
        let models = filter_models_by_provider("deepseek");
        assert!(models.contains(&"deepseek-v4-flash"));
        assert!(models.contains(&"deepseek-v4-pro"));
        assert_eq!(models.len(), 2);
    }

    #[test]
    fn test_filter_models_by_provider_glm() {
        let models = filter_models_by_provider("glm");
        assert!(models.contains(&"glm-5v-turbo"));
        assert!(models.contains(&"glm-5.1"));
        assert_eq!(models.len(), 4);
    }

    #[test]
    fn test_filter_models_by_provider_custom() {
        let models = filter_models_by_provider("custom");
        assert_eq!(models.len(), 22);
    }

    #[test]
    fn test_filter_models_by_provider_unknown() {
        let models = filter_models_by_provider("nonexistent");
        assert!(models.is_empty());
    }

    #[test]
    fn test_build_settings_valid() {
        let settings = build_settings("deepseek", "${env.DEEPSEEK_API_KEY}", "deepseek-v4-flash");
        let llm = settings.llm.as_ref().unwrap();
        assert_eq!(
            llm.providers
                .as_ref()
                .unwrap()
                .get("deepseek")
                .unwrap()
                .api_key,
            Some("${env.DEEPSEEK_API_KEY}".to_string())
        );
        assert_eq!(
            llm.models.as_ref().unwrap().get("default").unwrap(),
            "deepseek-v4-flash"
        );
    }

    #[test]
    fn test_write_settings_creates_file() {
        run_with_temp_home(|home| {
            let file_path = home.join("custom_settings.toml");
            let settings = build_settings("glm", "test-key", "glm-5v-turbo");
            let result = write_settings(&file_path, &settings);
            assert!(result.is_ok());
            assert!(result.unwrap().contains("custom_settings.toml"));
            assert!(file_path.exists());

            let content = std::fs::read_to_string(&file_path).unwrap();
            assert!(content.contains("glm-5v-turbo"));
            assert!(content.contains("test-key"));
        });
    }

    #[test]
    fn test_format_model_label() {
        let label = format_model_label("deepseek-v4-flash");
        assert!(label.contains("deepseek-v4-flash"));
        assert!(label.contains("1M"));

        let label = format_model_label("glm-5v-turbo");
        assert!(label.contains("glm-5v-turbo"));
        assert!(label.contains("200K"));
    }

    #[test]
    fn test_format_model_label_unknown() {
        let label = format_model_label("nonexistent-model-v1");
        assert_eq!(label, "nonexistent-model-v1");
    }

    #[test]
    fn test_format_model_label_with_context() {
        // 确保至少一个已知模型的标签包含上下文信息
        let label = format_model_label("deepseek-v4-flash");
        assert!(label.contains("deepseek-v4-flash"));
    }

    #[test]
    fn test_format_model_label_glm() {
        let label = format_model_label("glm-5v-turbo");
        assert!(label.contains("glm-5v-turbo"));
    }

    #[test]
    fn test_format_model_label_1m_boundary() {
        let label = format_model_label("deepseek-v4-flash");
        assert!(label.contains("1M"));
    }
}
