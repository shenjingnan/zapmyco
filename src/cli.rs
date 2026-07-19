/// CLI 入口 — 基于 clap 的命令行界面
use clap::builder::{PossibleValue, TypedValueParser};
use clap::{Parser, Subcommand};

use crate::commands;
use crate::config::models::{
    format_model_help, get_built_in_base_host_info, get_built_in_model_names,
};
use crate::config::settings;

use crate::datetime;
use crate::output::{self, Message};

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Parser)]
#[command(
    name = "zapmyco",
    version = VERSION,
    about = "基于 Rust 的 AI 驱动命令行工具",
    subcommand_required = true,
    arg_required_else_help = true,
    disable_help_subcommand = true,
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
}

/// 权限模式 — 限制 agent 的操作权限
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum PermissionMode {
    /// 完全权限：可读、可写、可执行（默认）
    Full,
    /// 读写模式：可读、可写，禁止执行 shell 命令
    #[clap(alias = "readwrite")]
    ReadWrite,
    /// 只读模式：只能读取和分析内容，禁止写入和执行
    #[clap(alias = "readonly")]
    ReadOnly,
}

impl std::fmt::Display for PermissionMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Full => write!(f, "full"),
            Self::ReadWrite => write!(f, "readwrite"),
            Self::ReadOnly => write!(f, "readonly"),
        }
    }
}

/// 执行模式 — 控制 agent 的执行流程
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum ExecutionMode {
    /// 计划模式：先分析规划，用户审批后执行（默认）
    Plan,
    /// 基础模式：收到 prompt 直接执行，不经过规划审批
    Base,
}

/// 自定义 value parser：Tab 补全内置模型名，但接受任意字符串（不校验）
#[derive(Clone)]
struct ModelValueParser;

impl TypedValueParser for ModelValueParser {
    type Value = String;

    fn parse_ref(
        &self,
        _cmd: &clap::Command,
        _arg: Option<&clap::Arg>,
        value: &std::ffi::OsStr,
    ) -> Result<Self::Value, clap::Error> {
        let s = value.to_string_lossy().into_owned();
        if s.is_empty() {
            return Err(clap::Error::raw(
                clap::error::ErrorKind::ValueValidation,
                "--model 不能为空",
            ));
        }
        Ok(s)
    }

    fn possible_values(&self) -> Option<Box<dyn Iterator<Item = PossibleValue>>> {
        Some(Box::new(get_built_in_model_names().into_iter().map(
            |name| {
                let mut pv = PossibleValue::new(name);
                let help = format_model_help(name);
                if !help.is_empty() {
                    pv = pv.help(help);
                }
                pv
            },
        )))
    }
}

/// 自定义 value parser：Tab 补全内置 base URL，但接受任意字符串（不校验）
#[derive(Clone)]
struct BaseUrlValueParser;

impl TypedValueParser for BaseUrlValueParser {
    type Value = String;

    fn parse_ref(
        &self,
        _cmd: &clap::Command,
        _arg: Option<&clap::Arg>,
        value: &std::ffi::OsStr,
    ) -> Result<Self::Value, clap::Error> {
        let s = value.to_string_lossy().into_owned();
        if s.is_empty() {
            return Err(clap::Error::raw(
                clap::error::ErrorKind::ValueValidation,
                "--base-url 不能为空",
            ));
        }
        // 如果没有 scheme（如 http://、https://），自动补上 https://
        let normalized = if s.contains("://") {
            s
        } else {
            format!("https://{}", s)
        };
        match url::Url::parse(&normalized) {
            Ok(parsed)
                if parsed.has_host()
                    && (parsed.scheme() == "http" || parsed.scheme() == "https") =>
            {
                Ok(normalized)
            }
            _ => Err(clap::Error::raw(
                clap::error::ErrorKind::ValueValidation,
                format!(
                    "无效的 URL: '{}'，--base-url 必须是有效的 http/https 地址",
                    normalized
                ),
            )),
        }
    }

    fn possible_values(&self) -> Option<Box<dyn Iterator<Item = PossibleValue>>> {
        Some(Box::new(get_built_in_base_host_info().into_iter().map(
            |(host, provider, region)| {
                PossibleValue::new(host).help(format!("{} · {}", provider, region))
            },
        )))
    }
}

/// 自定义 value parser：Tab 补全可用 skill 名（运行时从文件系统扫描）
#[derive(Clone)]
struct SkillNameValueParser;

impl TypedValueParser for SkillNameValueParser {
    type Value = String;

    fn parse_ref(
        &self,
        _cmd: &clap::Command,
        _arg: Option<&clap::Arg>,
        value: &std::ffi::OsStr,
    ) -> Result<Self::Value, clap::Error> {
        let s = value.to_string_lossy().into_owned();
        if s.is_empty() {
            return Err(clap::Error::raw(
                clap::error::ErrorKind::ValueValidation,
                "--skill 不能为空",
            ));
        }
        Ok(s)
    }

    fn possible_values(&self) -> Option<Box<dyn Iterator<Item = PossibleValue>>> {
        use crate::skills::discovery::list_available_skills;
        use crate::skills::types::SkillSource;
        let cwd = std::env::current_dir().ok()?;
        let skills = list_available_skills(&cwd);
        let values: Vec<PossibleValue> = skills
            .into_iter()
            .map(|s| {
                let source_label = match s.source {
                    SkillSource::Project => "项目",
                    SkillSource::ProjectAgents => "项目(.agents)",
                    SkillSource::User => "用户",
                };
                PossibleValue::new(s.name).help(format!("{} [{}]", s.description, source_label))
            })
            .collect();
        Some(Box::new(values.into_iter()))
    }
}

/// 自定义 value parser：Tab 补全历史会话 ID，按时间降序排列
#[derive(Clone)]
struct SessionIdValueParser;

impl TypedValueParser for SessionIdValueParser {
    type Value = String;

    fn parse_ref(
        &self,
        _cmd: &clap::Command,
        _arg: Option<&clap::Arg>,
        value: &std::ffi::OsStr,
    ) -> Result<Self::Value, clap::Error> {
        // 接受任意字符串（包括空字符串用于无值交互模式）
        Ok(value.to_string_lossy().into_owned())
    }

    fn possible_values(&self) -> Option<Box<dyn Iterator<Item = PossibleValue>>> {
        use crate::agent::session_loader;
        let list = session_loader::list_sessions().ok()?;
        let values: Vec<PossibleValue> = list
            .into_iter()
            .map(|c| {
                // 先解构，避免借用 + move 冲突
                let session_id = c.session_id;
                let preview = c.preview;
                let msg_count = c.message_count;
                let first_time = c.first_message_time;
                let model = c.model.as_deref().unwrap_or("?");

                let date = if first_time.len() >= 19 {
                    // ISO 8601: 2026-06-05T22:43:45+08:00 → 2026-06-05 22:43:45
                    let mut s = first_time[..19].to_string();
                    s.replace_range(10..11, " ");
                    s
                } else if first_time.len() >= 16 {
                    // ISO 8601: 2026-06-05T22:43:45+08:00 → 2026-06-05 22:43
                    let mut s = first_time[..16].to_string();
                    s.replace_range(10..11, " ");
                    s
                } else if first_time.len() >= 10 {
                    first_time[..10].to_string()
                } else {
                    first_time
                };
                let help = format!("{} | {} | {} ({}条)", date, model, preview, msg_count);
                PossibleValue::new(session_id).help(help)
            })
            .collect();
        Some(Box::new(values.into_iter()))
    }
}

#[derive(Subcommand)]
#[non_exhaustive]
pub enum Commands {
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
        /// 任务描述（当使用 --skill 时可省略）
        content: Option<String>,
        /// 引用外部 skill（对应 SKILL.md 文件，Tab 可补全可用 skill 名）
        #[arg(long, value_parser = SkillNameValueParser)]
        skill: Option<String>,
        /// 指定模型配置档
        #[arg(long)]
        profile: Option<String>,
        /// 限制 agent 的操作权限 (full/read-write/read-only)
        #[arg(long = "permission-mode", default_value = "full", value_enum)]
        permission_mode: PermissionMode,
        /// 复用指定会话的任务列表（不传则创建新会话）
        #[arg(long = "task-id")]
        task_id: Option<String>,
        /// 使用旧版 AiAgent 执行路径（默认使用 Core 层）
        #[arg(long)]
        legacy: bool,
        /// 指定 AI 模型名称（Tab 可补全内置模型名）
        #[arg(long, value_parser = ModelValueParser)]
        model: Option<String>,
        /// 指定 API Key（覆盖 settings.toml 和环境变量）
        #[arg(long = "api-key")]
        api_key: Option<String>,
        /// 指定 API 基础地址（Tab 可补全内置供应商地址）
        #[arg(long = "base-url", value_parser = BaseUrlValueParser)]
        base_url: Option<String>,
        /// 复用指定会话的上下文历史（Tab 可补全可用会话）
        #[arg(long, value_parser = SessionIdValueParser)]
        session: Option<String>,
        /// 执行模式: plan（先规划审批再执行，默认）, base（直接执行）
        #[arg(long = "mode", default_value = "plan", value_enum)]
        mode: ExecutionMode,
        /// 标记此进程为子 Agent（隐藏，由 SubAgent 工具自动传入）
        #[arg(long, hide = true)]
        subagent: bool,
        /// 父 agent 的 session_id（隐藏，由 SubAgent 工具自动传入）
        #[arg(long, hide = true)]
        parent_session_id: Option<String>,
    },
    /// 快速记录笔记 — 灵感、待办、想法
    Note {
        #[command(subcommand)]
        command: NoteCommands,
    },
    /// 使用 Core 层执行 AI 任务（实验性，Base 模式）
    CoreRun {
        /// 任务描述
        content: Option<String>,
        /// 引用外部 skill
        #[arg(long, value_parser = SkillNameValueParser)]
        skill: Option<String>,
        /// 指定模型配置档
        #[arg(long)]
        profile: Option<String>,
        /// 限制 agent 的操作权限
        #[arg(long = "permission-mode", default_value = "full", value_enum)]
        permission_mode: PermissionMode,
        /// 执行模式: plan（先规划审批再执行）, base（直接执行，默认）
        #[arg(long = "mode", default_value = "base", value_enum)]
        mode: ExecutionMode,
        /// 指定 AI 模型名称
        #[arg(long, value_parser = ModelValueParser)]
        model: Option<String>,
        /// 指定 API Key
        #[arg(long = "api-key")]
        api_key: Option<String>,
        /// 指定 API 基础地址
        #[arg(long = "base-url", value_parser = BaseUrlValueParser)]
        base_url: Option<String>,
    },
    /// 将 zapmyco 升级到最新版本
    Upgrade,
    /// 启动 TUI 聊天演示界面（基于 ratatui，支持多行输入）
    Demo {
        /// 指定模型配置档
        #[arg(long)]
        profile: Option<String>,
        /// 指定 AI 模型名称（Tab 可补全内置模型名）
        #[arg(long, value_parser = ModelValueParser)]
        model: Option<String>,
        /// 指定 API Key（覆盖 settings.toml 和环境变量）
        #[arg(long = "api-key")]
        api_key: Option<String>,
        /// 指定 API 基础地址（Tab 可补全内置供应商地址）
        #[arg(long = "base-url", value_parser = BaseUrlValueParser)]
        base_url: Option<String>,
    },
    /// 启动 Web UI 服务器
    Web {
        /// 监听端口（默认 8080）
        #[arg(long, default_value = "8080")]
        port: u16,
        /// 监听地址（默认 127.0.0.1）
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        /// Web 认证 Token（不传则自动生成并打印，也可在 settings.toml 中配置）
        #[arg(long)]
        auth_token: Option<String>,
    },
    /// 生成 shell 补全脚本
    #[command(hide = true)]
    Completion {
        /// Shell 类型：bash、zsh、fish、powershell、elvish
        #[arg(value_enum)]
        shell: clap_complete::Shell,
    },
}

/// note 子命令
#[derive(Subcommand)]
#[non_exhaustive]
pub enum NoteCommands {
    /// 创建笔记（留空则使用编辑器交互输入）
    Add {
        /// 笔记内容
        content: Vec<String>,
    },
    /// 列出笔记
    Ls {
        /// 显示所有笔记
        #[arg(long, short)]
        all: bool,
        /// 显示数量
        limit: Option<usize>,
    },
    /// 查看笔记内容
    Show {
        /// 笔记 ID
        id: String,
    },
    /// 搜索笔记
    Grep {
        /// 搜索关键词
        keyword: String,
    },
    /// 删除笔记
    Rm {
        /// 笔记 ID
        id: String,
    },
}

/// 显示设置文件路径
fn settings_path() -> String {
    settings::get_settings_path().to_string_lossy().to_string()
}

/// config 命令
fn cmd_config() -> Result<String, String> {
    let config = serde_json::json!({
        "debug": false,
        "logLevel": "info",
        "createdAt": datetime::iso_timestamp_now()
    });
    Ok(serde_json::to_string_pretty(&config).unwrap_or_default())
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

/// 将命令行参数中的 "-v" 映射到 "--version"
///
/// clap 默认使用 -V（大写）作为 version 的短标志，
/// 这里将小写 -v 也映射为 --version 以提升用户体验。
pub fn map_short_v_flag(args: &[String]) -> Vec<String> {
    args.iter()
        .map(|a| {
            if a == "-v" {
                "--version".into()
            } else {
                a.clone()
            }
        })
        .collect()
}

/// CLI 入口 - 解析参数并执行对应操作
pub async fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Some(Commands::Config) => {
            let output = cmd_config()?;
            output::send(&Message::result_block(output));
            Ok(())
        }
        Some(Commands::Init) => {
            let output = commands::init::cmd_init()?;
            if !output.is_empty() {
                output::send(&Message::result_block(output));
            }
            Ok(())
        }
        Some(Commands::Settings { subcommand }) => {
            let output = cmd_settings(subcommand.as_deref())?;
            output::send(&Message::result_block(output));
            Ok(())
        }
        Some(Commands::Uninstall) => commands::uninstall::cmd_uninstall(),
        Some(Commands::Note { command }) => commands::note::cmd_note(command),
        Some(Commands::Run {
            content,
            skill,
            profile,
            permission_mode,
            task_id,
            session,
            mode,
            model,
            api_key,
            base_url,
            subagent,
            parent_session_id,
            legacy,
        }) => {
            if legacy {
                commands::run::cmd_run(
                    content.as_deref(),
                    skill.as_deref(),
                    profile.as_deref(),
                    permission_mode,
                    task_id.as_deref(),
                    session.as_deref(),
                    mode,
                    model.as_deref(),
                    api_key.as_deref(),
                    base_url.as_deref(),
                    subagent,
                    parent_session_id.as_deref(),
                )
                .await
            } else {
                commands::core_run::cmd_core_run(
                    content.as_deref(),
                    skill.as_deref(),
                    profile.as_deref(),
                    permission_mode,
                    mode,
                    model.as_deref(),
                    api_key.as_deref(),
                    base_url.as_deref(),
                )
                .await
            }
        }
        Some(Commands::CoreRun {
            content,
            skill,
            profile,
            permission_mode,
            mode,
            model,
            api_key,
            base_url,
        }) => {
            commands::core_run::cmd_core_run(
                content.as_deref(),
                skill.as_deref(),
                profile.as_deref(),
                permission_mode,
                mode,
                model.as_deref(),
                api_key.as_deref(),
                base_url.as_deref(),
            )
            .await
        }
        Some(Commands::Upgrade) => commands::upgrade::cmd_upgrade().await,
        Some(Commands::Web {
            port,
            host,
            auth_token,
        }) => commands::web::cmd_web(port, host, auth_token.as_deref()).await,
        Some(Commands::Demo {
            profile,
            model,
            api_key,
            base_url,
        }) => {
            commands::demo::cmd_demo(
                profile.as_deref(),
                model.as_deref(),
                api_key.as_deref(),
                base_url.as_deref(),
            )
            .await
        }
        Some(Commands::Completion { shell }) => {
            crate::commands::completion::cmd_completion(shell, &mut std::io::stdout());
            Ok(())
        }
        // subcommand_required = true 时，此处不可达
        None => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{completion, init, uninstall};
    use crate::test_util::run_with_temp_home;

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

    #[test]
    fn test_settings_path_subcommand() {
        let result = cmd_settings(Some("path"));
        assert!(result.is_ok());
        assert!(result.unwrap().ends_with(".zapmyco/settings.toml"));
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
    fn test_settings_show_subcommand() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[llm]\n\n[llm.models]\ndefault = \"deepseek-v4-flash\"\n",
            )
            .unwrap();

            let show_result = cmd_settings(Some("show"));
            let none_result = cmd_settings(None);
            assert!(show_result.is_ok());
            assert!(none_result.is_ok());
            assert_eq!(show_result.unwrap(), none_result.unwrap());
        });
    }

    fn test_config_output() {
        let output = cmd_config().unwrap();
        let val: serde_json::Value = serde_json::from_str(&output).unwrap();
        assert_eq!(val["debug"], serde_json::Value::Bool(false));
        assert_eq!(
            val["logLevel"],
            serde_json::Value::String("info".to_string())
        );
        let created = val["createdAt"].as_str().unwrap();
        assert!(
            created.len() >= 24,
            "时间戳长度至少 24（含时区偏移）: {}",
            created
        );
        assert!(created.contains('T'), "时间戳应包含 T 分隔符");
        // 应包含时区偏移（+/- 开头的时间偏移段）
        let offset_start = created.rfind(|c: char| c == '+' || c == '-');
        assert!(
            offset_start.is_some() && offset_start.unwrap() > 10,
            "时间戳应包含时区偏移（如 +08:00）: {}",
            created
        );
        // 确保只有 3 个字段
        assert_eq!(val.as_object().unwrap().len(), 3, "config 应只有 3 个字段");
    }

    #[test]
    fn test_chrono_now_format() {
        let now = datetime::iso_timestamp_now();
        // ISO 8601 格式（本地时区）: "2026-05-29T22:25:15+08:00"
        assert!(now.len() >= 24, "时间戳长度至少 24（含时区偏移）: {}", now);
        assert!(now.contains('T'), "时间戳应包含 T 分隔符: {}", now);
        // 应包含时区偏移（+/- 开头的时间偏移段）
        let offset_start = now.rfind(|c: char| c == '+' || c == '-');
        assert!(
            offset_start.is_some() && offset_start.unwrap() > 10,
            "时间戳应包含时区偏移（如 +08:00）: {}",
            now
        );
        // 验证日期部分可解析
        let date_part = &now[..10];
        assert!(
            date_part.chars().filter(|&c| c == '-').count() == 2,
            "日期部分应为 YYYY-MM-DD: {}",
            date_part
        );
    }

    // —————— cmd_note 命令测试 ——————
    #[test]
    fn test_cmd_note_add_and_list() {
        run_with_temp_home(|_home| {
            commands::note::cmd_note(NoteCommands::Add {
                content: vec!["测试笔记".to_string()],
            })
            .expect("创建笔记应成功");

            let result = commands::note::cmd_note(NoteCommands::Ls {
                limit: Some(10),
                all: false,
            });
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_cmd_note_list_empty() {
        run_with_temp_home(|_home| {
            let result = commands::note::cmd_note(NoteCommands::Ls {
                limit: Some(10),
                all: false,
            });
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_cmd_note_show_and_grep_and_rm() {
        run_with_temp_home(|_home| {
            commands::note::cmd_note(NoteCommands::Add {
                content: vec!["可搜索的内容".to_string()],
            })
            .expect("创建笔记应成功");

            let grep_result = commands::note::cmd_note(NoteCommands::Grep {
                keyword: "可搜索".to_string(),
            });
            assert!(grep_result.is_ok(), "grep 应成功");

            let grep_empty = commands::note::cmd_note(NoteCommands::Grep {
                keyword: "不存在的内容".to_string(),
            });
            assert!(grep_empty.is_ok(), "grep 无结果也应成功");

            let entries = crate::notes::NotesDir::new()
                .unwrap()
                .list(10, false)
                .unwrap();
            assert!(!entries.is_empty(), "至少有一条笔记");
            let note_id = entries[0].id.clone();

            let show_result = commands::note::cmd_note(NoteCommands::Show {
                id: note_id.clone(),
            });
            assert!(show_result.is_ok(), "查看笔记应成功");

            let show_nonexistent = commands::note::cmd_note(NoteCommands::Show {
                id: "nonexistent-id".to_string(),
            });
            assert!(show_nonexistent.is_err(), "查看不存在的笔记应失败");

            let rm_result = commands::note::cmd_note(NoteCommands::Rm {
                id: note_id.clone(),
            });
            assert!(rm_result.is_ok(), "删除笔记应成功");

            let rm_nonexistent = commands::note::cmd_note(NoteCommands::Rm { id: note_id });
            assert!(rm_nonexistent.is_err(), "删除不存在的笔记应失败");
        });
    }

    #[test]
    fn test_cmd_note_list_all() {
        run_with_temp_home(|_home| {
            commands::note::cmd_note(NoteCommands::Add {
                content: vec!["笔记1".to_string()],
            })
            .expect("创建笔记1应成功");
            commands::note::cmd_note(NoteCommands::Add {
                content: vec!["笔记2".to_string()],
            })
            .expect("创建笔记2应成功");

            let entries = crate::notes::NotesDir::new()
                .unwrap()
                .list(10, true)
                .unwrap();
            assert_eq!(entries.len(), 2, "应该有两篇笔记");
        });
    }

    // —————— note 命令输出验证 ——————

    /// 辅助函数：注册 CollectTarget 到全局 ROUTER 并在测试结束后清理
    fn with_note_collector<F>(test: F)
    where
        F: FnOnce(std::sync::Arc<output::test_util::CollectTarget>),
    {
        let collector = std::sync::Arc::new(output::test_util::CollectTarget::new("note_test"));
        output::ROUTER.add_target(Box::new(collector.clone()));
        test(collector.clone());
        output::ROUTER.remove_target("note_test");
    }

    #[test]
    fn test_note_add_multiple_content() {
        run_with_temp_home(|_home| {
            commands::note::cmd_note(NoteCommands::Add {
                content: vec!["hello".to_string(), "world".to_string()],
            })
            .expect("多值合并创建笔记应成功");

            let result = commands::note::cmd_note(NoteCommands::Ls {
                limit: Some(10),
                all: false,
            });
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_note_show_with_frontmatter() {
        run_with_temp_home(|_home| {
            with_note_collector(|collector| {
                commands::note::cmd_note(NoteCommands::Add {
                    content: vec!["hello world".to_string()],
                })
                .expect("创建笔记应成功");

                let entries = crate::notes::NotesDir::new()
                    .unwrap()
                    .list(10, false)
                    .unwrap();
                let id = entries[0].id.clone();

                commands::note::cmd_note(NoteCommands::Show { id }).expect("查看笔记应成功");

                let msgs = collector.messages();
                let show_msg = msgs
                    .iter()
                    .find(|m| m.kind == output::MessageKind::ResultBlock)
                    .expect("应有 ResultBlock 消息");
                assert_eq!(
                    show_msg.text.trim(),
                    "hello world",
                    "frontmatter 应被剥离，输出只含正文"
                );
            });
        });
    }

    #[test]
    fn test_note_show_no_frontmatter() {
        run_with_temp_home(|_home| {
            with_note_collector(|collector| {
                // 直接写入一个无 frontmatter 的 markdown 文件
                let notes_dir = crate::config::settings::get_settings_dir().join("notes");
                std::fs::create_dir_all(&notes_dir).expect("创建笔记目录应成功");
                let file_path = notes_dir.join("no_frontmatter_note.md");
                let raw_content = "这是没有 frontmatter 的笔记正文";
                std::fs::write(&file_path, raw_content).expect("写入笔记文件应成功");

                // 使用文件名（不含 .md）作为 id
                let id = "no_frontmatter_note".to_string();
                commands::note::cmd_note(NoteCommands::Show { id }).expect("查看笔记应成功");

                let msgs = collector.messages();
                let show_msg = msgs
                    .iter()
                    .find(|m| m.kind == output::MessageKind::ResultBlock)
                    .expect("应有 ResultBlock 消息");
                assert_eq!(
                    show_msg.text.trim(),
                    raw_content,
                    "无 frontmatter 时应原样输出正文"
                );
            });
        });
    }

    #[test]
    fn test_note_show_empty_body() {
        run_with_temp_home(|_home| {
            with_note_collector(|collector| {
                // 创建一个只有 frontmatter、没有正文的笔记
                let notes_dir = crate::config::settings::get_settings_dir().join("notes");
                std::fs::create_dir_all(&notes_dir).expect("创建笔记目录应成功");
                let file_path = notes_dir.join("empty_body.md");
                let content = "---\ncreated: 2024-01-01T00:00:00+00:00\n---\n";
                std::fs::write(&file_path, content).expect("写入笔记文件应成功");

                let id = "empty_body".to_string();
                commands::note::cmd_note(NoteCommands::Show { id }).expect("查看笔记应成功");

                let msgs = collector.messages();
                let show_msg = msgs
                    .iter()
                    .find(|m| m.kind == output::MessageKind::ResultBlock)
                    .expect("应有 ResultBlock 消息");
                assert!(
                    show_msg.text.trim().is_empty(),
                    "frontmatter 后无正文时应输出空字符串"
                );
            });
        });
    }

    // —————— PermissionMode 测试 ——————

    #[test]
    fn test_permission_mode_default() {
        // PermissionMode 默认值由 clap 处理，验证枚举值存在
        assert_ne!(PermissionMode::Full as u8, PermissionMode::ReadWrite as u8);
        assert_ne!(PermissionMode::Full as u8, PermissionMode::ReadOnly as u8);
        assert_ne!(
            PermissionMode::ReadWrite as u8,
            PermissionMode::ReadOnly as u8
        );
    }

    #[test]
    fn test_permission_mode_equality() {
        assert_eq!(PermissionMode::Full, PermissionMode::Full);
        assert_eq!(PermissionMode::ReadOnly, PermissionMode::ReadOnly);
        assert_eq!(PermissionMode::ReadWrite, PermissionMode::ReadWrite);
        assert_ne!(PermissionMode::Full, PermissionMode::ReadOnly);
        assert_ne!(PermissionMode::ReadWrite, PermissionMode::Full);
    }

    #[test]
    fn test_permission_mode_clap_parse_full() {
        let cli = Cli::try_parse_from(vec!["zapmyco", "run", "hello"]).unwrap();
        if let Commands::Run {
            permission_mode, ..
        } = cli.command.unwrap()
        {
            assert_eq!(permission_mode, PermissionMode::Full);
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_permission_mode_clap_parse_readonly() {
        let cli = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--permission-mode",
            "readonly",
            "hello",
        ])
        .unwrap();
        if let Commands::Run {
            permission_mode, ..
        } = cli.command.unwrap()
        {
            assert_eq!(permission_mode, PermissionMode::ReadOnly);
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_permission_mode_clap_parse_read_only() {
        let cli = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--permission-mode",
            "read-only",
            "hello",
        ])
        .unwrap();
        if let Commands::Run {
            permission_mode, ..
        } = cli.command.unwrap()
        {
            assert_eq!(permission_mode, PermissionMode::ReadOnly);
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_permission_mode_clap_parse_readwrite() {
        let cli = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--permission-mode",
            "readwrite",
            "hello",
        ])
        .unwrap();
        if let Commands::Run {
            permission_mode, ..
        } = cli.command.unwrap()
        {
            assert_eq!(permission_mode, PermissionMode::ReadWrite);
        } else {
            panic!("Expected Run command");
        }
    }

    // —————— task-id 测试 ——————

    fn test_task_id_default_none() {
        let cli = Cli::try_parse_from(vec!["zapmyco", "run", "hello"]).unwrap();
        if let Commands::Run { task_id, .. } = cli.command.unwrap() {
            assert!(task_id.is_none(), "默认 task_id 应为 None");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_task_id_with_value() {
        let cli = Cli::try_parse_from(vec!["zapmyco", "run", "--task-id", "my-session", "hello"])
            .unwrap();
        if let Commands::Run { task_id, .. } = cli.command.unwrap() {
            assert_eq!(task_id.unwrap(), "my-session");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_model_flag() {
        let cli = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--model",
            "deepseek-v4-flash",
            "hello",
        ])
        .unwrap();
        if let Commands::Run { model, .. } = cli.command.unwrap() {
            assert_eq!(model.unwrap(), "deepseek-v4-flash");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_api_key_flag() {
        let cli =
            Cli::try_parse_from(vec!["zapmyco", "run", "--api-key", "sk-test", "hello"]).unwrap();
        if let Commands::Run { api_key, .. } = cli.command.unwrap() {
            assert_eq!(api_key.unwrap(), "sk-test");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_base_url_flag() {
        let cli = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--base-url",
            "https://custom.example.com",
            "hello",
        ])
        .unwrap();
        if let Commands::Run { base_url, .. } = cli.command.unwrap() {
            assert_eq!(base_url.unwrap(), "https://custom.example.com");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_model_flag_accepts_custom_name() {
        // TypedValueParser 应接受非内置模型名
        let cli = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--model",
            "my-custom-model",
            "hello",
        ])
        .unwrap();
        if let Commands::Run { model, .. } = cli.command.unwrap() {
            assert_eq!(model.unwrap(), "my-custom-model");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_model_default_none() {
        let cli = Cli::try_parse_from(vec!["zapmyco", "run", "hello"]).unwrap();
        if let Commands::Run {
            model,
            api_key,
            base_url,
            ..
        } = cli.command.unwrap()
        {
            assert!(model.is_none());
            assert!(api_key.is_none());
            assert!(base_url.is_none());
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_base_url_auto_prepend_https() {
        let cli = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--base-url",
            "api.deepseek.com/anthropic",
            "hello",
        ])
        .unwrap();
        if let Commands::Run { base_url, .. } = cli.command.unwrap() {
            assert_eq!(base_url.unwrap(), "https://api.deepseek.com/anthropic");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_base_url_auto_prepend_https_not_a_url() {
        // 不含 scheme 时自动补 https://，not-a-url 变成合法主机名
        let cli = Cli::try_parse_from(vec!["zapmyco", "run", "--base-url", "not-a-url", "hello"])
            .unwrap();
        if let Commands::Run { base_url, .. } = cli.command.unwrap() {
            assert_eq!(base_url.unwrap(), "https://not-a-url");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_base_url_accepts_http() {
        let cli = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--base-url",
            "http://localhost:8080",
            "hello",
        ])
        .unwrap();
        if let Commands::Run { base_url, .. } = cli.command.unwrap() {
            assert_eq!(base_url.unwrap(), "http://localhost:8080");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_base_url_rejects_invalid() {
        // 即使自动补上 https://，也不是合法 URL
        let result = Cli::try_parse_from(vec!["zapmyco", "run", "--base-url", "://", "hello"]);
        assert!(result.is_err());
    }

    #[test]
    fn test_base_url_rejects_empty() {
        let result = Cli::try_parse_from(vec!["zapmyco", "run", "--base-url", "", "hello"]);
        assert!(result.is_err());
    }

    #[test]
    fn test_base_url_accepts_with_path() {
        // 最常见的真实使用场景：base URL 包含路径
        let cli = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--base-url",
            "https://api.deepseek.com/anthropic",
            "hello",
        ])
        .unwrap();
        if let Commands::Run { base_url, .. } = cli.command.unwrap() {
            assert_eq!(base_url.unwrap(), "https://api.deepseek.com/anthropic");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_base_url_accepts_ip_address() {
        // 本地开发常用 IP + 端口
        let cli = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--base-url",
            "http://127.0.0.1:11434",
            "hello",
        ])
        .unwrap();
        if let Commands::Run { base_url, .. } = cli.command.unwrap() {
            assert_eq!(base_url.unwrap(), "http://127.0.0.1:11434");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_base_url_rejects_ftp() {
        // 非 http/https 协议应拒绝
        let result = Cli::try_parse_from(vec![
            "zapmyco",
            "run",
            "--base-url",
            "ftp://example.com",
            "hello",
        ]);
        assert!(result.is_err());
    }

    #[test]
    fn test_base_url_rejects_scheme_only() {
        // 只有协议没有 host 应拒绝
        let result = Cli::try_parse_from(vec!["zapmyco", "run", "--base-url", "https://", "hello"]);
        assert!(result.is_err());
    }

    #[test]
    fn test_model_flag_rejects_empty() {
        let result = Cli::try_parse_from(vec!["zapmyco", "run", "--model", "", "hello"]);
        assert!(result.is_err());
    }

    // —————— map_short_v_flag 测试 ——————

    #[test]
    fn test_map_short_v_flag() {
        let args = vec!["program".to_string(), "-v".to_string()];
        let result = map_short_v_flag(&args);
        assert_eq!(result, vec!["program".to_string(), "--version".to_string()]);
    }

    #[test]
    fn test_map_short_v_flag_other_flags_unchanged() {
        let args = vec![
            "program".to_string(),
            "--verbose".to_string(),
            "run".to_string(),
            "-c".to_string(),
        ];
        let result = map_short_v_flag(&args);
        assert_eq!(result, args);
    }

    #[test]
    fn test_map_short_v_flag_empty() {
        let args: Vec<String> = vec![];
        let result = map_short_v_flag(&args);
        assert!(result.is_empty());
    }

    // ---- 4. SubAgent 条件注册 ----

    #[test]
    fn test_run_args_subagent_default_false() {
        let cli = Cli::try_parse_from(vec!["zapmyco", "run", "task"]).unwrap();
        if let Commands::Run { subagent, .. } = cli.command.unwrap() {
            assert!(!subagent, "默认 --subagent 应为 false");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_run_args_subagent_flag() {
        let cli = Cli::try_parse_from(vec!["zapmyco", "run", "--subagent", "task"]).unwrap();
        if let Commands::Run { subagent, .. } = cli.command.unwrap() {
            assert!(subagent, "--subagent 应被解析为 true");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_run_args_subagent_is_hidden() {
        // --subagent 是隐藏参数，不会出现在 help 中
        use clap::CommandFactory;
        let cmd = Cli::command();
        let run_cmd = cmd
            .get_subcommands()
            .find(|c| c.get_name() == "run")
            .expect("run subcommand should exist");
        let help = run_cmd.clone().render_help().to_string();
        assert!(!help.contains("--subagent"), "隐藏参数不应出现在 help 中");
    }

    // test_cmd_run_skips_subagent_tool_when_subagent_flag:
    // 验证 --subagent 时跳过 SubAgent 工具注册
    // 需要创建 settings.toml + mock LLM，属于端到端集成测试
    //
    // test_cmd_run_registers_subagent_tool_by_default:
    // 验证没有 --subagent 时 SubAgent 工具已注册
    // 同上，需要完整 LLM 环境

    // ---- 5. --mode 参数测试 ----

    #[test]
    fn test_run_args_mode_default_plan() {
        let cli = Cli::try_parse_from(vec!["zapmyco", "run", "hello"]).unwrap();
        if let Commands::Run { mode, .. } = cli.command.unwrap() {
            assert_eq!(mode, ExecutionMode::Plan, "默认 --mode 应为 plan");
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_run_args_mode_plan() {
        let cli = Cli::try_parse_from(vec!["zapmyco", "run", "--mode", "plan", "hello"]).unwrap();
        if let Commands::Run { mode, .. } = cli.command.unwrap() {
            assert_eq!(mode, ExecutionMode::Plan);
        } else {
            panic!("Expected Run command");
        }
    }

    #[test]
    fn test_run_args_mode_base() {
        let cli = Cli::try_parse_from(vec!["zapmyco", "run", "--mode", "base", "hello"]).unwrap();
        if let Commands::Run { mode, .. } = cli.command.unwrap() {
            assert_eq!(mode, ExecutionMode::Base);
        } else {
            panic!("Expected Run command");
        }
    }

    // ==================== --parent-session-id 测试 ====================

    #[test]
    fn test_cli_parent_session_id() {
        let cli = Cli::try_parse_from(&[
            "zapmyco",
            "run",
            "--subagent",
            "--parent-session-id",
            "parent-123",
            "do task",
        ])
        .unwrap();
        match cli.command.unwrap() {
            Commands::Run {
                parent_session_id, ..
            } => {
                assert_eq!(parent_session_id.unwrap(), "parent-123");
            }
            _ => panic!("Expected Run command"),
        }
    }
}
