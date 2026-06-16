use std::sync::atomic::{AtomicBool, Ordering};

use crate::agent::chat::{AiAgent, AiAgentOptions};
use crate::agent::session_loader;
use crate::agent::system_prompt;
use crate::cli::PermissionMode;
use crate::config::settings;
use crate::output::{self, Message};
use crate::skills::discovery::{list_available_skills, resolve_skill};
use crate::skills::loader::build_skill_list_text;
use crate::skills::types::SkillFile;
use crate::tools::task_manager::TaskStatus;
use crate::tools::{ask_user, subagent, task_manager, web_fetch, web_search};

/// 是否收到 Ctrl+C 中断信号
static SHOULD_EXIT: AtomicBool = AtomicBool::new(false);

/// run 命令 - 一次性执行 AI 任务（带工具支持）
#[allow(clippy::too_many_arguments)]
pub(crate) async fn cmd_run(
    content: Option<&str>,
    skill_name: Option<&str>,
    profile: Option<&str>,
    permission_mode: PermissionMode,
    task_id: Option<&str>,
    session: Option<&str>,
    model: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
    subagent: bool,
    parent_session_id: Option<&str>,
) -> Result<(), String> {
    let file_path = settings::get_settings_path();

    // ── Step 1: 解析 content / skill_name ──
    let content = match (content, skill_name) {
        (Some(c), _) => c.to_string(),
        (None, Some(skill_name)) => format!("请根据已加载的 Skill '{}' 指令开始工作。无需等待用户进一步指示，直接开始执行。", skill_name),
        (None, None) => {
            return Err(
                "任务描述不能为空。\n使用: zapmyco run \"任务描述\"\n或: zapmyco run --skill <skill名称>"
                    .to_string(),
            )
        }
    };

    tracing::info!(
        input_len = content.len(),
        profile = profile.unwrap_or("default"),
        skill = skill_name.unwrap_or(""),
        "开始执行 AI 任务"
    );

    if !file_path.exists() {
        return Err(format!(
            "未找到配置文件 {}\n请先运行 `zapmyco init` 初始化 LLM 配置。",
            file_path.display()
        ));
    }

    // ── Step 2: 扫描所有可用 skill（轻量 frontmatter） ──
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let all_skills = list_available_skills(&cwd);

    // ── Step 3: 如果指定了 --skill，完整加载 ──
    let active_skill: Option<SkillFile> = if let Some(skill_name) = skill_name {
        match resolve_skill(skill_name, &cwd) {
            Some(skill) => {
                if skill.name != skill_name {
                    return Err(format!(
                        "Skill 目录名 '{}' 与 frontmatter name '{}' 不匹配",
                        skill_name, skill.name
                    ));
                }
                output::send(&Message::info(format!(
                    "[Skill] 已加载: {} — {}",
                    skill.name, skill.description
                )));
                Some(skill)
            }
            None => {
                let mut msg = format!("Skill '{}' 未找到。\n", skill_name);
                if !all_skills.is_empty() {
                    msg.push_str("可用的 skill:\n");
                    for s in &all_skills {
                        msg.push_str(&format!("  - {}: {}\n", s.name, s.description));
                    }
                } else {
                    msg.push_str("当前没有任何可用 skill。\n");
                    msg.push_str("请在以下位置创建 SKILL.md：\n");
                    msg.push_str("  ~/.zapmyco/skills/<name>/SKILL.md\n");
                    msg.push_str("  <project>/.zapmyco/skills/<name>/SKILL.md\n");
                    msg.push_str("  <project>/.agents/skills/<name>/SKILL.md\n");
                }
                return Err(msg);
            }
        }
    } else {
        None
    };

    // ── Step 4: 组装完整 system prompt ──
    // 主 Agent 使用调度员提示词，SubAgent 使用默认编码助手提示词
    let mut full_prompt = if subagent {
        format!(
            "{}{}",
            system_prompt::DEFAULT_SYSTEM_PROMPT,
            system_prompt::BEHAVIORAL_GUIDANCE,
        )
    } else {
        system_prompt::DISPATCHER_SYSTEM_PROMPT.to_string()
    };
    if let Some(ref skill) = active_skill {
        full_prompt.push_str(&format!("\n\n## Skill: {}\n\n{}", skill.name, skill.body));
    }

    // ── Step 5: 构建 AiAgentOptions ──
    let mut options = build_run_options(profile, model, api_key, base_url, permission_mode);
    options.is_subagent = subagent;
    options.parent_session_id = parent_session_id.map(|s| s.to_string());
    options.system_prompt = Some(full_prompt);
    options.skill_list_text = {
        let list = build_skill_list_text(&all_skills);
        if list.is_empty() { None } else { Some(list) }
    };

    let mut agent = AiAgent::new(options)?;

    // ── 注册终端输出日志到当前会话目录 ──
    let _log_guard = register_terminal_log(&agent);

    // ── 注册应用执行日志到当前会话目录 ──
    let _app_log_guard = register_app_log(&agent);

    // ── 注册 Ctrl+C 信号处理器（第一次优雅关闭，第二次强制退出） ──
    std::mem::drop(tokio::spawn(async {
        tokio::signal::ctrl_c().await.ok();
        SHOULD_EXIT.store(true, Ordering::Relaxed);
        output::send(&Message::info(
            "收到中断信号，正在优雅关闭...（再按一次强制退出）",
        ));

        tokio::signal::ctrl_c().await.ok();
        use std::io::Write;
        let _ = std::io::stdout().flush();
        let _ = std::io::stderr().flush();
        std::process::exit(130);
    }));

    // 注册 Ask User 工具
    let ask_user = ask_user::AskUser;
    agent.register_tool(crate::agent::chat::ToolHandler::AskUser(ask_user));

    // ---- 创建 Task 管理器 ----
    let list_id = task_id
        .map(|s| s.to_string())
        .unwrap_or_else(generate_session_id);
    let task_manager = std::sync::Arc::new(task_manager::TaskManager::with_list_id(&list_id));
    output::send(&Message::info(format!("[会话] 任务列表 ID: {}", list_id)));
    if task_id.is_none() {
        output::send(&Message::info(format!(
            "[提示] 使用 --task-id {} 可恢复此会话的任务列表",
            list_id
        )));
    }
    agent.set_task_manager(task_manager.clone());

    if subagent {
        // ==================== SubAgent 模式：注册全套工具 ====================

        // 注册 Web Fetch 工具
        let web_fetch = web_fetch::WebFetch::new(Default::default())
            .map_err(|e| format!("初始化 Web Fetch 失败: {}", e))?;
        agent.register_tool(crate::agent::chat::ToolHandler::WebFetch(web_fetch));

        // 注册命令执行工具
        let (allowed_commands, denied_commands) = settings::load_settings()
            .ok()
            .flatten()
            .and_then(|s| s.permissions)
            .map(|p| (p.commands.allow, p.commands.deny))
            .unwrap_or_default();
        let shell_exec = if permission_mode == PermissionMode::ReadOnly {
            crate::tools::shell_exec::ShellExec::new(crate::tools::shell_exec::ShellExecOptions {
                readonly_mode: true,
                allowed_commands: crate::tools::shell_exec::builtin_safe_commands(),
                denied_commands,
                skip_confirm: true,
                ..Default::default()
            })
        } else {
            crate::tools::shell_exec::ShellExec::new(crate::tools::shell_exec::ShellExecOptions {
                allowed_commands,
                denied_commands,
                ..Default::default()
            })
        };
        agent.register_tool(crate::agent::chat::ToolHandler::ShellExec(shell_exec));

        // 注册 Web 搜索工具
        let web_search = web_search::WebSearch::new(
            agent.api_key().to_string(),
            agent.api_base_url().to_string(),
            agent.model_name().to_string(),
            agent.max_tokens(),
        )
        .map_err(|e| format!("初始化 Web Search 失败: {}", e))?;
        agent.register_tool(crate::agent::chat::ToolHandler::WebSearch(web_search));

        // 注册文件搜索工具
        agent.register_tool(crate::agent::chat::ToolHandler::FileSearch(
            crate::tools::file_search::FileSearch::new(Default::default()),
        ));

        // 注册文件查找工具
        agent.register_tool(crate::agent::chat::ToolHandler::FileFind(
            crate::tools::file_find::FileFind::new(Default::default()),
        ));

        // 注册文件读取工具
        agent.register_tool(crate::agent::chat::ToolHandler::FileRead(
            crate::tools::file_read::FileRead::new(Default::default()),
        ));

        // 注册文件编辑工具
        agent.register_tool(crate::agent::chat::ToolHandler::FileEdit(
            crate::tools::file_edit::FileEdit::new(Default::default()),
        ));

        // 注册文件写入工具
        agent.register_tool(crate::agent::chat::ToolHandler::FileWrite(
            crate::tools::file_write::FileWrite::new(Default::default()),
        ));

        // 注册 Task 管理工具（SubAgent 有读取和更新权限，但不创建新任务）
        agent.register_tool(crate::agent::chat::ToolHandler::TaskGet(
            task_manager.clone(),
        ));
        agent.register_tool(crate::agent::chat::ToolHandler::TaskList(
            task_manager.clone(),
        ));
        agent.register_tool(crate::agent::chat::ToolHandler::TaskUpdate(
            task_manager.clone(),
        ));

        // ---- 注册 Skill 工具（LLM 可在对话中动态加载 skill） ----
        if let Ok(skill_tool) = crate::tools::skill::SkillTool::new() {
            agent.register_tool(crate::agent::chat::ToolHandler::Skill(skill_tool));
        }

        // ---- 如果 skill 指定了 allowed-tools，过滤工具 ----
        if let Some(ref skill) = active_skill
            && !skill.allowed_tools.is_empty()
        {
            let tool_names = agent.tool_names();
            let to_remove =
                crate::skills::loader::compute_denied_tools(&tool_names, &skill.allowed_tools);
            if !to_remove.is_empty() {
                output::send(&Message::info(format!(
                    "[Skill] 工具过滤: 仅允许 {:?}",
                    skill.allowed_tools
                )));
                let refs: Vec<&str> = to_remove.iter().map(|s| s.as_str()).collect();
                agent.remove_tools(&refs);
            }
        }

        // ---- 根据权限模式过滤工具 ----
        if permission_mode != PermissionMode::Full {
            let (deny_tools, shell_note): (&[&str], &str) = match permission_mode {
                PermissionMode::ReadOnly => (
                    &["file_write", "file_edit"],
                    "shell_exec 受限（仅安全只读命令）",
                ),
                PermissionMode::ReadWrite => (&["shell_exec"], ""),
                PermissionMode::Full => (&[], ""),
            };
            output::send(&Message::info(format!(
                "[权限模式] {:?} — 已禁止: {:?}",
                permission_mode, deny_tools,
            )));
            if !shell_note.is_empty() {
                output::send(&Message::info(format!(
                    "[权限模式] {:?} — {}",
                    permission_mode, shell_note,
                )));
            }
            agent.remove_tools(deny_tools);
        }
    } else {
        // ==================== 主 Agent 模式：仅注册调度工具 ====================

        // Task 读工具
        agent.register_tool(crate::agent::chat::ToolHandler::TaskGet(
            task_manager.clone(),
        ));
        agent.register_tool(crate::agent::chat::ToolHandler::TaskList(
            task_manager.clone(),
        ));

        // ---- SubAgent 工具 ----
        let mut subagent_tool = subagent::SubAgentTool::with_permission_mode(permission_mode)
            .map_err(|e| format!("初始化 SubAgent 失败: {}", e))?;
        subagent_tool.set_parent_session_id(agent.session_id().map(|s| s.to_string()));
        agent.register_tool(crate::agent::chat::ToolHandler::SubAgent(subagent_tool));
    }

    // 如果指定了 --session，加载历史会话消息
    if let Some(session_id) = session {
        let session_id = session_id.to_string();
        let history = session_loader::load_session(&session_id)?;
        let msg_count = history.len();
        output::send(&Message::info(format!(
            "[会话] 已加载历史会话 {} ({} 条消息)",
            session_id, msg_count
        )));
        agent.inject_history(history);
    }

    // ---- 第一阶段：执行用户原始输入 ----
    let _response = agent
        .chat_with_tools(&content, |chunk| {
            output::send(&Message::llm_chunk(chunk));
        })
        .await?;

    // ---- 第二阶段：任务执行循环（仅 SubAgent 模式） ----
    if subagent {
        let mut task_completed = false;

        loop {
            let tasks = task_manager.list().await.map_err(|e| e.to_string())?;
            let pending_count = tasks
                .iter()
                .filter(|t| t.status != TaskStatus::Completed)
                .count();

            if pending_count == 0 {
                if task_completed {
                    output::send(&Message::result("\n✅ 全部任务已完成！".to_string()));
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

            output::send(&Message::info(format!(
                "\n[任务执行] {} 个任务待完成",
                pending_count,
            )));

            let result = tokio::select! {
                result = agent.chat_with_tools(&continuation, |chunk| {
                    output::send(&Message::llm_chunk(chunk));
                }) => Some(result),
                _ = tokio::signal::ctrl_c() => None,
            };

            match result {
                Some(Ok(_)) => {
                    task_completed = true;
                }
                Some(Err(e)) => return Err(e),
                None => {
                    output::send(&Message::result(String::new()));
                    let user_input =
                        inquire::Text::new("🛑 已中断 LLM 执行。请输入补充说明以纠正执行方向：")
                            .prompt()
                            .map_err(|e| e.to_string())?;
                    agent.add_user_message(&format!(
                        "[用户干预] {}\n\n请根据上述指引调整执行方向。",
                        user_input,
                    ));
                    task_completed = true;
                }
            }
        }
    }

    // ---- 退出前检查未完成的子 Agent（仅主 Agent） ----
    if !subagent && let Ok(subagent_dir) = subagent::get_subagent_data_dir() {
        match subagent::SubAgentTool::new() {
            Ok(tool) => {
                let session = tool.agent_session().to_string();
                let running = subagent::count_running_subagents(&subagent_dir, &session);
                if running > 0 {
                    output::send(&Message::info(format!(
                        "\n[SubAgent] 仍有 {} 个子代理在后台运行:",
                        running
                    )));
                    if let Ok(entries) = std::fs::read_dir(&subagent_dir) {
                        for entry in entries.flatten() {
                            let dir = entry.path();
                            if !dir.join("done").exists()
                                && dir.join("pid").exists()
                                && std::fs::read_to_string(dir.join("agent_session"))
                                    .map(|s| s.trim() == session)
                                    .unwrap_or(false)
                            {
                                let id = dir
                                    .file_name()
                                    .map(|s| s.to_string_lossy())
                                    .unwrap_or_default();
                                let task =
                                    std::fs::read_to_string(dir.join("task")).unwrap_or_default();
                                output::send(&Message::info(format!(
                                    "  ├ {} — {}",
                                    id,
                                    task.lines().next().unwrap_or("")
                                )));
                            }
                        }
                    }
                    output::send(&Message::info(format!(
                        "  └ 结果保留在: {}",
                        subagent_dir.display()
                    )));
                }
            }
            Err(e) => {
                output::send(&Message::info(format!("[SubAgent] 检查子代理失败: {}", e)));
            }
        }
    }

    // ---- 第四阶段：交互式继续循环（非子Agent模式） ----
    if !subagent {
        loop {
            output::send(&Message::result(String::new()));
            let user_input = inquire::Text::new("继续输入指令（留空或输入 /exit 退出）：\n")
                .prompt()
                .map_err(|e| e.to_string())?;

            let trimmed = user_input.trim();
            if trimmed.is_empty() || trimmed == "/exit" || trimmed == "/quit" {
                break;
            }

            agent
                .chat_with_tools(trimmed, |chunk| {
                    output::send(&Message::llm_chunk(chunk));
                })
                .await?;
        }
    }

    output::send(&Message::result(String::new()));
    if SHOULD_EXIT.load(Ordering::Relaxed) {
        agent.finish_session(crate::agent::session_logger::ExitReason::Interrupted);
    } else {
        agent.finish_session(crate::agent::session_logger::ExitReason::Completed);
    }
    Ok(())
}

/// 构建 run 命令的 AiAgentOptions
pub(crate) fn build_run_options(
    profile: Option<&str>,
    model: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
    permission_mode: PermissionMode,
) -> AiAgentOptions {
    AiAgentOptions {
        model_profile: profile.map(|s| s.to_string()),
        profile: profile.map(|s| s.to_string()),
        model: model.map(|s| s.to_string()),
        api_key: api_key.map(|s| s.to_string()),
        base_url: base_url.map(|s| s.to_string()),
        permission_mode: Some(permission_mode.to_string()),
        ..Default::default()
    }
}

/// 生成唯一的会话 ID（用于任务列表隔离）
fn generate_session_id() -> String {
    format!("run_{}", chrono::Local::now().format("%Y%m%d_%H%M%S%9f"))
}

/// 在会话子目录中创建 terminal.log 并注册到全局 ROUTER
///
/// 返回的 guard 在 drop 时自动从 ROUTER 注销，确保在函数各返回路径正确清理。
fn register_terminal_log(agent: &AiAgent) -> Option<TerminalLogGuard> {
    let session_id = agent.session_id()?;
    let log_dir = crate::agent::session_logger::get_sessions_dir().ok()?;
    let log_path = log_dir.join(session_id).join("terminal.log");
    let target = crate::output::LogTarget::new(&log_path).ok()?;
    crate::output::ROUTER.add_target(Box::new(target));
    Some(TerminalLogGuard)
}

/// Drop 时自动从全局 ROUTER 移除 LogTarget
struct TerminalLogGuard;

impl Drop for TerminalLogGuard {
    fn drop(&mut self) {
        crate::output::ROUTER.remove_target("log");
    }
}

/// 在会话子目录中注册 app 日志（应用执行日志）
///
/// 当 session 活跃时，tracing 事件会同时写入全局 app.log 和 session app.log。
/// 返回的 guard 在 drop 时自动清除 session 日志目录，停止写入。
fn register_app_log(agent: &AiAgent) -> Option<AppLogGuard> {
    let session_id = agent.session_id()?;
    let sessions_dir = crate::agent::session_logger::get_sessions_dir().ok()?;
    let session_dir = sessions_dir.join(session_id);
    crate::logging::set_session_log_dir(session_dir);
    Some(AppLogGuard)
}

/// Drop 时自动清除 SESSION_LOG_DIR
struct AppLogGuard;

impl Drop for AppLogGuard {
    fn drop(&mut self) {
        crate::logging::clear_session_log_dir();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::PermissionMode;
    use crate::test_util::run_with_temp_home;
    use tracing_subscriber::prelude::*;
    #[tokio::test]
    async fn test_run_empty_content() {
        let result = cmd_run(
            None, // content
            None, // skill
            None, // profile
            PermissionMode::Full,
            None,
            None,
            None,
            None,
            None,  // task_id..base_url
            false, // subagent
            None,  // parent_session_id
        )
        .await;
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

        let result = cmd_run(
            Some("hello"), // content
            None,          // skill
            None,          // profile
            PermissionMode::Full,
            None,
            None,
            None,
            None,
            None,  // task_id..base_url
            false, // subagent
            None,  // parent_session_id
        )
        .await;
        assert!(result.is_err());

        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
    }

    #[test]
    fn test_build_run_options_no_profile() {
        let options = build_run_options(None, None, None, None, PermissionMode::Full);
        assert!(options.model_profile.is_none());
        assert!(options.model.is_none());
        assert!(options.api_key.is_none());
        assert!(options.base_url.is_none());
    }

    #[test]
    fn test_build_run_options_with_profile() {
        let options = build_run_options(Some("advanced"), None, None, None, PermissionMode::Full);
        assert_eq!(options.model_profile.unwrap(), "advanced");
        assert!(options.model.is_none());
        assert!(options.api_key.is_none());
        assert!(options.base_url.is_none());
    }

    #[test]
    fn test_build_run_options_with_model() {
        let options = build_run_options(
            None,
            Some("deepseek-v4-flash"),
            None,
            None,
            PermissionMode::Full,
        );
        assert_eq!(options.model.unwrap(), "deepseek-v4-flash");
        assert!(options.model_profile.is_none());
        assert!(options.api_key.is_none());
        assert!(options.base_url.is_none());
    }

    #[test]
    fn test_build_run_options_with_api_key() {
        let options =
            build_run_options(None, None, Some("sk-test-123"), None, PermissionMode::Full);
        assert_eq!(options.api_key.unwrap(), "sk-test-123");
        assert!(options.model.is_none());
    }

    #[test]
    fn test_build_run_options_with_base_url() {
        let options = build_run_options(
            None,
            None,
            None,
            Some("https://custom.example.com"),
            PermissionMode::Full,
        );
        assert_eq!(options.base_url.unwrap(), "https://custom.example.com");
        assert!(options.model.is_none());
    }

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
    fn test_build_run_options_all_flags() {
        let options = build_run_options(
            Some("my-profile"),
            Some("claude-opus-4-7"),
            Some("sk-claude-key"),
            Some("https://api.anthropic.com"),
            PermissionMode::Full,
        );
        assert_eq!(options.model_profile.unwrap(), "my-profile");
        assert_eq!(options.model.unwrap(), "claude-opus-4-7");
        assert_eq!(options.api_key.unwrap(), "sk-claude-key");
        assert_eq!(options.base_url.unwrap(), "https://api.anthropic.com");
    }

    #[test]
    fn test_terminal_log_guard_removes_log_target() {
        let router = crate::output::Router::new();
        let dir = tempfile::TempDir::new().unwrap();
        let log_path = dir.path().join("terminal.log");
        let target = crate::output::LogTarget::new(&log_path).unwrap();

        // 添加 target
        router.add_target(Box::new(target));

        // 验证 remove_target 返回 true
        assert!(router.remove_target("log"), "应成功移除 log target");

        // 重复移除应返回 false
        assert!(!router.remove_target("log"), "再次移除应返回 false");
    }

    #[test]
    fn test_terminal_log_captures_router_messages() {
        run_with_temp_home(|home| {
            // 1. 创建配置
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[llm]\napi_key = \"test\"\n",
            )
            .unwrap();

            // 2. 构建 AiAgent（logger 启用）
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            let session_id = agent.session_id().unwrap();

            // 3. 注册 terminal.log
            let _guard = register_terminal_log(&agent);
            assert!(_guard.is_some(), "logger 启用时应返回 Some guard");

            // 4. 验证 terminal.log 被创建
            let sessions_dir = home.join(".zapmyco/sessions");
            let terminal_log = sessions_dir.join(session_id).join("terminal.log");
            assert!(
                terminal_log.exists(),
                "register_terminal_log 后 terminal.log 应存在"
            );

            // 5. 通过全局 ROUTER 发送消息
            crate::output::send(&crate::output::Message::result("hello from test"));
            crate::output::send(&crate::output::Message::warning("warning from test"));

            // 6. 验证消息被正确写入
            let content = std::fs::read_to_string(&terminal_log).unwrap();
            assert!(content.contains("hello from test"), "应包含 stdout 消息");
            assert!(content.contains("warning from test"), "应包含 stderr 消息");
            assert!(content.contains("[STDOUT]"), "应包含 STDOUT 通道标记");
            assert!(content.contains("[STDERR]"), "应包含 STDERR 通道标记");
        });
    }

    // ================================================================
    // register_app_log & AppLogGuard 测试
    // ================================================================

    #[test]
    fn test_register_app_log_sets_session_dir() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            // 准备 AiAgent
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[llm]\napi_key = \"test\"\n",
            )
            .unwrap();

            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            let session_id = agent.session_id().unwrap().to_string();

            // 注册 app 日志
            let guard = register_app_log(&agent);
            assert!(
                guard.is_some(),
                "logger 启用时 register_app_log 应返回 Some"
            );

            let session_dir = crate::agent::session_logger::get_sessions_dir()
                .unwrap()
                .join(&session_id);
            assert_eq!(
                crate::logging::get_session_log_dir(),
                Some(session_dir),
                "register_app_log 应设置 SESSION_LOG_DIR 为 session 目录"
            );

            // cleanup
            crate::logging::clear_session_log_dir();
        });
    }

    #[test]
    fn test_app_log_guard_drop_clears_session_dir() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[llm]\napi_key = \"test\"\n",
            )
            .unwrap();

            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            let guard = register_app_log(&agent);
            assert!(
                crate::logging::get_session_log_dir().is_some(),
                "guard 存在时应设置 session dir"
            );

            drop(guard);
            assert!(
                crate::logging::get_session_log_dir().is_none(),
                "guard drop 后应清除 session dir"
            );
        });
    }

    #[test]
    fn test_register_app_log_disabled_when_logger_off() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[llm]\napi_key = \"test\"\n",
            )
            .unwrap();

            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            let guard = register_app_log(&agent);
            // 当前 AiAgent 默认启用 session 日志，因此 guard 应为 Some
            if agent.session_id().is_some() {
                assert!(guard.is_some());
            } else {
                assert!(guard.is_none());
            }
        });
    }

    #[test]
    fn test_session_log_end_to_end() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            // 1. 准备 settings
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                "[llm]\napi_key = \"test\"\n",
            )
            .unwrap();

            // 2. 创建 AiAgent
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            let session_id = agent.session_id().unwrap().to_string();
            let sessions_dir = crate::agent::session_logger::get_sessions_dir().unwrap();
            let session_dir = sessions_dir.join(&session_id);
            let session_log = session_dir.join("app.log");

            // 3. 注册 app 日志
            crate::logging::set_session_log_dir(session_dir.clone());

            // 4. 配置 tracing subscriber
            let global_path = home.join(".zapmyco/logs/app.log");
            let subscriber = tracing_subscriber::Registry::default().with(
                tracing_subscriber::fmt::layer()
                    .with_writer(crate::logging::make_file_writer(global_path.clone()))
                    .with_ansi(false)
                    .with_filter(tracing_subscriber::EnvFilter::new("info")),
            );

            // 5. 产生 tracing 事件
            tracing::subscriber::with_default(subscriber, || {
                tracing::info!("end-to-end test message");
                tracing::warn!("end-to-end warning");
            });

            // 6. 验证 session app.log
            assert!(session_log.exists(), "session app.log 应被创建");
            let session_content = std::fs::read_to_string(&session_log).unwrap();
            assert!(
                session_content.contains("end-to-end test message"),
                "session 日志应包含 info 事件"
            );
            assert!(
                session_content.contains("end-to-end warning"),
                "session 日志应包含 warn 事件"
            );

            // 7. 验证全局 app.log
            let global_content = std::fs::read_to_string(&global_path).unwrap();
            assert!(
                global_content.contains("end-to-end test message"),
                "全局日志也应包含 info 事件"
            );

            // 8. 模拟 guard drop
            crate::logging::clear_session_log_dir();
            assert!(
                crate::logging::get_session_log_dir().is_none(),
                "guard drop 后 SESSION_LOG_DIR 应为 None"
            );
        });
    }
}

#[cfg(test)]
mod run_tool_registration_tests {
    use super::*;
    use crate::agent::chat::{AiAgent, AiAgentOptions};
    use crate::cli::PermissionMode;
    use crate::test_util::run_with_temp_home;

    fn create_main_agent(home: &std::path::Path) -> AiAgent {
        let settings_dir = home.join(".zapmyco");
        std::fs::create_dir_all(&settings_dir).unwrap();
        std::fs::write(
            settings_dir.join("settings.toml"),
            "[llm]\napi_key = \"test\"\n",
        )
        .unwrap();

        let mut agent = AiAgent::new(AiAgentOptions {
            api_key: Some("test-key".to_string()),
            ..Default::default()
        })
        .unwrap();

        // 模拟主 Agent 的工具注册（即 cmd_run 中 else 分支的行为）
        agent.register_tool(crate::agent::chat::ToolHandler::AskUser(
            crate::tools::ask_user::AskUser,
        ));
        let test_tm = std::sync::Arc::new(crate::tools::task_manager::TaskManager::with_list_id(
            "test",
        ));
        agent.register_tool(crate::agent::chat::ToolHandler::TaskGet(test_tm.clone()));
        agent.register_tool(crate::agent::chat::ToolHandler::TaskList(test_tm.clone()));

        let subagent_tool = crate::tools::subagent::SubAgentTool::with_permission_mode(
            crate::cli::PermissionMode::Full,
        )
        .unwrap();
        agent.register_tool(crate::agent::chat::ToolHandler::SubAgent(subagent_tool));
        agent
    }

    fn agent_with_mode(mode: PermissionMode, home: &std::path::Path) -> AiAgent {
        // AiAgent::new() 需要 settings.toml
        let settings_dir = home.join(".zapmyco");
        std::fs::create_dir_all(&settings_dir).unwrap();
        std::fs::write(
            settings_dir.join("settings.toml"),
            "[llm]\napi_key = \"test\"\n",
        )
        .unwrap();

        let mut agent = AiAgent::new(AiAgentOptions {
            api_key: Some("test-key".to_string()),
            ..Default::default()
        })
        .unwrap();

        agent.register_tool(crate::agent::chat::ToolHandler::AskUser(
            crate::tools::ask_user::AskUser,
        ));
        agent.register_tool(crate::agent::chat::ToolHandler::WebFetch(
            crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap(),
        ));

        let shell_exec = if mode == PermissionMode::ReadOnly {
            crate::tools::shell_exec::ShellExec::new(crate::tools::shell_exec::ShellExecOptions {
                readonly_mode: true,
                allowed_commands: crate::tools::shell_exec::builtin_safe_commands(),
                skip_confirm: true,
                ..Default::default()
            })
        } else {
            crate::tools::shell_exec::ShellExec::new(Default::default())
        };
        agent.register_tool(crate::agent::chat::ToolHandler::ShellExec(shell_exec));

        agent.register_tool(crate::agent::chat::ToolHandler::FileRead(
            crate::tools::file_read::FileRead::new(Default::default()),
        ));
        agent.register_tool(crate::agent::chat::ToolHandler::FileEdit(
            crate::tools::file_edit::FileEdit::new(Default::default()),
        ));
        agent.register_tool(crate::agent::chat::ToolHandler::FileWrite(
            crate::tools::file_write::FileWrite::new(Default::default()),
        ));

        let deny_tools: &[&str] = match mode {
            PermissionMode::ReadOnly => &["file_write", "file_edit"],
            PermissionMode::ReadWrite => &["shell_exec"],
            PermissionMode::Full => &[],
        };
        agent.remove_tools(deny_tools);
        agent
    }

    #[test]
    fn test_full_mode_has_all_tools() {
        run_with_temp_home(|home| {
            let agent = agent_with_mode(PermissionMode::Full, home);
            let names = agent.tool_names();
            assert!(names.contains(&"shell_exec".to_string()));
            assert!(names.contains(&"file_write".to_string()));
            assert!(names.contains(&"file_edit".to_string()));
        });
    }

    #[test]
    fn test_readwrite_removes_shell_exec() {
        run_with_temp_home(|home| {
            let agent = agent_with_mode(PermissionMode::ReadWrite, home);
            let names = agent.tool_names();
            assert!(!names.contains(&"shell_exec".to_string()));
            assert!(names.contains(&"file_write".to_string()));
            assert!(names.contains(&"file_edit".to_string()));
        });
    }

    #[test]
    fn test_readonly_keeps_shell_exec_removes_write() {
        run_with_temp_home(|home| {
            let agent = agent_with_mode(PermissionMode::ReadOnly, home);
            let names = agent.tool_names();
            assert!(
                names.contains(&"shell_exec".to_string()),
                "ReadOnly 应保留 shell_exec（受限）"
            );
            assert!(!names.contains(&"file_write".to_string()));
            assert!(!names.contains(&"file_edit".to_string()));
        });
    }

    #[test]
    fn test_main_agent_registers_only_dispatcher_tools() {
        run_with_temp_home(|home| {
            let agent = create_main_agent(home);
            let names = agent.tool_names();
            // 主 Agent 应包含 4 个调度工具
            assert!(names.contains(&"ask_user".to_string()), "应包含 ask_user");
            assert!(names.contains(&"subagent".to_string()), "应包含 subagent");
            assert!(names.contains(&"task_get".to_string()), "应包含 task_get");
            assert!(names.contains(&"task_list".to_string()), "应包含 task_list");
            // 主 Agent 不应包含执行工具
            assert!(
                !names.contains(&"file_read".to_string()),
                "不应包含 file_read"
            );
            assert!(
                !names.contains(&"file_write".to_string()),
                "不应包含 file_write"
            );
            assert!(
                !names.contains(&"file_edit".to_string()),
                "不应包含 file_edit"
            );
            assert!(
                !names.contains(&"shell_exec".to_string()),
                "不应包含 shell_exec"
            );
            assert!(
                !names.contains(&"web_fetch".to_string()),
                "不应包含 web_fetch"
            );
            assert!(
                !names.contains(&"web_search".to_string()),
                "不应包含 web_search"
            );
            assert!(
                !names.contains(&"task_create".to_string()),
                "不应包含 task_create"
            );
            assert!(
                !names.contains(&"task_update".to_string()),
                "不应包含 task_update"
            );
            // 精确数量验证
            assert_eq!(names.len(), 4, "主 Agent 应恰好注册 4 个工具");
        });
    }
}
