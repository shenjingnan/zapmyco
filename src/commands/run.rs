use crate::agent::chat::{AiAgent, AiAgentOptions};
use crate::agent::conversation_loader;
use crate::agent::system_prompt;
use crate::cli::PermissionMode;
use crate::config::settings;
use crate::output::{self, Message};
use crate::skills::discovery::{list_available_skills, resolve_skill};
use crate::skills::loader::{build_skill_list_text, compute_denied_tools};
use crate::skills::types::SkillFile;
use crate::tools::task_manager::TaskStatus;
use crate::tools::{
    ask_user, file_edit, file_find, file_read, file_search, file_write, shell_exec, skill,
    subagent, task_manager, web_fetch, web_search,
};

/// run 命令 - 一次性执行 AI 任务（带工具支持）
#[allow(clippy::too_many_arguments)]
pub(crate) async fn cmd_run(
    content: Option<&str>,
    skill_name: Option<&str>,
    profile: Option<&str>,
    permission_mode: PermissionMode,
    task_id: Option<&str>,
    conversation: Option<&str>,
    model: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
    subagent: bool,
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
    let mut full_prompt = format!(
        "{}{}",
        system_prompt::DEFAULT_SYSTEM_PROMPT,
        system_prompt::BEHAVIORAL_GUIDANCE,
    );
    if let Some(ref skill) = active_skill {
        full_prompt.push_str(&format!("\n\n## Skill: {}\n\n{}", skill.name, skill.body));
    }

    // ── Step 5: 构建 AiAgentOptions ──
    let mut options = build_run_options(profile, model, api_key, base_url);
    options.system_prompt = Some(full_prompt);
    options.skill_list_text = {
        let list = build_skill_list_text(&all_skills);
        if list.is_empty() { None } else { Some(list) }
    };

    let mut agent = AiAgent::new(options)?;

    // 注册 Ask User 工具
    let ask_user = ask_user::AskUser;
    agent.register_tool(crate::agent::chat::ToolHandler::AskUser(ask_user));

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
    let shell_exec = shell_exec::ShellExec::new(shell_exec::ShellExecOptions {
        allowed_commands,
        denied_commands,
        ..Default::default()
    });
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
    let file_search = file_search::FileSearch::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::FileSearch(file_search));

    // 注册文件查找工具
    let file_find = file_find::FileFind::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::FileFind(file_find));

    // 注册文件读取工具
    let file_read = file_read::FileRead::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::FileRead(file_read));

    // 注册文件编辑工具
    let file_edit = file_edit::FileEdit::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::FileEdit(file_edit));

    // 注册文件写入工具
    let file_write = file_write::FileWrite::new(Default::default());
    agent.register_tool(crate::agent::chat::ToolHandler::FileWrite(file_write));

    // 注册 Task 管理工具
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

    // ---- 注册 SubAgent 工具（子进程模式跳过） ----
    if !subagent {
        let subagent_tool =
            subagent::SubAgentTool::new().map_err(|e| format!("初始化 SubAgent 失败: {}", e))?;
        agent.register_tool(crate::agent::chat::ToolHandler::SubAgent(subagent_tool));
    }

    // ---- 注册 Skill 工具（LLM 可在对话中动态加载 skill） ----
    if let Ok(skill_tool) = skill::SkillTool::new() {
        agent.register_tool(crate::agent::chat::ToolHandler::Skill(skill_tool));
    }

    // ---- 如果 skill 指定了 allowed-tools，过滤工具 ----
    if let Some(ref skill) = active_skill
        && !skill.allowed_tools.is_empty()
    {
        let tool_names = agent.tool_names();
        let to_remove = compute_denied_tools(&tool_names, &skill.allowed_tools);
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
        let deny_tools: &[&str] = match permission_mode {
            PermissionMode::ReadOnly => &["file_write", "file_edit", "shell_exec"],
            PermissionMode::ReadWrite => &["shell_exec"],
            PermissionMode::Full => &[],
        };
        output::send(&Message::info(format!(
            "[权限模式] {:?} — 已禁止工具: {:?}",
            permission_mode, deny_tools
        )));
        agent.remove_tools(deny_tools);
    }

    // 如果指定了 --conversation，加载历史会话消息
    if let Some(session_id) = conversation {
        let session_id = session_id.to_string();
        let history = conversation_loader::load_conversation(&session_id)?;
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

    // ---- 第二阶段：任务执行循环 ----
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
    Ok(())
}

/// 构建 run 命令的 AiAgentOptions
pub(crate) fn build_run_options(
    profile: Option<&str>,
    model: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
) -> AiAgentOptions {
    AiAgentOptions {
        model_profile: profile.map(|s| s.to_string()),
        model: model.map(|s| s.to_string()),
        api_key: api_key.map(|s| s.to_string()),
        base_url: base_url.map(|s| s.to_string()),
        ..Default::default()
    }
}

/// 生成唯一的会话 ID（用于任务列表隔离）
pub(crate) fn generate_session_id() -> String {
    format!("run_{}", chrono::Local::now().format("%Y%m%d_%H%M%S%9f"))
}
