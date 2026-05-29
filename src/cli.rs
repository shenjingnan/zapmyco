/// CLI 入口 — 基于 clap 的命令行界面
use clap::{Parser, Subcommand};
use std::io::IsTerminal;

use crate::models::{get_built_in_model_names, get_model_info};
use crate::settings;
use crate::settings::{LlmSettings, ProviderConfig, Settings};
use std::collections::HashMap;

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
#[non_exhaustive]
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
    /// 卸载 zapmyco（清理配置、收据、二进制文件）
    Uninstall,
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

    // 检查是否已存在，交互式环境询问是否覆盖，非交互环境（CI）直接报错
    if file_path.exists() {
        if std::io::stdin().is_terminal() {
            let overwrite = inquire::Confirm::new("配置文件已存在，是否覆盖？")
                .with_default(false)
                .with_help_message("选择「是」将覆盖现有配置")
                .prompt()
                .ok()
                .unwrap_or(false);

            if !overwrite {
                return Ok("已取消初始化。".to_string());
            }
        } else {
            return Err(format!(
                "{} 已存在。如需重新初始化，请先删除该文件。",
                file_path.display()
            ));
        }
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
    let settings_data = Settings {
        llm: Some(LlmSettings {
            providers: Some({
                let mut map = HashMap::new();
                map.insert(
                    provider.to_string(),
                    ProviderConfig {
                        api_key: Some(api_key),
                    },
                );
                map
            }),
            models: Some({
                let mut map = HashMap::new();
                map.insert("default".to_string(), default_model);
                map
            }),
        }),
    };

    // 写入文件
    let settings_dir = settings::get_settings_dir();
    std::fs::create_dir_all(&settings_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;

    let content =
        toml::to_string(&settings_data).map_err(|e| format!("序列化配置失败: {}", e))? + "\n";

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
        Some("show") | None => settings::display_settings(),
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

/// uninstall 命令 — 卸载 zapmyco
fn cmd_uninstall() -> Result<(), String> {
    let zapmyco_dir = settings::get_settings_dir();
    let exe_path = std::env::current_exe().ok();
    let receipt_dir = settings::get_home_dir().join(".config/zapmyco");
    let has_receipt = receipt_dir.exists();
    let has_zapmyco_dir = zapmyco_dir.exists();

    // 非 TTY 环境（CI/管道）跳过交互提示，避免 Windows CI 中 inquire 挂起
    if !std::io::stdin().is_terminal() {
        return execute_uninstall(
            &receipt_dir,
            &zapmyco_dir,
            has_receipt,
            true, // want_keep_zapmyco: 非交互模式下默认保留，避免误删
            exe_path.as_deref(),
        );
    }

    // ——————————————————————————————————————————————
    // Phase 1: 确认阶段 — 只收集用户意愿，不执行删除
    // 此时按 Ctrl+C 可安全终止，不会丢失任何数据
    // ——————————————————————————————————————————————
    let want_keep_zapmyco = if has_zapmyco_dir {
        match inquire::Confirm::new("是否保留记忆和配置？")
            .with_default(true)
            .prompt()
        {
            Ok(val) => val,
            Err(_) => {
                println!();
                println!("谢，不删之恩~ 🥹");
                return Ok(());
            } // Ctrl+C，安全终止
        }
    } else {
        true
    };

    // ——————————————————————————————————————————————
    // 最终确认 — 给用户一次反悔机会
    // ——————————————————————————————————————————————
    let confirmed = match inquire::Confirm::new("是否确认卸载？")
        .with_default(true)
        .prompt()
    {
        Ok(val) => val,
        Err(_) => {
            println!();
            println!("谢，不删之恩~ 🥹");
            return Ok(());
        } // Ctrl+C / 非 TTY，安全终止
    };

    if !confirmed {
        println!();
        println!("谢，不删之恩~ 🥹");
        return Ok(());
    }

    // ——————————————————————————————————————————————
    // Phase 2: 执行阶段 — 统一删除
    // ——————————————————————————————————————————————
    execute_uninstall(
        &receipt_dir,
        &zapmyco_dir,
        has_receipt,
        want_keep_zapmyco,
        exe_path.as_deref(),
    )
}

/// 执行卸载清理（不含用户交互，可测试）
fn execute_uninstall(
    receipt_dir: &std::path::Path,
    zapmyco_dir: &std::path::Path,
    has_receipt: bool,
    want_keep_zapmyco: bool,
    exe_path: Option<&std::path::Path>,
) -> Result<(), String> {
    const RED: &str = "\x1b[31m";
    const RESET: &str = "\x1b[0m";

    // 安装收据（自动清理）
    if has_receipt && let Err(e) = std::fs::remove_dir_all(receipt_dir) {
        eprintln!("  {RED}✗{RESET} 删除安装收据失败: {}", e);
    }

    // ~/.zapmyco/（用户已确认）
    if !want_keep_zapmyco && let Err(e) = std::fs::remove_dir_all(zapmyco_dir) {
        eprintln!("  {RED}✗{RESET} 删除 {} 失败: {}", zapmyco_dir.display(), e);
    }

    // 二进制文件（自动删除，Windows 不支持自删运行中的进程）
    #[cfg(not(windows))]
    if let Some(path) = exe_path
        && let Err(e) = std::fs::remove_file(path)
    {
        eprintln!("  {RED}✗{RESET} 删除二进制文件失败: {}", e);
    }

    #[cfg(windows)]
    if let Some(path) = exe_path {
        println!("请手动删除二进制文件: {}", path.display());
    }

    println!();
    println!("有缘再见~ 👋");

    Ok(())
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
        Some(Commands::Uninstall) => cmd_uninstall(),
        Some(Commands::Run { content, profile }) => cmd_run(&content, profile.as_deref()).await,
        None => cmd_interactive().await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;

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
        assert!(path.contains(".zapmyco/settings.toml"));
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
        // 使用临时 HOME 隔离 settings.toml 的干扰
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
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "").unwrap();

            // 非 TTY 环境下 is_terminal() = false → 直接报错
            let result = cmd_init();
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("已存在"));
        });
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
        // 验证 VERSION 是有效的 semver 格式 (X.Y.Z)
        assert!(!VERSION.is_empty(), "VERSION should not be empty");
        let parts: Vec<&str> = VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "VERSION should be in semver format (X.Y.Z)");
        for part in &parts {
            assert!(!part.is_empty(), "semver part should not be empty");
            assert!(
                part.chars().all(|c| c.is_ascii_digit()),
                "semver part '{}' should be numeric",
                part
            );
        }
    }

    #[test]
    fn test_settings_display_toml_masked() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[llm]\n\n[llm.providers.deepseek]\napiKey = \"sk-test-key-value\"\n",
            )
            .unwrap();

            let result = cmd_settings(None);
            assert!(result.is_ok());
            let output = result.unwrap();
            assert!(output.contains("sk-***"));
            assert!(!output.contains("sk-test-key-value"));
        });
    }

    #[test]
    fn test_settings_display_env_var() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[llm]\n\n[llm.providers.default]\napiKey = \"${env.DEEPSEEK_API_KEY}\"\n",
            )
            .unwrap();

            let result = cmd_settings(None);
            assert!(result.is_ok());
            let output = result.unwrap();
            assert!(output.contains("${env.DEEPSEEK_API_KEY}"));
        });
    }

    #[test]
    fn test_uninstall_clean_state() {
        // 没有需要清理的文件时，卸载应正常完成
        run_with_temp_home(|_home| {
            let result = cmd_uninstall();
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_uninstall_receipt_only() {
        // 非 TTY 环境下，cmd_uninstall 跳过交互确认直接执行卸载
        run_with_temp_home(|home| {
            let receipt_dir = home.join(".config/zapmyco");
            std::fs::create_dir_all(&receipt_dir).unwrap();
            std::fs::write(
                receipt_dir.join("zapmyco-receipt.json"),
                r#"{"version":"0.22.20"}"#,
            )
            .unwrap();

            assert!(receipt_dir.exists());
            let result = cmd_uninstall();
            assert!(result.is_ok());
            // 非 TTY 模式下跳过确认直接执行，收据被删除
            assert!(!receipt_dir.exists(), "收据目录应被删除");
        });
    }

    #[test]
    fn test_execute_clean_state() {
        // 没有文件需要删除时，应正常返回
        run_with_temp_home(|home| {
            let result = execute_uninstall(
                &home.join(".config/zapmyco"),
                &home.join(".zapmyco"),
                false, // has_receipt
                true,  // want_keep_zapmyco
                None,  // exe_path
            );
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_execute_receipt_only() {
        // 删除收据，保留 ~/.zapmyco/
        run_with_temp_home(|home| {
            let receipt_dir = home.join(".config/zapmyco");
            std::fs::create_dir_all(&receipt_dir).unwrap();
            std::fs::write(receipt_dir.join("receipt.json"), r#"{"version":"0.22.20"}"#).unwrap();

            let result = execute_uninstall(
                &receipt_dir,
                &home.join(".zapmyco"),
                true, // has_receipt
                true, // want_keep_zapmyco
                None,
            );
            assert!(result.is_ok());
            assert!(!receipt_dir.exists(), "收据目录应该被删除");
        });
    }

    #[test]
    fn test_execute_remove_zapmyco_dir() {
        // 用户选择不保留记忆 → 删除 ~/.zapmyco/
        run_with_temp_home(|home| {
            let zapmyco_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&zapmyco_dir).unwrap();
            std::fs::write(zapmyco_dir.join("settings.toml"), "").unwrap();

            let result = execute_uninstall(
                &home.join(".config/zapmyco"),
                &zapmyco_dir,
                false, // has_receipt
                false, // want_keep_zapmyco → 删除
                None,
            );
            assert!(result.is_ok());
            assert!(!zapmyco_dir.exists(), "~/.zapmyco/ 应该被删除");
        });
    }

    #[test]
    fn test_execute_binary_deletion_error() {
        // 删除不存在的二进制文件 → 打印错误，不 panic
        run_with_temp_home(|home| {
            let result = execute_uninstall(
                &home.join(".config/zapmyco"),
                &home.join(".zapmyco"),
                false,
                true,
                Some(&home.join("nonexistent-binary")),
            );
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_execute_receipt_delete_error() {
        // has_receipt=true 但目录不存在 → 打印错误，不 panic
        run_with_temp_home(|home| {
            let result = execute_uninstall(
                &home.join(".config/zapmyco"),
                &home.join(".zapmyco"),
                true, // has_receipt 但目录不存在
                true,
                None,
            );
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_settings_invalid_toml() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "{invalid}").unwrap();

            let result = cmd_settings(None);
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("TOML 格式错误"));
        });
    }

    #[test]
    fn test_settings_new_format_masked() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[llm]\n\n[llm.providers.deepseek]\napiKey = \"sk-long-key-value-test\"\n\n[llm.providers.glm]\napiKey = \"short-key\"\n\n[llm.models]\ndefault = \"deepseek-v4-flash\"\n",
            )
            .unwrap();

            let result = cmd_settings(None);
            assert!(result.is_ok());
            let output = result.unwrap();
            assert!(output.contains("sk-***"));
            assert!(output.contains("sho***"));
        });
    }

    #[test]
    fn test_config_output() {
        let output = cmd_config().unwrap();
        assert!(output.contains("debug"));
        assert!(output.contains("logLevel"));
        assert!(output.contains("createdAt"));
    }

    #[test]
    fn test_is_leap_year() {
        assert!(is_leap(2000)); // 能被 400 整除
        assert!(!is_leap(1900)); // 能被 100 整除但不能被 400
        assert!(is_leap(2024));
        assert!(!is_leap(2023));
        assert!(!is_leap(2025));
    }

    #[test]
    fn test_chrono_now_format() {
        let now = chrono_now();
        // ISO 8601 格式: "2026-05-28T13:27:31Z"
        assert_eq!(now.len(), 20, "应为 'YYYY-MM-DDTHH:MM:SSZ' 格式");
        assert!(now.ends_with('Z'), "时间戳应以 Z 结尾: {}", now);
        assert!(now.contains('T'), "时间戳应包含 T 分隔符: {}", now);
        // 验证日期部分可解析
        let date_part = &now[..10];
        assert!(
            date_part.chars().filter(|&c| c == '-').count() == 2,
            "日期部分应为 YYYY-MM-DD: {}",
            date_part
        );
    }

    #[test]
    fn test_format_model_label_unknown() {
        let label = format_model_label("unknown-model");
        assert!(label.contains("unknown-model"));
    }

    #[test]
    fn test_format_model_label_with_context() {
        let label = format_model_label("deepseek-v4-flash");
        assert!(label.contains("deepseek-v4-flash"));
        assert!(label.contains("1M"));
    }

    #[test]
    fn test_format_model_label_glm() {
        let label = format_model_label("glm-4v");
        assert!(label.contains("glm-4v"));
        assert!(label.contains("128K"));
    }
}
