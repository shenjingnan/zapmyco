/// CLI 入口 — 基于 clap 的命令行界面
use clap::{Parser, Subcommand};

use crate::models::{get_built_in_model_names, get_model_info};
use crate::settings;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Parser)]
#[command(
    name = "zapmyco",
    version = VERSION,
    about = "基于 Rust 的 AI 驱动命令行工具",
    subcommand_required = false,
    arg_required_else_help = true,
    disable_help_subcommand = true,
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// 向指定名称打招呼
    Greet {
        /// 要打招呼的名称
        name: String,
    },
    /// 显示配置信息
    Config,
    /// 初始化 LLM 配置
    Init,
    /// 显示 LLM 配置
    Settings {
        /// 子命令: path, show
        subcommand: Option<String>,
    },
    /// 一次性执行 AI 任务，完成后退出
    Run {
        /// 任务描述
        content: String,
        /// 指定模型配置档
        #[arg(long)]
        profile: Option<String>,
    },
}

/// 显示设置文件路径
fn settings_path() -> String {
    settings::get_settings_path().to_string_lossy().to_string()
}

/// greet 命令
fn cmd_greet(name: &str) -> Result<String, String> {
    if name.is_empty() {
        return Err("name cannot be empty".to_string());
    }
    Ok(format!("Hello, {}!", name))
}

/// config 命令
fn cmd_config() -> Result<String, String> {
    let config = serde_json::json!({
        "debug": false,
        "logLevel": "info",
        "createdAt": chrono_now()
    });
    Ok(serde_json::to_string_pretty(&config).unwrap_or_default())
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    // Simple UTC timestamp in ISO 8601 format
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    // Days since epoch to date (simplified approach)
    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let is_leap_year = is_leap(y);
    let month_days = [
        31,
        if is_leap_year { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining < md {
            m = i + 1;
            break;
        }
        remaining -= md;
    }
    if m == 0 {
        m = 12;
    }
    let d = remaining + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, hours, minutes, seconds
    )
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// init 命令 - 交互式初始化向导
fn cmd_init() -> Result<String, String> {
    let file_path = settings::get_settings_path();

    // 检查是否已存在
    if file_path.exists() {
        return Err(format!(
            "{} 已存在。如需重新初始化，请先删除该文件。",
            file_path.display()
        ));
    }

    // 交互式问答（每一步都支持 Ctrl+C 优雅退出）
    let provider = match prompt_provider() {
        Some(p) => p,
        None => return Ok(String::new()),
    };

    // 选择 API Key 方式：直接输入或使用环境变量
    let api_key = match prompt_api_key() {
        Some(k) => k,
        None => return Ok(String::new()),
    };

    // 选择默认模型
    let default_model = match prompt_model(provider) {
        Some(m) => m,
        None => return Ok(String::new()),
    };

    // 构建配置
    let settings_data = serde_json::json!({
        "llm": {
            "providers": {
                provider: {
                    "apiKey": api_key
                }
            },
            "models": {
                "default": default_model
            }
        }
    });

    // 写入文件
    let settings_dir = settings::get_settings_dir();
    std::fs::create_dir_all(&settings_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;

    let content = serde_json::to_string_pretty(&settings_data)
        .map_err(|e| format!("序列化配置失败: {}", e))?
        + "\n";

    std::fs::write(&file_path, content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(format!(
        "已创建 {}\n请运行 `zapmyco settings` 查看配置。",
        file_path.display()
    ))
}

/// 选择 AI 供应商
fn prompt_provider() -> Option<&'static str> {
    inquire::Select::new("选择 AI 供应商", vec!["DeepSeek", "GLM（智谱）", "自定义"])
        .with_vim_mode(true)
        .prompt()
        .ok()
        .map(|s| match s {
            "DeepSeek" => "deepseek",
            "GLM（智谱）" => "glm",
            _ => "custom",
        })
}

/// 输入 API Key
fn prompt_api_key() -> Option<String> {
    // 先询问使用方式
    let use_env = inquire::Confirm::new("使用环境变量设置 API Key？")
        .with_default(false)
        .with_help_message("推荐使用环境变量，避免 API Key 明文存储在配置文件中")
        .prompt()
        .ok()?;

    if use_env {
        // 选择或输入环境变量名
        let var_name = inquire::Text::new("环境变量名称")
            .with_default("DEEPSEEK_API_KEY")
            .with_help_message("例如: DEEPSEEK_API_KEY, GLM_API_KEY")
            .prompt()
            .ok()?;
        let value = format!("${{env.{}}}", var_name);
        return Some(value);
    }

    // 直接输入 API Key
    let key = inquire::Password::new("输入 API Key")
        .with_display_mode(inquire::PasswordDisplayMode::Masked)
        .with_help_message("留空则使用 ${env.DEEPSEEK_API_KEY}")
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
    let all_models = get_built_in_model_names();
    let filtered_models: Vec<&str> = if provider == "custom" {
        all_models
    } else {
        all_models
            .into_iter()
            .filter(|name| get_model_info(name).is_some_and(|info| info.provider == provider))
            .collect()
    };

    if !filtered_models.is_empty() {
        // 构建带上下文信息的显示标签
        let choices: Vec<(String, &str)> = filtered_models
            .iter()
            .map(|name| {
                let label = format_model_label(name);
                (label, *name)
            })
            .collect();

        let display_labels: Vec<&str> = choices.iter().map(|(label, _)| label.as_str()).collect();

        // 用索引定位选中项，避免所有权问题
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

/// 格式化模型标签（含上下文窗口信息）
fn format_model_label(name: &str) -> String {
    let info = get_model_info(name);
    match info.and_then(|i| i.context_window) {
        Some(cw) if cw >= 1_000_000 => format!("{} ({}M 上下文)", name, cw / 1_000_000),
        Some(cw) => format!("{} ({}K 上下文)", name, cw / 1000),
        None => name.to_string(),
    }
}

/// settings 命令
fn cmd_settings(subcommand: Option<&str>) -> Result<String, String> {
    match subcommand {
        Some("path") => Ok(settings_path()),
        Some("show") | None => {
            let masked = settings::display_settings()?;
            Ok(serde_json::to_string_pretty(&masked).unwrap_or_default())
        }
        Some(unknown) => Err(format!(
            "未知子命令: {}\n可用命令: settings, settings path",
            unknown
        )),
    }
}

/// run 命令 - 一次性执行 AI 任务（流式输出）
async fn cmd_run(content: &str, profile: Option<&str>) -> Result<(), String> {
    let file_path = settings::get_settings_path();

    if !file_path.exists() {
        return Err(format!(
            "未找到配置文件 {}\n请先运行 `zapmyco init` 初始化 LLM 配置。",
            file_path.display()
        ));
    }

    if content.is_empty() {
        return Err("任务描述不能为空".to_string());
    }

    let options = crate::agent::AiAgentOptions {
        model_profile: profile.map(|s| s.to_string()),
        ..Default::default()
    };

    let mut agent = crate::agent::AiAgent::new(options)?;
    let _response = agent
        .chat_stream(content, |chunk| {
            print!("{}", chunk);
            use std::io::Write;
            std::io::stdout().flush().ok();
        })
        .await?;
    println!();
    Ok(())
}

/// 无参模式 - 启动交互式聊天
async fn cmd_interactive() -> Result<(), String> {
    let file_path = settings::get_settings_path();
    if !file_path.exists() {
        return Err(format!(
            "未找到配置文件 {}\n请先运行 `zapmyco init` 初始化 LLM 配置。",
            file_path.display()
        ));
    }

    let mut agent = crate::agent::AiAgent::new(crate::agent::AiAgentOptions::default())?;
    agent.start_interactive_chat().await
}

/// CLI 入口 - 解析参数并执行对应操作
pub async fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Some(Commands::Greet { name }) => {
            let output = cmd_greet(&name)?;
            println!("{}", output);
            Ok(())
        }
        Some(Commands::Config) => {
            let output = cmd_config()?;
            println!("{}", output);
            Ok(())
        }
        Some(Commands::Init) => {
            let output = cmd_init()?;
            if !output.is_empty() {
                println!("{}", output);
            }
            Ok(())
        }
        Some(Commands::Settings { subcommand }) => {
            let output = cmd_settings(subcommand.as_deref())?;
            println!("{}", output);
            Ok(())
        }
        Some(Commands::Run { content, profile }) => cmd_run(&content, profile.as_deref()).await,
        None => cmd_interactive().await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_greet_with_name() {
        assert_eq!(cmd_greet("World").unwrap(), "Hello, World!");
        assert_eq!(cmd_greet("TypeScript").unwrap(), "Hello, TypeScript!");
    }

    #[test]
    fn test_greet_empty_name() {
        let result = cmd_greet("");
        assert!(result.is_err());
        assert_eq!(result.err().unwrap(), "name cannot be empty");
    }

    #[test]
    fn test_greet_with_spaces() {
        assert_eq!(cmd_greet("John Doe").unwrap(), "Hello, John Doe!");
    }

    #[test]
    fn test_greet_unicode() {
        assert_eq!(cmd_greet("世界").unwrap(), "Hello, 世界!");
    }

    #[test]
    fn test_settings_path_contains_zapmyco() {
        let path = settings_path();
        assert!(path.contains(".zapmyco/settings.json"));
    }

    #[test]
    fn test_settings_unknown_subcommand() {
        let result = cmd_settings(Some("unknown"));
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("未知子命令"));
    }

    #[tokio::test]
    async fn test_run_empty_content() {
        let result = cmd_run("", None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_run_no_settings() {
        // 使用临时 HOME 隔离 settings.json 的干扰
        let dir = tempfile::tempdir().unwrap();
        let orig_home = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        let result = cmd_run("hello", None).await;
        assert!(result.is_err());

        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
    }

    #[test]
    fn test_init_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let orig_home = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        // 创建已存在的配置文件
        let settings_dir = dir.path().join(".zapmyco");
        std::fs::create_dir_all(&settings_dir).unwrap();
        std::fs::write(settings_dir.join("settings.json"), "{}").unwrap();

        let result = cmd_init();
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("已存在"));

        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
    }

    #[test]
    fn test_format_model_label() {
        let label = format_model_label("deepseek-v4-flash");
        assert!(label.contains("deepseek-v4-flash"));
        assert!(label.contains("1M"));

        let label = format_model_label("glm-4v");
        assert!(label.contains("glm-4v"));
        assert!(label.contains("128K"));
    }

    #[test]
    fn test_version_constant() {
        assert_eq!(VERSION, "0.22.2");
    }

    #[test]
    fn test_settings_display_legacy_masked() {
        let dir = tempfile::tempdir().unwrap();
        let orig_home = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        let settings_dir = dir.path().join(".zapmyco");
        std::fs::create_dir_all(&settings_dir).unwrap();
        std::fs::write(
            settings_dir.join("settings.json"),
            r#"{"llm":{"apiKey":"sk-test-key-value","baseURL":"https://test.com","model":"test-model"}}"#,
        )
        .unwrap();

        let result = cmd_settings(None);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("sk-***"));
        assert!(!output.contains("sk-test-key-value"));

        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
    }

    #[test]
    fn test_settings_display_env_var() {
        let dir = tempfile::tempdir().unwrap();
        let orig_home = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        let settings_dir = dir.path().join(".zapmyco");
        std::fs::create_dir_all(&settings_dir).unwrap();
        std::fs::write(
            settings_dir.join("settings.json"),
            r#"{"llm":{"apiKey":"${env.DEEPSEEK_API_KEY}"}}"#,
        )
        .unwrap();

        let result = cmd_settings(None);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("${env.DEEPSEEK_API_KEY}"));

        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
    }

    #[test]
    fn test_settings_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let orig_home = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        let settings_dir = dir.path().join(".zapmyco");
        std::fs::create_dir_all(&settings_dir).unwrap();
        std::fs::write(settings_dir.join("settings.json"), "not valid json").unwrap();

        let result = cmd_settings(None);
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("JSON 格式错误"));

        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
    }

    #[test]
    fn test_settings_new_format_masked() {
        let dir = tempfile::tempdir().unwrap();
        let orig_home = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        let settings_dir = dir.path().join(".zapmyco");
        std::fs::create_dir_all(&settings_dir).unwrap();
        std::fs::write(
            settings_dir.join("settings.json"),
            r#"{"llm":{"providers":{"deepseek":{"apiKey":"sk-long-key-value-test"},"glm":{"apiKey":"short-key"}},"models":{"default":"deepseek-v4-flash"}}}"#,
        )
        .unwrap();

        let result = cmd_settings(None);
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("sk-***"));
        assert!(output.contains("sho***"));

        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
    }
}
