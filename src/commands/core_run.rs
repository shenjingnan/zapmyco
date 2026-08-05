//! `run` / `core-run` 命令 — 使用 Core 层的 `agent_loop()` 执行 AI 任务。
//!
//! 这是从 `cmd_run()`（基于 AiAgent）到 Core 层的迁移路径。
//! 支持 Base 模式（单次执行 + 工具调用）和 Plan 模式（分析→审批→执行→总结）。
//! M2 起，`zapmyco run` 完全走本命令，不再依赖旧 AiAgent。

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tokio::sync::mpsc;

use crate::adapters::core_event_handler;
use crate::cli::{ExecutionMode, PermissionMode};
use crate::output::{self, Message};
use crate::skills::discovery::{list_available_skills, resolve_skill};
use crate::skills::loader::{build_skill_list_text, compute_denied_tools};
use crate::skills::types::SkillFile;
use crate::tools::{
    ask_user, file_edit, file_find, file_read, file_search, file_write, shell_exec, skill,
    subagent, task_create, task_get, task_list, task_manager, task_update, web_fetch, web_search,
};
use zapmyco_core::{AgentConfig, agent_loop};

use super::config_resolver::{ResolvedLlmConfig, resolve_llm_config};

/// 是否收到 Ctrl+C 中断信号
static SHOULD_EXIT: AtomicBool = AtomicBool::new(false);

/// run 命令入口 — 使用 Core 层执行 AI 任务
#[allow(clippy::too_many_arguments)]
pub(crate) async fn cmd_core_run(
    content: Option<&str>,
    skill_name: Option<&str>,
    profile: Option<&str>,
    permission_mode: PermissionMode,
    mode: ExecutionMode,
    model: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
    task_id: Option<&str>,
    session: Option<&str>,
    subagent: bool,
    parent_session_id: Option<&str>,
) -> Result<(), String> {
    // ── Step 1: 解析 content / skill_name ──
    let content = match (content, skill_name) {
        (Some(c), _) => c.to_string(),
        (None, Some(skill_name)) => format!(
            "请根据已加载的 Skill '{}' 指令开始工作。无需等待用户进一步指示，直接开始执行。",
            skill_name
        ),
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
        "run 开始执行"
    );

    // ── Step 2: 检查配置文件 ──
    let file_path = crate::config::settings::get_settings_path();
    if !file_path.exists() {
        return Err(format!(
            "未找到配置文件 {}\n请先运行 `zapmyco init` 初始化 LLM 配置。",
            file_path.display()
        ));
    }

    // ── Step 3: 扫描和加载 skill ──
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let all_skills = list_available_skills(&cwd);

    let mut active_skill: Option<SkillFile> = if let Some(skill_name) = skill_name {
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
                }
                return Err(msg);
            }
        }
    } else {
        None
    };

    // Plan 模式自动加载内置 plan skill（未通过 --skill 指定其他 skill 时）
    if mode == ExecutionMode::Plan
        && active_skill.is_none()
        && let Some(skill) = resolve_skill("plan", &cwd)
    {
        output::send(&Message::info(format!(
            "[Plan] 已加载内置 skill: {} — {}",
            skill.name, skill.description,
        )));
        active_skill = Some(skill);
    }

    // ── Step 4: 解析 LLM 配置 ──
    let resolved = resolve_llm_config(profile, model, api_key, base_url)?;

    // ── Step 5: 构建 system prompt ──
    let base_prompt = format!(
        "{}{}",
        crate::prompts::DEFAULT_SYSTEM_PROMPT,
        crate::prompts::BEHAVIORAL_GUIDANCE,
    );
    let skill_list = build_skill_list_text(&all_skills);
    let system_prompt = if skill_list.is_empty() {
        base_prompt
    } else {
        format!("{}\n\n{}", base_prompt, skill_list)
    };

    // ── Step 6: 构建共享 TaskManager（--task-id 复用任务列表） ──
    let list_id = task_id
        .map(|s| s.to_string())
        .unwrap_or_else(generate_session_id);
    let tm = Arc::new(task_manager::TaskManager::with_list_id(&list_id));
    output::send(&Message::info(format!("[会话] 任务列表 ID: {}", list_id)));
    if task_id.is_none() {
        output::send(&Message::info(format!(
            "[提示] 使用 --task-id {} 可恢复此会话的任务列表",
            list_id
        )));
    }

    // ── Step 7: 构建工具集 ──
    let full_tools = build_tools(
        &resolved,
        permission_mode,
        active_skill.as_ref(),
        tm.clone(),
        subagent,
        parent_session_id,
    )?;
    // 只读工具（Plan Phase 1 分析用）：过滤掉写操作工具
    let readonly_names = ["file_write", "file_edit", "shell_exec"];
    let readonly_tools = build_tools(
        &resolved,
        permission_mode,
        active_skill.as_ref(),
        tm.clone(),
        subagent,
        parent_session_id,
    )?
    .into_iter()
    .filter(|t| !readonly_names.contains(&t.name()))
    .collect();

    // ── Step 8: Session 生命周期 ──
    let run_session = RunSession::start(
        &resolved,
        permission_mode,
        subagent,
        parent_session_id,
        profile,
    )?;
    let _terminal_guard = run_session
        .as_ref()
        .and_then(|s| register_terminal_log(&s.session_id));
    let _app_guard = run_session
        .as_ref()
        .and_then(|s| register_app_log(&s.session_id));
    spawn_ctrl_c_handler();

    // ── Step 9: --session 历史加载 ──
    let mut messages: Vec<zapmyco_core::ConversationMessage> = if let Some(session_id) = session {
        let history = crate::session::loader::load_session(session_id)?;
        output::send(&Message::info(format!(
            "[会话] 已加载历史会话 {} ({} 条消息)",
            session_id,
            history.len()
        )));
        history
    } else {
        Vec::new()
    };

    // ── Step 10: context_reminder 注入（仅首次输入） ──
    let agents_md = crate::agents_md::load_agents_md(&cwd);
    let mut context_injected = !messages.is_empty();
    let wrap_input = |raw: String, ctx: &mut bool| -> String {
        if *ctx {
            return raw;
        }
        *ctx = true;
        let mut reminder = crate::prompts::build_context_reminder(agents_md.as_deref());
        if !skill_list.is_empty()
            && let Some(pos) = reminder.rfind("</system-reminder>")
        {
            reminder.insert_str(pos, &skill_list);
        }
        format!("{}{}", reminder, raw)
    };

    // ── Step 11: 构建 Core 配置 ──
    let make_config = |tools: Vec<Box<dyn zapmyco_core::AgentTool>>| -> Arc<AgentConfig> {
        Arc::new(
            AgentConfig::new(&resolved.model, &resolved.api_key, &resolved.base_url)
                .with_max_tokens(resolved.max_tokens)
                .with_system_prompt(&system_prompt)
                .with_tools(tools),
        )
    };

    let readonly_config = make_config(readonly_tools);
    let full_config = make_config(full_tools);

    let preamble = build_skill_preamble(active_skill.as_ref());

    // ── Step 12: 运行 ──
    match mode {
        ExecutionMode::Base => {
            run_base(
                readonly_config,
                &preamble,
                &content,
                &mut messages,
                &wrap_input,
                &mut context_injected,
                run_session.as_ref(),
            )
            .await?
        }
        ExecutionMode::Plan => {
            run_plan(
                readonly_config,
                full_config.clone(),
                &preamble,
                &content,
                &mut messages,
                &wrap_input,
                &mut context_injected,
                run_session.as_ref(),
                &tm,
            )
            .await?
        }
    }

    // ── Step 13: 交互式继续循环（仅主 Agent） ──
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

            let (event_tx, mut event_rx) = mpsc::channel(256);
            let display = tokio::spawn(async move {
                while let Some(event) = event_rx.recv().await {
                    core_event_handler(&event);
                }
            });
            let r = agent_loop(
                full_config.clone(),
                &mut messages,
                wrap_input(trimmed.to_string(), &mut context_injected),
                event_tx,
            )
            .await;
            display.await.ok();
            r.map_err(|e| format!("Agent 执行失败: {}", e))?;
            if let Some(s) = &run_session {
                s.snapshot(&messages);
            }
        }
    }

    // ── Step 14: 退出前子 Agent 检查（仅主 Agent） ──
    if !subagent {
        check_running_subagents();
    }

    // ── Step 15: 结束会话 ──
    output::send(&Message::result(String::new()));
    let exit_reason = if SHOULD_EXIT.load(Ordering::Relaxed) {
        crate::session::logger::ExitReason::Interrupted
    } else {
        crate::session::logger::ExitReason::Completed
    };
    if let Some(s) = &run_session {
        s.finish(exit_reason);
    }

    Ok(())
}

// ============================================================================
// Base 模式
// ============================================================================

async fn run_base(
    config: Arc<AgentConfig>,
    preamble: &str,
    content: &str,
    messages: &mut Vec<zapmyco_core::ConversationMessage>,
    wrap_input: &impl Fn(String, &mut bool) -> String,
    context_injected: &mut bool,
    run_session: Option<&RunSession>,
) -> Result<(), String> {
    let full_prompt = wrap_input(format!("{}{}", preamble, content), context_injected);
    let (event_tx, mut event_rx) = mpsc::channel(256);

    let display = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            core_event_handler(&event);
        }
    });

    let result = agent_loop(config, messages, full_prompt, event_tx).await;
    display.await.ok();
    if let Some(s) = run_session {
        s.snapshot(messages);
    }

    match result {
        Ok(()) => Ok(()),
        Err(e) => {
            output::send(&Message::error(format!("Agent 执行失败: {}", e)));
            Err(format!("Agent 执行失败: {}", e))
        }
    }
}

// ============================================================================
// Plan 模式
// ============================================================================

#[allow(clippy::too_many_arguments)]
async fn run_plan(
    readonly_config: Arc<AgentConfig>,
    full_config: Arc<AgentConfig>,
    preamble: &str,
    content: &str,
    messages: &mut Vec<zapmyco_core::ConversationMessage>,
    wrap_input: &impl Fn(String, &mut bool) -> String,
    context_injected: &mut bool,
    run_session: Option<&RunSession>,
    tm: &Arc<task_manager::TaskManager>,
) -> Result<(), String> {
    // ════════════════════════════════════════════════════════════
    // Phase 1: 分析规划（只读工具）
    // ════════════════════════════════════════════════════════════
    output::send(&Message::info(
        "[Plan] Phase 1 — 分析规划阶段（仅只读工具）",
    ));

    let plan_prompt = wrap_input(
        format!("{}请开始分析规划。\n\n## 用户需求\n{}", preamble, content),
        context_injected,
    );

    let plan_text =
        run_agent_with_output(readonly_config.clone(), messages, &plan_prompt, run_session).await?;

    // 保存方案到文件
    if let Ok(cwd) = std::env::current_dir() {
        let plan_path = cwd.join(".zapmyco").join("plan.md");
        if let Some(parent) = plan_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&plan_path, &plan_text);
    }

    // ════════════════════════════════════════════════════════════
    // Phase 2: 审批循环
    // ════════════════════════════════════════════════════════════
    let mut current_plan = plan_text;
    loop {
        println!("\n─── 📋 方案 ───\n{}\n", current_plan);

        let approved = inquire::Confirm::new("是否按此方案执行？")
            .with_default(true)
            .prompt()
            .map_err(|e| e.to_string())?;

        if approved {
            break;
        }

        let feedback = inquire::Text::new("请输入修改意见（留空则重新询问）：")
            .prompt()
            .map_err(|e| e.to_string())?;

        if feedback.trim().is_empty() {
            println!("[Plan] 未收到修改意见，请提供方向或按 Ctrl+C 中断");
            continue;
        }

        output::send(&Message::info("[Plan] 收到反馈，优化方案中..."));

        messages.push(zapmyco_core::ConversationMessage::user(format!(
            "[用户对方案的反馈] {}\n\n请根据以上反馈调整方案。",
            feedback
        )));

        let feedback_prompt = format!(
            "{}请根据反馈调整方案。\n\n## 用户需求\n{}\n\n## 用户反馈\n请根据以上反馈调整方案。",
            preamble, content,
        );

        current_plan = run_agent_with_output(
            readonly_config.clone(),
            messages,
            &feedback_prompt,
            run_session,
        )
        .await?;

        if let Ok(cwd) = std::env::current_dir() {
            let plan_path = cwd.join(".zapmyco").join("plan.md");
            let _ = std::fs::write(&plan_path, &current_plan);
        }
    }

    // ════════════════════════════════════════════════════════════
    // Phase 3: 执行阶段（完整工具）
    // ════════════════════════════════════════════════════════════
    output::send(&Message::info("[Plan] Phase 3 — 执行阶段（已批准方案）"));

    let exec_prompt = format!(
        "方案已获批准，请开始实施。\n\n## 用户原始需求\n{}\n\n## 已批准方案\n{}",
        content, current_plan,
    );

    run_agent_with_output(full_config.clone(), messages, &exec_prompt, run_session).await?;

    // 任务执行循环
    run_task_loop_core(full_config.clone(), messages, tm, run_session).await?;

    // ════════════════════════════════════════════════════════════
    // Phase 4: 总结
    // ════════════════════════════════════════════════════════════
    output::send(&Message::info("[Plan] Phase 4 — 实施总结"));

    let _summary = run_agent_with_output(
        full_config.clone(),
        messages,
        "所有任务已完成，请总结本次工作。",
        run_session,
    )
    .await?;

    Ok(())
}

/// 运行 agent_loop 并收集完整输出文本
async fn run_agent_with_output(
    config: Arc<AgentConfig>,
    messages: &mut Vec<zapmyco_core::ConversationMessage>,
    input: &str,
    run_session: Option<&RunSession>,
) -> Result<String, String> {
    let (event_tx, mut event_rx) = mpsc::channel(256);

    let display = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            core_event_handler(&event);
        }
    });

    let result = agent_loop(config, messages, input, event_tx).await;
    display.await.ok();
    if let Some(s) = run_session {
        s.snapshot(messages);
    }

    match result {
        Ok(()) => Ok(messages
            .last()
            .map(|m| m.content.clone())
            .unwrap_or_default()),
        Err(e) => {
            let msg = format!("Agent 执行失败: {}", e);
            output::send(&Message::error(&msg));
            Err(msg)
        }
    }
}

/// 任务执行循环：读取 task_manager 中 pending 任务，驱动 LLM 逐个执行
async fn run_task_loop_core(
    config: Arc<AgentConfig>,
    messages: &mut Vec<zapmyco_core::ConversationMessage>,
    task_manager: &Arc<task_manager::TaskManager>,
    run_session: Option<&RunSession>,
) -> Result<(), String> {
    let mut task_completed = false;

    loop {
        let tasks = task_manager.list().await.map_err(|e| e.to_string())?;
        let pending_count = tasks
            .iter()
            .filter(|t| t.status != task_manager::TaskStatus::Completed)
            .count();

        if pending_count == 0 {
            if task_completed {
                output::send(&Message::info("✅ 全部任务已完成！"));
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

        let (event_tx, mut event_rx) = mpsc::channel(256);
        let display = tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                core_event_handler(&event);
            }
        });

        let result = tokio::select! {
            r = agent_loop(config.clone(), messages, &continuation, event_tx) => Some(r),
            _ = tokio::signal::ctrl_c() => None,
        };
        display.await.ok();
        if let Some(s) = run_session {
            s.snapshot(messages);
        }

        match result {
            Some(Ok(())) => {
                task_completed = true;
            }
            Some(Err(e)) => return Err(format!("任务执行失败: {}", e)),
            None => {
                // Ctrl+C 中断 LLM：让用户提供纠正输入
                let user_input =
                    inquire::Text::new("🛑 已中断 LLM 执行。请输入补充说明以纠正执行方向：")
                        .prompt()
                        .map_err(|e| e.to_string())?;
                messages.push(zapmyco_core::ConversationMessage::user(format!(
                    "[用户干预] {}\n\n请根据上述指引调整执行方向。",
                    user_input
                )));
                task_completed = true;
            }
        }
    }

    Ok(())
}

// ============================================================================
// 工具构建
// ============================================================================

/// 构建所有的工具
fn build_tools(
    resolved: &ResolvedLlmConfig,
    permission_mode: PermissionMode,
    active_skill: Option<&SkillFile>,
    tm: Arc<task_manager::TaskManager>,
    is_subagent: bool,
    parent_session_id: Option<&str>,
) -> Result<Vec<Box<dyn zapmyco_core::AgentTool>>, String> {
    let mut tools: Vec<Box<dyn zapmyco_core::AgentTool>> = Vec::new();

    // Ask User
    tools.push(Box::new(ask_user::AskUser::new()));

    // Web Fetch
    let wf = web_fetch::WebFetch::new(Default::default())
        .map_err(|e| format!("初始化 Web Fetch 失败: {}", e))?;
    tools.push(Box::new(wf));

    // Shell Exec
    let (allowed_commands, denied_commands) = crate::config::settings::load_settings()
        .ok()
        .flatten()
        .and_then(|s| s.permissions)
        .map(|p| (p.commands.allow, p.commands.deny))
        .unwrap_or_default();
    let shell = if permission_mode == PermissionMode::ReadOnly {
        shell_exec::ShellExec::new(shell_exec::ShellExecOptions {
            readonly_mode: true,
            allowed_commands: shell_exec::builtin_safe_commands(),
            denied_commands,
            skip_confirm: true,
            ..Default::default()
        })
    } else {
        shell_exec::ShellExec::new(shell_exec::ShellExecOptions {
            allowed_commands,
            denied_commands,
            ..Default::default()
        })
    };
    tools.push(Box::new(shell));

    // Web Search
    let search_model = crate::commands::config_resolver::get_search_model(&resolved.provider_name);
    let search_max_tokens = crate::commands::config_resolver::get_internal_max_tokens(search_model);
    if let Ok(ws) = web_search::WebSearch::new(
        resolved.api_key.clone(),
        resolved.base_url.clone(),
        search_model.to_string(),
        search_max_tokens,
    ) {
        tools.push(Box::new(ws));
    }

    // 文件操作工具
    tools.push(Box::new(file_search::FileSearch::new(Default::default())));
    tools.push(Box::new(file_find::FileFind::new(Default::default())));
    tools.push(Box::new(file_read::FileRead::new(Default::default())));
    tools.push(Box::new(file_edit::FileEdit::new(Default::default())));
    tools.push(Box::new(file_write::FileWrite::new(Default::default())));

    // Task 管理（共享同一 TaskManager）
    tools.push(Box::new(task_create::TaskCreate {
        manager: tm.clone(),
    }));
    tools.push(Box::new(task_get::TaskGet {
        manager: tm.clone(),
    }));
    tools.push(Box::new(task_list::TaskList {
        manager: tm.clone(),
    }));
    tools.push(Box::new(task_update::TaskUpdateTool {
        manager: tm.clone(),
    }));

    // SubAgent（子 Agent 进程不注册 SubAgent 工具，避免递归）
    if !is_subagent
        && let Ok(mut sa) = subagent::SubAgentTool::with_permission_mode(permission_mode)
    {
        sa.set_parent_session_id(parent_session_id.map(|s| s.to_string()));
        tools.push(Box::new(sa));
    }

    // Skill
    if let Ok(st) = skill::SkillTool::new() {
        tools.push(Box::new(st));
    }

    // Skill 工具过滤
    if let Some(skill) = active_skill
        && !skill.allowed_tools.is_empty()
    {
        let tool_names: Vec<String> = tools.iter().map(|t| t.name().to_string()).collect();
        let to_remove = compute_denied_tools(&tool_names, &skill.allowed_tools);
        if !to_remove.is_empty() {
            output::send(&Message::info(format!(
                "[Skill] 工具过滤: 仅允许 {:?}",
                skill.allowed_tools
            )));
            tools.retain(|t| !to_remove.iter().any(|r| r == t.name()));
        }
    }

    // 权限模式过滤
    if permission_mode != PermissionMode::Full {
        let deny_tools: &[&str] = match permission_mode {
            PermissionMode::ReadOnly => &["file_write", "file_edit"],
            PermissionMode::ReadWrite => &["shell_exec"],
            PermissionMode::Full => &[],
        };
        output::send(&Message::info(format!(
            "[权限模式] {:?} — 已禁止: {:?}",
            permission_mode, deny_tools,
        )));
        tools.retain(|t| !deny_tools.contains(&t.name()));
    }

    Ok(tools)
}

/// 为 user message 构建 skill body 前缀
fn build_skill_preamble(skill: Option<&SkillFile>) -> String {
    match skill {
        Some(s) => format!("## Skill: {}\n\n{}\n\n---\n\n", s.name, s.body),
        None => String::new(),
    }
}

// ============================================================================
// Session 生命周期与日志
// ============================================================================

/// run 会话 — 管理 session 目录、会话元数据与消息快照
struct RunSession {
    session_id: String,
    meta: Option<crate::session::logger::SessionMeta>,
}

impl RunSession {
    /// 启动会话：创建目录 + session.json 元数据。会话日志禁用时返回 None。
    fn start(
        resolved: &ResolvedLlmConfig,
        permission_mode: PermissionMode,
        is_subagent: bool,
        parent_session_id: Option<&str>,
        profile: Option<&str>,
    ) -> Result<Option<Self>, String> {
        let settings = crate::config::settings::load_settings().ok().flatten();
        let session_log_enabled = settings
            .as_ref()
            .map(crate::config::settings::is_session_log_enabled)
            .unwrap_or(true);
        if !session_log_enabled {
            return Ok(None);
        }
        let logger = crate::session::logger::SessionLogger::new()?;
        let session_id = logger.session_id().to_string();
        let session_dir = logger.session_dir();
        let meta = crate::session::logger::SessionMeta::create(
            &session_dir,
            &session_id,
            env!("CARGO_PKG_VERSION"),
            profile.unwrap_or("default"),
            &resolved.provider_name,
            &resolved.model,
            &resolved.base_url,
            &permission_mode.to_string(),
            is_subagent,
            parent_session_id,
            &crate::env_info::os_info(),
            &crate::env_info::shell_name(),
            &crate::env_info::locale_info(),
        )
        .ok();
        Ok(Some(Self { session_id, meta }))
    }

    /// 追加一行消息快照到 conversation.jsonl
    fn snapshot(&self, messages: &[zapmyco_core::ConversationMessage]) {
        if let Err(e) = crate::session::logger::append_messages_snapshot(&self.session_id, messages)
        {
            tracing::warn!(error = %e, "写入会话快照失败");
        }
    }

    /// 写入退出原因到 session.json
    fn finish(&self, reason: crate::session::logger::ExitReason) {
        if let Some(meta) = &self.meta {
            let _ = meta.finish(reason);
        }
    }
}

/// 在会话子目录中创建 terminal.log 并注册到全局 ROUTER
fn register_terminal_log(session_id: &str) -> Option<TerminalLogGuard> {
    let log_dir = crate::session::logger::get_sessions_dir().ok()?;
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
fn register_app_log(session_id: &str) -> Option<AppLogGuard> {
    let sessions_dir = crate::session::logger::get_sessions_dir().ok()?;
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

/// 生成唯一的任务列表 ID（用于 --task-id 恢复）
fn generate_session_id() -> String {
    format!("run_{}", chrono::Local::now().format("%Y%m%d_%H%M%S%9f"))
}

/// 注册 Ctrl+C 处理器：第一次优雅关闭，第二次强制退出
fn spawn_ctrl_c_handler() {
    tokio::spawn(async {
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
    });
}

/// 退出前检查仍在运行的后台子代理并报告（仅主 Agent）
fn check_running_subagents() {
    if let Ok(subagent_dir) = subagent::get_subagent_data_dir() {
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
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::PermissionMode;
    use crate::test_util::run_with_temp_home;

    fn setup_settings(home: &std::path::Path) {
        let settings_dir = home.join(".zapmyco");
        std::fs::create_dir_all(&settings_dir).unwrap();
        std::fs::write(settings_dir.join("settings.toml"), "[llm]\n").unwrap();
    }

    fn make_resolved() -> ResolvedLlmConfig {
        ResolvedLlmConfig {
            model: "deepseek-v4-flash".to_string(),
            api_key: "sk-test".to_string(),
            base_url: "https://api.test.com".to_string(),
            max_tokens: 4096,
            provider_name: "deepseek".to_string(),
        }
    }

    fn make_tm() -> Arc<task_manager::TaskManager> {
        Arc::new(task_manager::TaskManager::new())
    }

    #[test]
    fn test_build_tools_full_mode() {
        run_with_temp_home(|home| {
            setup_settings(home);
            let tools = build_tools(
                &make_resolved(),
                PermissionMode::Full,
                None,
                make_tm(),
                false,
                None,
            )
            .unwrap();
            let names: Vec<String> = tools.iter().map(|t| t.name().to_string()).collect();
            assert!(names.contains(&"file_read".to_string()));
            assert!(names.contains(&"shell_exec".to_string()));
            assert!(names.contains(&"file_write".to_string()));
        });
    }

    #[test]
    fn test_build_tools_readonly_mode() {
        run_with_temp_home(|home| {
            setup_settings(home);
            let tools = build_tools(
                &make_resolved(),
                PermissionMode::ReadOnly,
                None,
                make_tm(),
                false,
                None,
            )
            .unwrap();
            let names: Vec<String> = tools.iter().map(|t| t.name().to_string()).collect();
            assert!(names.contains(&"file_read".to_string()));
            assert!(!names.contains(&"file_write".to_string()));
        });
    }

    #[test]
    fn test_build_tools_subagent_skips_subagent_tool() {
        run_with_temp_home(|home| {
            setup_settings(home);
            let tools = build_tools(
                &make_resolved(),
                PermissionMode::Full,
                None,
                make_tm(),
                true,
                None,
            )
            .unwrap();
            let names: Vec<String> = tools.iter().map(|t| t.name().to_string()).collect();
            assert!(!names.contains(&"subagent".to_string()));
        });
    }

    #[test]
    fn test_core_tools_implement_agent_tool() {
        run_with_temp_home(|home| {
            setup_settings(home);
            let tools = build_tools(
                &make_resolved(),
                PermissionMode::Full,
                None,
                make_tm(),
                false,
                None,
            )
            .unwrap();
            for tool in &tools {
                assert!(!tool.name().is_empty());
                assert!(!tool.description().is_empty());
            }
        });
    }

    #[test]
    fn test_build_skill_preamble() {
        let skill = SkillFile {
            name: "test".to_string(),
            description: "A test skill".to_string(),
            body: "Do something".to_string(),
            allowed_tools: vec![],
        };
        let preamble = build_skill_preamble(Some(&skill));
        assert!(preamble.contains("test"));
        assert!(preamble.contains("Do something"));
    }

    #[test]
    fn test_build_skill_preamble_none() {
        assert_eq!(build_skill_preamble(None), "");
    }

    #[test]
    fn test_generate_session_id_format() {
        let id = generate_session_id();
        assert!(id.starts_with("run_"));
        assert!(id.len() > 10);
    }
}
