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
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
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

    // 交互式问答
    let provider = inquire::Select::new("选择 AI 供应商", vec!["deepseek", "glm", "custom"])
        .with_vim_mode(true)
        .prompt()
        .map_err(|e| handle_inquire_error(e))?;

    let api_key = inquire::Password::new("输入 API Key（留空则使用环境变量）")
        .with_display_mode(inquire::PasswordDisplayMode::Masked)
        .prompt()
        .map_err(|e| handle_inquire_error(e))?;

    // 选择默认模型
    let all_models = get_built_in_model_names();
    let filtered_models: Vec<&str> = if provider == "custom" {
        all_models
    } else {
        all_models
            .into_iter()
            .filter(|name| {
                get_model_info(name).map_or(false, |info| info.provider == provider)
            })
            .collect()
    };

    let default_model = if !filtered_models.is_empty() {
        let choices: Vec<&str> = filtered_models
            .iter()
            .map(|s| *s)
            .collect();
        inquire::Select::new("选择默认模型", choices)
            .with_vim_mode(true)
            .prompt()
            .map_err(|e| handle_inquire_error(e))?
            .to_string()
    } else {
        inquire::Text::new("输入模型名称")
            .with_default("deepseek-v4-flash")
            .prompt()
            .map_err(|e| handle_inquire_error(e))?
    };

    // 构建配置
    let final_api_key = if api_key.is_empty() {
        "${env.DEEPSEEK_API_KEY}".to_string()
    } else {
        api_key
    };

    let settings_data = serde_json::json!({
        "llm": {
            "providers": {
                provider: {
                    "apiKey": final_api_key
                }
            },
            "models": {
                "default": default_model
            }
        }
    });

    // 写入文件
    let settings_dir = settings::get_settings_dir();
    std::fs::create_dir_all(&settings_dir)
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    let content = serde_json::to_string_pretty(&settings_data)
        .map_err(|e| format!("序列化配置失败: {}", e))?
        + "\n";

    std::fs::write(&file_path, content)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(format!(
        "已创建 {}\n请运行 `zapmyco settings` 查看配置。",
        file_path.display()
    ))
}

fn handle_inquire_error(e: inquire::InquireError) -> String {
    match e {
        inquire::InquireError::OperationCanceled => String::new(),
        _ => format!("操作失败: {}", e),
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

/// run 命令 - 在 Phase 2 中实现完整功能
fn cmd_run(content: &str, _profile: Option<&str>) -> Result<String, String> {
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

    // Phase 2 实现：调用 AiAgent
    Err("AI Agent 功能正在开发中，敬请期待。".to_string())
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
            println!("{}", output);
            Ok(())
        }
        Some(Commands::Settings { subcommand }) => {
            let output = cmd_settings(subcommand.as_deref())?;
            println!("{}", output);
            Ok(())
        }
        Some(Commands::Run { content, profile }) => {
            let output = cmd_run(&content, profile.as_deref())?;
            println!("{}", output);
            Ok(())
        }
        None => {
            // 无参数时提示
            let file_path = settings::get_settings_path();
            if !file_path.exists() {
                return Err(format!(
                    "未找到配置文件 {}\n请先运行 `zapmyco init` 初始化 LLM 配置。",
                    file_path.display()
                ));
            }
            // Phase 2: 启动交互式聊天
            Err("交互式聊天功能正在开发中，请先使用子命令。".to_string())
        }
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

    #[test]
    fn test_run_empty_content() {
        let result = cmd_run("", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_run_no_settings() {
        // 此时当前目录可能没有 settings 文件
        let result = cmd_run("hello", None);
        assert!(result.is_err());
    }
}
