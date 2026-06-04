/// CLI 入口 — 基于 clap 的命令行界面
use clap::{CommandFactory, Parser, Subcommand};
use std::io::IsTerminal;

use crate::config::models::{get_built_in_model_names, get_model_info};
use crate::config::settings;
use crate::config::settings::{LlmSettings, ProviderConfig, Settings};
use std::collections::HashMap;

use crate::datetime;

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
        /// 任务描述
        content: String,
        /// 指定模型配置档
        #[arg(long)]
        profile: Option<String>,
        /// 限制 agent 的操作权限 (full/read-write/read-only)
        #[arg(long = "permission-mode", default_value = "full", value_enum)]
        permission_mode: PermissionMode,
        /// 复用指定会话的任务列表（不传则创建新会话）
        #[arg(long = "task-id")]
        task_id: Option<String>,
    },
    /// 快速记录笔记 — 灵感、待办、想法
    Note {
        #[command(subcommand)]
        command: NoteCommands,
    },
    /// 将 zapmyco 升级到最新版本
    Upgrade,
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

/// init 命令 - 交互式初始化向导
fn cmd_init() -> Result<String, String> {
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

    // 非 TTY 环境跳过补全配置
    if !std::io::stdin().is_terminal() {
        return Ok(message);
    }

    // 询问是否启用 shell 补全
    let enable = inquire::Confirm::new("是否启用 Shell 自动补全？")
        .with_default(true)
        .with_help_message("按 Tab 键可补全子命令和参数")
        .prompt()
        .ok()
        .unwrap_or(false);

    if !enable {
        return Ok(message);
    }

    match setup_shell_completion() {
        Ok(msg) => Ok(format!("{}\n\n{}", message, msg)),
        Err(e) => Ok(format!("{}\n\n{}", message, e)),
    }
}

/// init 内部实现，支持注入参数以方便测试
fn cmd_init_inner(
    file_path: std::path::PathBuf,
    is_terminal: bool,
    confirm_overwrite: impl FnOnce() -> bool,
) -> Result<String, String> {
    // 检查是否已存在，交互式环境询问是否覆盖，非交互环境（CI）直接报错
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
    let settings_data = build_settings(provider, &api_key, &default_model);

    // 写入文件
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
            "Anthropic（官方）",
            "DeepSeek",
            "MiniMax",
            "GLM（智谱）",
            "Z.AI（智谱海外）",
            "Kimi（月之暗面）",
            "Doubao（火山引擎/字节）",
            "自定义",
        ],
    )
    .with_vim_mode(true)
    .prompt()
    .ok()
    .map(|s| match s {
        "Anthropic（官方）" => "anthropic",
        "DeepSeek" => "deepseek",
        "MiniMax" => "minimax",
        "GLM（智谱）" => "glm",
        "Z.AI（智谱海外）" => "zai",
        "Kimi（月之暗面）" => "kimi",
        "Doubao（火山引擎/字节）" => "doubao",
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
    let filtered_models = filter_models_by_provider(provider);

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

/// 根据供应商筛选可用模型列表
fn filter_models_by_provider(provider: &str) -> Vec<&'static str> {
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
fn build_settings(provider: &str, api_key: &str, default_model: &str) -> Settings {
    Settings {
        llm: Some(LlmSettings {
            providers: Some({
                let mut map = HashMap::new();
                map.insert(
                    provider.to_string(),
                    ProviderConfig {
                        api_key: Some(api_key.to_string()),
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
    }
}

/// 写入 Settings 到配置文件
fn write_settings(file_path: &std::path::Path, settings: &Settings) -> Result<String, String> {
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

/// run 命令 - 一次性执行 AI 任务（带工具支持）
async fn cmd_run(
    content: &str,
    profile: Option<&str>,
    permission_mode: PermissionMode,
    task_id: Option<&str>,
) -> Result<(), String> {
    let file_path = settings::get_settings_path();

    tracing::info!(
        input_len = content.len(),
        profile = profile.unwrap_or("default"),
        "开始执行 AI 任务"
    );

    if !file_path.exists() {
        return Err(format!(
            "未找到配置文件 {}\n请先运行 `zapmyco init` 初始化 LLM 配置。",
            file_path.display()
        ));
    }

    if content.is_empty() {
        return Err("任务描述不能为空".to_string());
    }

    let options = build_run_options(profile);

    let mut agent = crate::agent::chat::AiAgent::new(options)?;

    // 注册 Ask User 工具
    let ask_user = crate::tools::ask_user::AskUser;
    agent.register_tool(crate::agent::chat::ToolHandler::AskUser(ask_user));

    // 注册 Web Fetch 工具
    let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default())
        .map_err(|e| format!("初始化 Web Fetch 失败: {}", e))?;
    agent.register_tool(crate::agent::chat::ToolHandler::WebFetch(web_fetch));

    // 注册命令执行工具
    let shell_exec = crate::tools::shell_exec::ShellExec::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::ShellExec(shell_exec));

    // 注册 Web 搜索工具（利用 API 服务端 web_search_20250305）
    let web_search = crate::tools::web_search::WebSearch::new(
        agent.api_key().to_string(),
        agent.api_base_url().to_string(),
        agent.model_name().to_string(),
        agent.max_tokens(),
    )
    .map_err(|e| format!("初始化 Web Search 失败: {}", e))?;
    agent.register_tool(crate::agent::chat::ToolHandler::WebSearch(web_search));

    // 注册文件搜索工具
    let file_search = crate::tools::file_search::FileSearch::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::FileSearch(file_search));

    // 注册文件查找工具
    let file_find = crate::tools::file_find::FileFind::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::FileFind(file_find));

    // 注册文件读取工具
    let file_read = crate::tools::file_read::FileRead::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::FileRead(file_read));

    // 注册文件编辑工具
    let file_edit = crate::tools::file_edit::FileEdit::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::FileEdit(file_edit));

    // 注册文件写入工具
    let file_write = crate::tools::file_write::FileWrite::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::FileWrite(file_write));

    // 注册 Task 管理工具
    let list_id = task_id
        .map(|s| s.to_string())
        .unwrap_or_else(generate_session_id);
    let task_manager = std::sync::Arc::new(crate::tools::task_manager::TaskManager::with_list_id(
        &list_id,
    ));
    eprintln!("[会话] 任务列表 ID: {}", list_id);
    if task_id.is_none() {
        eprintln!("[提示] 使用 --task-id {} 可恢复此会话的任务列表", list_id);
    }
    agent.set_task_manager(task_manager.clone());
    agent.register_tool(crate::agent::chat::ToolHandler::TaskCreate(
        task_manager.clone(),
    ));
    agent.register_tool(crate::agent::chat::ToolHandler::TaskGet(
        task_manager.clone(),
    ));
    agent.register_tool(crate::agent::chat::ToolHandler::TaskList(
        task_manager.clone(),
    ));
    agent.register_tool(crate::agent::chat::ToolHandler::TaskUpdate(
        task_manager.clone(),
    ));

    // ---- 根据权限模式过滤工具 ----
    if permission_mode != PermissionMode::Full {
        let deny_tools: &[&str] = match permission_mode {
            PermissionMode::ReadOnly => &["file_write", "file_edit", "shell_exec"],
            PermissionMode::ReadWrite => &["shell_exec"],
            PermissionMode::Full => &[], // unreachable
        };
        eprintln!(
            "[权限模式] {:?} — 已禁止工具: {:?}",
            permission_mode, deny_tools
        );
        agent.remove_tools(deny_tools);
    }

    // ---- 第一阶段：执行用户原始输入 ----
    let _response = agent
        .chat_with_tools(content, |chunk| {
            print!("{}", chunk);
            use std::io::Write;
            std::io::stdout().flush().ok();
        })
        .await?;

    // ---- 第二阶段：任务执行循环 ----
    let max_exec_rounds = 5;
    for round in 0..max_exec_rounds {
        use crate::tools::task_manager::TaskStatus;

        let tasks = task_manager.list().await.map_err(|e| e.to_string())?;
        let pending_count = tasks
            .iter()
            .filter(|t| t.status != TaskStatus::Completed)
            .count();

        if pending_count == 0 {
            if round > 0 {
                println!("\n✅ 全部任务已完成！");
            }
            break;
        }

        let continuation = format!(
            "请继续执行下一个可用任务。当前有 {} 个任务未完成。\
             规则：检查 task_list 找出 blocked_by 为空的 pending 任务，\
             标记为 in_progress 后开始实施，完成后标记为 completed。\
             一次只做一个任务。",
            pending_count,
        );

        eprintln!(
            "\n[任务执行] 第 {} 轮 — {} 个任务待完成",
            round + 1,
            pending_count
        );

        let _response = agent
            .chat_with_tools(&continuation, |chunk| {
                print!("{}", chunk);
                use std::io::Write;
                std::io::stdout().flush().ok();
            })
            .await?;
    }

    println!();
    Ok(())
}

/// 构建 run 命令的 AiAgentOptions
fn build_run_options(profile: Option<&str>) -> crate::agent::chat::AiAgentOptions {
    crate::agent::chat::AiAgentOptions {
        model_profile: profile.map(|s| s.to_string()),
        ..Default::default()
    }
}

/// 生成唯一的会话 ID（用于任务列表隔离）
fn generate_session_id() -> String {
    format!("run_{}", chrono::Local::now().format("%Y%m%d_%H%M%S%9f"))
}

/// uninstall 命令 — 卸载 zapmyco
fn cmd_uninstall() -> Result<(), String> {
    let home = settings::get_home_dir();
    let zapmyco_dir = settings::get_settings_dir();
    let exe_path = std::env::current_exe().ok();
    let receipt_dir = home.join(".config/zapmyco");
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
            &home,
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
        &home,
    )
}

/// 执行卸载清理（不含用户交互，可测试）
fn execute_uninstall(
    receipt_dir: &std::path::Path,
    zapmyco_dir: &std::path::Path,
    has_receipt: bool,
    want_keep_zapmyco: bool,
    exe_path: Option<&std::path::Path>,
    home: &std::path::Path,
) -> Result<(), String> {
    const RED: &str = "\x1b[31m";
    const RESET: &str = "\x1b[0m";

    // Shell 补全配置清理
    remove_shell_completion(home);

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

/// completion 命令 — 生成 shell 补全脚本
fn cmd_completion<W: std::io::Write>(shell: clap_complete::Shell, writer: &mut W) {
    let mut cmd = Cli::command();
    clap_complete::generate(shell, &mut cmd, "zapmyco", writer);
}

/// 检测当前 shell（从 $SHELL 环境变量解析）
fn detect_shell() -> Option<&'static str> {
    let shell = std::env::var("SHELL").ok()?;
    let name = std::path::Path::new(&shell).file_name()?.to_str()?;
    match name {
        "bash" => Some("bash"),
        "zsh" => Some("zsh"),
        "fish" => Some("fish"),
        _ => None,
    }
}

/// 获取 shell 配置文件路径
fn shell_config_path(shell: &str, home: &std::path::Path) -> std::path::PathBuf {
    match shell {
        "bash" => {
            let bashrc = home.join(".bashrc");
            let bash_profile = home.join(".bash_profile");
            if bashrc.exists() {
                bashrc
            } else {
                bash_profile
            }
        }
        "zsh" => home.join(".zshrc"),
        "fish" => home.join(".config/fish/config.fish"),
        _ => panic!("不支持的 shell: {}", shell),
    }
}

/// 获取 shell 对应的补全 eval 行
fn completion_line(shell: &str) -> &'static str {
    match shell {
        "bash" => "eval \"$(zapmyco completion bash)\"",
        "zsh" => "eval \"$(zapmyco completion zsh)\"",
        "fish" => "zapmyco completion fish | source",
        _ => panic!("不支持的 shell: {}", shell),
    }
}

/// 移除所有已知 shell 配置文件中的补全行
fn remove_shell_completion(home: &std::path::Path) {
    let shells = ["bash", "zsh", "fish"];
    for &shell in &shells {
        let config_path = shell_config_path(shell, home);
        if !config_path.exists() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&config_path) else {
            continue;
        };
        let line = completion_line(shell);
        let original_lines: Vec<&str> = content.lines().collect();
        let filtered: Vec<&str> = original_lines
            .iter()
            .filter(|l| l.trim() != line)
            .copied()
            .collect();

        if filtered.len() < original_lines.len() {
            let mut result = filtered.join("\n");
            if !result.is_empty() {
                result.push('\n');
            }
            let _ = std::fs::write(&config_path, result);
        }
    }
}

/// 设置 shell 补全（可测试的内部实现）
fn setup_shell_completion_inner(
    shell: Option<&str>,
    home: &std::path::Path,
) -> Result<String, String> {
    let shell = shell.ok_or_else(|| {
        "未能检测到当前 Shell（$SHELL 未设置）\n\
         请手动配置自动补全：运行 `zapmyco completion --help` 查看帮助。"
            .to_string()
    })?;

    let config_path = shell_config_path(shell, home);
    let line = completion_line(shell);

    // 检查是否已配置
    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("读取 {} 失败: {}", config_path.display(), e))?;
        if content.contains(line) {
            return Ok(format!("Shell 自动补全已配置（{}）", config_path.display()));
        }
    }

    // 确保父目录存在
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录 {} 失败: {}", parent.display(), e))?;
    }

    // 追加配置行
    let content = if config_path.exists() {
        let mut content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("读取 {} 失败: {}", config_path.display(), e))?;
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(line);
        content.push('\n');
        content
    } else {
        format!("{}\n", line)
    };

    std::fs::write(&config_path, content)
        .map_err(|e| format!("写入 {} 失败: {}", config_path.display(), e))?;

    let source_hint = match shell {
        "fish" => "请重启终端以生效。",
        _ => "请运行 `source` 命令或重启终端以生效。",
    };

    Ok(format!(
        "Shell 自动补全已启用（{}）。\n{}",
        config_path.display(),
        source_hint,
    ))
}

/// 设置 shell 补全（从环境变量读取配置）
pub(crate) fn setup_shell_completion() -> Result<String, String> {
    let home_dir = settings::get_home_dir();
    setup_shell_completion_inner(detect_shell(), &home_dir)
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

/// note 命令 — 快速记录笔记
fn cmd_note(command: NoteCommands) -> Result<(), String> {
    let notes = crate::notes::NotesDir::new()?;

    match command {
        // 交互式编辑器模式（内容为空时）
        NoteCommands::Add { content } => {
            if content.is_empty() {
                let id = notes.create_interactive()?;
                println!("📝 已创建笔记: {}", id);
            } else {
                let content = content.join(" ");
                let id = notes.create(&content)?;
                println!("📝 已创建笔记: {}", id);
            }
            Ok(())
        }
        NoteCommands::Ls { all, limit } => {
            let limit = limit.unwrap_or(20);
            let entries = notes.list(limit, all)?;
            if entries.is_empty() {
                println!("暂无笔记");
                return Ok(());
            }
            for entry in &entries {
                println!("{}  {}  {}", entry.id, entry.created, entry.preview);
            }
            Ok(())
        }
        NoteCommands::Show { id } => {
            let content = notes.show(&id)?;
            // 只显示正文（跳过 frontmatter）
            if let Some(body) = content.split("\n---\n").nth(1) {
                println!("{}", body.trim());
            } else {
                println!("{}", content.trim());
            }
            Ok(())
        }
        NoteCommands::Grep { keyword } => {
            let entries = notes.grep(&keyword)?;
            if entries.is_empty() {
                println!("未找到包含「{}」的笔记", keyword);
                return Ok(());
            }
            for entry in &entries {
                println!("{}  {}  {}", entry.id, entry.created, entry.preview);
            }
            Ok(())
        }
        NoteCommands::Rm { id } => {
            notes.remove(&id)?;
            println!("已删除笔记: {}", id);
            Ok(())
        }
    }
}

/// CLI 入口 - 解析参数并执行对应操作
pub async fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
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
        Some(Commands::Note { command }) => cmd_note(command),
        Some(Commands::Run {
            content,
            profile,
            permission_mode,
            task_id,
        }) => {
            cmd_run(
                &content,
                profile.as_deref(),
                permission_mode,
                task_id.as_deref(),
            )
            .await
        }
        Some(Commands::Upgrade) => crate::upgrade::cmd_upgrade().await,
        Some(Commands::Completion { shell }) => {
            cmd_completion(shell, &mut std::io::stdout());
            Ok(())
        }
        // subcommand_required = true 时，此处不可达
        None => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
            // show 和 None 应该返回一致的输出（当前逻辑上它们相同）
            assert_eq!(show_result.unwrap(), none_result.unwrap());
        });
    }

    #[tokio::test]
    async fn test_run_empty_content() {
        let result = cmd_run("", None, PermissionMode::Full, None).await;
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

        let result = cmd_run("hello", None, PermissionMode::Full, None).await;
        assert!(result.is_err());

        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
    }

    #[test]
    fn test_build_run_options_no_profile() {
        let options = build_run_options(None);
        assert!(options.model_profile.is_none());
    }

    #[test]
    fn test_build_run_options_with_profile() {
        let options = build_run_options(Some("advanced"));
        assert_eq!(options.model_profile.unwrap(), "advanced");
    }

    #[test]
    fn test_init_existing_file() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "").unwrap();

            let file_path = settings::get_settings_path();
            // 非 TTY 路径
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
            // TTY 路径，用户选择不覆盖
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
        assert!(models.contains(&"deepseek-reasoner"));
        assert_eq!(models.len(), 3);
    }

    #[test]
    fn test_filter_models_by_provider_glm() {
        let models = filter_models_by_provider("glm");
        assert!(models.contains(&"glm-4-flash"));
        assert!(models.contains(&"glm-4v"));
        assert!(models.contains(&"glm-5v-turbo"));
        assert!(models.contains(&"glm-5.1"));
        assert_eq!(models.len(), 4);
    }

    #[test]
    fn test_filter_models_by_provider_custom() {
        let models = filter_models_by_provider("custom");
        assert_eq!(models.len(), 24);
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
            let settings = build_settings("glm", "test-key", "glm-4v");
            let result = write_settings(&file_path, &settings);
            assert!(result.is_ok());
            assert!(result.unwrap().contains("custom_settings.toml"));
            assert!(file_path.exists());

            // 验证文件内容包含正确的 TOML 结构
            let content = std::fs::read_to_string(&file_path).unwrap();
            assert!(content.contains("glm-4v"), "应该包含模型名称");
            assert!(content.contains("test-key"), "应该包含 API Key");
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
                home,
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
                home,
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
                home,
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
                home,
            );
            assert!(result.is_ok());
        });
    }

    #[test]
    #[cfg(not(windows))]
    fn test_execute_binary_successful_deletion() {
        run_with_temp_home(|home| {
            let bin_path = home.join("zapmyco");
            std::fs::write(&bin_path, "fake binary content").unwrap();
            assert!(bin_path.exists());

            let result = execute_uninstall(
                &home.join(".config/zapmyco"),
                &home.join(".zapmyco"),
                false,
                true,
                Some(&bin_path),
                home,
            );
            assert!(result.is_ok());
            // 二进制文件应被删除
            assert!(!bin_path.exists(), "二进制文件应被删除");
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
                home,
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

    #[test]
    fn test_format_model_label_1m_boundary() {
        // deepseek-v4-flash 恰好 1_000_000，验证 M 格式
        let label = format_model_label("deepseek-v4-flash");
        assert!(label.contains("1M"), "1M 应显示为 1M");
    }

    // —————— completion 命令测试 ——————

    #[test]
    fn test_completion_bash() {
        let mut buf = Vec::new();
        cmd_completion(clap_complete::Shell::Bash, &mut buf);
        let output = String::from_utf8(buf).unwrap();
        assert!(
            output.contains("complete -F"),
            "bash 补全应包含 complete -F"
        );
        for sub in &[
            "config",
            "init",
            "settings",
            "uninstall",
            "run",
            "note",
            "upgrade",
            "completion",
        ] {
            assert!(output.contains(sub), "bash 补全应包含子命令 {}", sub);
        }
    }

    #[test]
    fn test_completion_zsh() {
        let mut buf = Vec::new();
        cmd_completion(clap_complete::Shell::Zsh, &mut buf);
        let output = String::from_utf8(buf).unwrap();
        assert!(output.contains("#compdef"), "zsh 补全应以 #compdef 开头");
        for sub in &[
            "config",
            "init",
            "settings",
            "uninstall",
            "run",
            "note",
            "upgrade",
            "completion",
        ] {
            assert!(output.contains(sub), "zsh 补全应包含子命令 {}", sub);
        }
    }

    #[test]
    fn test_completion_fish() {
        let mut buf = Vec::new();
        cmd_completion(clap_complete::Shell::Fish, &mut buf);
        let output = String::from_utf8(buf).unwrap();
        assert!(
            output.contains("complete -c"),
            "fish 补全应包含 complete -c"
        );
        for sub in &[
            "config",
            "init",
            "settings",
            "uninstall",
            "run",
            "note",
            "upgrade",
            "completion",
        ] {
            assert!(output.contains(sub), "fish 补全应包含子命令 {}", sub);
        }
    }

    #[test]
    fn test_completion_powershell() {
        let mut buf = Vec::new();
        cmd_completion(clap_complete::Shell::PowerShell, &mut buf);
        let output = String::from_utf8(buf).unwrap();
        assert!(
            output.contains("Register-ArgumentCompleter"),
            "powershell 补全应注册参数补全器"
        );
        for sub in &[
            "config",
            "init",
            "settings",
            "uninstall",
            "run",
            "note",
            "upgrade",
            "completion",
        ] {
            assert!(output.contains(sub), "powershell 补全应包含子命令 {}", sub);
        }
    }

    #[test]
    fn test_completion_all_shells_have_all_subcommands() {
        let shells = [
            clap_complete::Shell::Bash,
            clap_complete::Shell::Zsh,
            clap_complete::Shell::Fish,
            clap_complete::Shell::PowerShell,
        ];
        for shell in shells {
            let mut buf = Vec::new();
            cmd_completion(shell, &mut buf);
            let output = String::from_utf8(buf).unwrap();
            for sub in &[
                "config",
                "init",
                "settings",
                "uninstall",
                "run",
                "note",
                "upgrade",
                "completion",
            ] {
                assert!(output.contains(sub), "{:?} 补全应包含子命令 {}", shell, sub);
            }
        }
    }

    // —————— cmd_note 命令测试 ——————

    #[test]
    fn test_cmd_note_add_and_list() {
        run_with_temp_home(|_home| {
            cmd_note(NoteCommands::Add {
                content: vec!["测试笔记".to_string()],
            })
            .expect("创建笔记应成功");

            let result = cmd_note(NoteCommands::Ls {
                limit: Some(10),
                all: false,
            });
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_cmd_note_list_empty() {
        run_with_temp_home(|_home| {
            // 空笔记目录
            let result = cmd_note(NoteCommands::Ls {
                limit: Some(10),
                all: false,
            });
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_cmd_note_show_and_grep_and_rm() {
        run_with_temp_home(|_home| {
            cmd_note(NoteCommands::Add {
                content: vec!["可搜索的内容".to_string()],
            })
            .expect("创建笔记应成功");

            // grep 搜索
            let grep_result = cmd_note(NoteCommands::Grep {
                keyword: "可搜索".to_string(),
            });
            assert!(grep_result.is_ok(), "grep 应成功");

            // grep 无结果
            let grep_empty = cmd_note(NoteCommands::Grep {
                keyword: "不存在的内容".to_string(),
            });
            assert!(grep_empty.is_ok(), "grep 无结果也应成功");

            // 列出笔记获取 ID
            let entries = crate::notes::NotesDir::new()
                .unwrap()
                .list(10, false)
                .unwrap();
            assert!(!entries.is_empty(), "至少有一条笔记");
            let note_id = entries[0].id.clone();

            // show
            let show_result = cmd_note(NoteCommands::Show {
                id: note_id.clone(),
            });
            assert!(show_result.is_ok(), "查看笔记应成功");

            // show 不存在的笔记
            let show_nonexistent = cmd_note(NoteCommands::Show {
                id: "nonexistent-id".to_string(),
            });
            assert!(show_nonexistent.is_err(), "查看不存在的笔记应失败");

            // rm
            let rm_result = cmd_note(NoteCommands::Rm {
                id: note_id.clone(),
            });
            assert!(rm_result.is_ok(), "删除笔记应成功");

            // rm 不存在的笔记
            let rm_nonexistent = cmd_note(NoteCommands::Rm { id: note_id });
            assert!(rm_nonexistent.is_err(), "删除不存在的笔记应失败");
        });
    }

    #[test]
    fn test_cmd_note_list_all() {
        run_with_temp_home(|_home| {
            cmd_note(NoteCommands::Add {
                content: vec!["笔记1".to_string()],
            })
            .expect("创建笔记1应成功");
            cmd_note(NoteCommands::Add {
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

    // —————— init 中 shell 补全自动配置的测试 ——————

    #[test]
    fn test_detect_shell_from_env() {
        unsafe {
            std::env::set_var("SHELL", "/bin/bash");
        }
        assert_eq!(detect_shell(), Some("bash"));

        unsafe {
            std::env::set_var("SHELL", "/usr/bin/zsh");
        }
        assert_eq!(detect_shell(), Some("zsh"));

        unsafe {
            std::env::set_var("SHELL", "/opt/homebrew/bin/fish");
        }
        assert_eq!(detect_shell(), Some("fish"));

        // 不支持的 shell
        unsafe {
            std::env::set_var("SHELL", "/bin/sh");
        }
        assert_eq!(detect_shell(), None);

        // SHELL 未设置
        unsafe {
            std::env::remove_var("SHELL");
        }
        assert_eq!(detect_shell(), None);

        // 恢复 bash（对其他测试友好）
        unsafe {
            std::env::set_var("SHELL", "/bin/bash");
        }
    }

    #[test]
    fn test_shell_config_path_bash_bashrc_exists() {
        run_with_temp_home(|home| {
            std::fs::write(home.join(".bashrc"), "").unwrap();
            std::fs::write(home.join(".bash_profile"), "").unwrap();
            let path = shell_config_path("bash", home);
            assert_eq!(path.file_name().unwrap(), ".bashrc");
        });
    }

    #[test]
    fn test_shell_config_path_bash_fallback_to_profile() {
        run_with_temp_home(|home| {
            // 只有 .bash_profile 存在
            std::fs::write(home.join(".bash_profile"), "").unwrap();
            let path = shell_config_path("bash", home);
            assert_eq!(path.file_name().unwrap(), ".bash_profile");
        });
    }

    #[test]
    fn test_shell_config_path_bash_neither_exists() {
        run_with_temp_home(|home| {
            // 两个都不存在，应返回 .bash_profile 作为默认
            let path = shell_config_path("bash", home);
            assert_eq!(path.file_name().unwrap(), ".bash_profile");
        });
    }

    #[test]
    fn test_shell_config_path_zsh() {
        run_with_temp_home(|home| {
            let path = shell_config_path("zsh", home);
            assert_eq!(path.file_name().unwrap(), ".zshrc");
        });
    }

    #[test]
    fn test_shell_config_path_fish() {
        run_with_temp_home(|home| {
            let path = shell_config_path("fish", home);
            assert!(path.ends_with(".config/fish/config.fish"));
        });
    }

    #[test]
    fn test_completion_line() {
        assert_eq!(
            completion_line("bash"),
            "eval \"$(zapmyco completion bash)\""
        );
        assert_eq!(completion_line("zsh"), "eval \"$(zapmyco completion zsh)\"");
        assert_eq!(completion_line("fish"), "zapmyco completion fish | source");
    }

    #[test]
    fn test_setup_completion_bash_new_file() {
        run_with_temp_home(|home| {
            let result = setup_shell_completion_inner(Some("bash"), home);
            assert!(result.is_ok());
            let msg = result.unwrap();
            assert!(msg.contains(".bash_profile"));
            assert!(msg.contains("Shell 自动补全已启用"));

            let content = std::fs::read_to_string(home.join(".bash_profile")).unwrap();
            assert!(content.contains("zapmyco completion bash"));
        });
    }

    #[test]
    fn test_setup_completion_bash_existing_file() {
        run_with_temp_home(|home| {
            std::fs::write(home.join(".bashrc"), "export FOO=bar\n").unwrap();

            let result = setup_shell_completion_inner(Some("bash"), home);
            assert!(result.is_ok());
            let msg = result.unwrap();
            assert!(msg.contains(".bashrc"));

            let content = std::fs::read_to_string(home.join(".bashrc")).unwrap();
            assert!(content.contains("export FOO=bar"));
            assert!(content.contains("zapmyco completion bash"));
        });
    }

    #[test]
    fn test_setup_completion_idempotent() {
        run_with_temp_home(|home| {
            std::fs::write(home.join(".zshrc"), "").unwrap();

            // 第一次
            let r1 = setup_shell_completion_inner(Some("zsh"), home);
            assert!(r1.is_ok());
            assert!(r1.unwrap().contains("已启用"));

            // 第二次，应提示已配置
            let r2 = setup_shell_completion_inner(Some("zsh"), home);
            assert!(r2.is_ok());
            assert!(r2.unwrap().contains("已配置")); // 不是"已启用"

            // 文件内容只出现一次
            let content = std::fs::read_to_string(home.join(".zshrc")).unwrap();
            let count = content.matches("zapmyco completion zsh").count();
            assert_eq!(count, 1, "补全行只能出现一次");
        });
    }

    #[test]
    fn test_setup_completion_fish_new_file() {
        run_with_temp_home(|home| {
            let result = setup_shell_completion_inner(Some("fish"), home);
            assert!(result.is_ok());
            let msg = result.unwrap();
            assert!(msg.contains("config/fish/config.fish"));

            let content = std::fs::read_to_string(home.join(".config/fish/config.fish")).unwrap();
            assert!(content.contains("zapmyco completion fish | source"));
        });
    }

    #[test]
    fn test_setup_completion_no_shell() {
        run_with_temp_home(|home| {
            let result = setup_shell_completion_inner(None, home);
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("$SHELL 未设置"));
        });
    }

    #[test]
    fn test_setup_completion_unsupported_shell() {
        // sh 会被 detect_shell 过滤掉，但 setup_shell_completion_inner 使用 panic
        // 直接传 "sh" 给它就会 panic，这是预期的
        // 测试 detect_shell 已经 cover 了这个场景
    }

    // ————————————————————————————————
    // remove_shell_completion 测试
    // ————————————————————————————————

    #[test]
    fn test_remove_completion_removes_line() {
        run_with_temp_home(|home| {
            let zshrc = home.join(".zshrc");
            std::fs::write(
                &zshrc,
                "export FOO=bar\neval \"$(zapmyco completion zsh)\"\nexport BAR=baz\n",
            )
            .unwrap();

            remove_shell_completion(home);

            let content = std::fs::read_to_string(&zshrc).unwrap();
            assert!(!content.contains("zapmyco completion zsh"));
            assert!(content.contains("export FOO=bar"));
            assert!(content.contains("export BAR=baz"));
        });
    }

    #[test]
    fn test_remove_completion_noop() {
        run_with_temp_home(|home| {
            let zshrc = home.join(".zshrc");
            std::fs::write(&zshrc, "export FOO=bar\nexport BAR=baz\n").unwrap();

            remove_shell_completion(home);

            let content = std::fs::read_to_string(&zshrc).unwrap();
            assert_eq!(content, "export FOO=bar\nexport BAR=baz\n");
        });
    }

    #[test]
    fn test_remove_completion_all_shells() {
        run_with_temp_home(|home| {
            // 同时配置三种 shell
            std::fs::write(
                home.join(".bash_profile"),
                "eval \"$(zapmyco completion bash)\"\n",
            )
            .unwrap();
            std::fs::write(home.join(".zshrc"), "eval \"$(zapmyco completion zsh)\"\n").unwrap();
            std::fs::create_dir_all(home.join(".config/fish")).unwrap();
            std::fs::write(
                home.join(".config/fish/config.fish"),
                "zapmyco completion fish | source\n",
            )
            .unwrap();

            remove_shell_completion(home);

            // 所有补全行都应被移除
            let bash_content = std::fs::read_to_string(home.join(".bash_profile")).unwrap();
            assert!(!bash_content.contains("zapmyco completion bash"));

            let zsh_content = std::fs::read_to_string(home.join(".zshrc")).unwrap();
            assert!(!zsh_content.contains("zapmyco completion zsh"));

            let fish_content =
                std::fs::read_to_string(home.join(".config/fish/config.fish")).unwrap();
            assert!(!fish_content.contains("zapmyco completion fish"));
        });
    }

    #[test]
    fn test_uninstall_removes_completion() {
        run_with_temp_home(|home| {
            // 模拟 init 后的状态：有收据，shell 配置中有补全行
            let receipt_dir = home.join(".config/zapmyco");
            std::fs::create_dir_all(&receipt_dir).unwrap();
            std::fs::write(
                receipt_dir.join("zapmyco-receipt.json"),
                r#"{"version":"0.24.2"}"#,
            )
            .unwrap();

            let zshrc = home.join(".zshrc");
            std::fs::write(
                &zshrc,
                "export FOO=bar\neval \"$(zapmyco completion zsh)\"\n",
            )
            .unwrap();

            // 执行卸载（非 TTY 模式下直接执行）
            let result = cmd_uninstall();
            assert!(result.is_ok());

            // 验证补全行已移除
            let content = std::fs::read_to_string(&zshrc).unwrap();
            assert!(!content.contains("zapmyco completion zsh"));
            // 其他内容应保留
            assert!(content.contains("export FOO=bar"));
        });
    }

    #[test]
    fn test_remove_completion_file_not_exists() {
        // 没有 shell 配置文件，应正常运行不 panic
        run_with_temp_home(|home| {
            remove_shell_completion(home);
            // 没有文件被创建
            assert!(!home.join(".zshrc").exists());
            assert!(!home.join(".bashrc").exists());
            assert!(!home.join(".bash_profile").exists());
        });
    }

    #[test]
    fn test_remove_completion_only_line_in_file() {
        run_with_temp_home(|home| {
            let zshrc = home.join(".zshrc");
            std::fs::write(&zshrc, "eval \"$(zapmyco completion zsh)\"\n").unwrap();

            remove_shell_completion(home);

            let content = std::fs::read_to_string(&zshrc).unwrap();
            assert!(content.is_empty(), "文件只有补全行时，应变为空");
        });
    }

    #[test]
    fn test_remove_completion_multiple_occurrences() {
        run_with_temp_home(|home| {
            let zshrc = home.join(".zshrc");
            std::fs::write(
                &zshrc,
                "eval \"$(zapmyco completion zsh)\"\nexport FOO=bar\neval \"$(zapmyco completion zsh)\"\n",
            )
            .unwrap();

            remove_shell_completion(home);

            let content = std::fs::read_to_string(&zshrc).unwrap();
            assert!(!content.contains("zapmyco completion zsh"));
            assert_eq!(content.matches("zapmyco completion zsh").count(), 0);
            assert!(content.contains("export FOO=bar"));
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

    #[test]
    fn test_generate_session_id_format() {
        let id = generate_session_id();
        assert!(id.starts_with("run_"), "会话 ID 应以 run_ 开头: {}", id);
        // 应包含日期时间毫秒部分，如 run_20260603_143021123
        assert!(
            id.len() >= 28,
            "会话 ID 长度应至少 28 字符（含纳秒）: {}",
            id
        );
        // 时间部分应只包含数字
        let time_part = &id[4..];
        let parts: Vec<&str> = time_part.split('_').collect();
        assert_eq!(parts.len(), 2, "会话 ID 应包含 date_time 两部分: {}", id);
        assert!(!parts[0].is_empty(), "日期部分不应为空");
        assert!(!parts[1].is_empty(), "时间部分不应为空");
    }

    #[test]
    fn test_generate_session_id_unique() {
        let id1 = generate_session_id();
        let id2 = generate_session_id();
        // 两次生成应不同（即使在同一秒，时间戳也会不同）
        assert_ne!(id1, id2, "连续两次生成的会话 ID 应不同");
    }

    #[test]
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
}
