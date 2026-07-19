//! `core-run` 命令 — 使用 Core 层的 `agent_loop()` 执行 AI 任务。
//!
//! 这是从 `cmd_run()`（基于 AiAgent）到 Core 层的迁移路径。
//! 支持 Base 模式（单次执行 + 工具调用）和 Plan 模式（分析→审批→执行→总结）。

use std::sync::Arc;

use tokio::sync::mpsc;

use crate::agent::chat::ToolHandler;
use crate::cli::{ExecutionMode, PermissionMode};
use crate::core::{AgentConfig, agent_loop, core_event_handler, from_tool_handlers};
use crate::output::{self, Message};
use crate::skills::discovery::{list_available_skills, resolve_skill};
use crate::skills::loader::{build_skill_list_text, compute_denied_tools};
use crate::skills::types::SkillFile;
use crate::tools::{
    ask_user, file_edit, file_find, file_read, file_search, file_write, shell_exec, skill,
    subagent, task_manager, web_fetch, web_search,
};

use super::config_resolver::{ResolvedLlmConfig, resolve_llm_config};

/// core-run 命令入口 — 使用 Core 层执行 AI 任务
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
) -> Result<(), String> {
    // ── Step 1: 解析 content ──
    let content = match content {
        Some(c) => c.to_string(),
        None => {
            return Err("任务描述不能为空。\n使用: zapmyco core-run \"任务描述\"".to_string());
        }
    };

    tracing::info!(
        input_len = content.len(),
        profile = profile.unwrap_or("default"),
        mode = ?mode,
        "core-run 开始执行"
    );

    // ── Step 2: 扫描和加载 skill ──
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let all_skills = list_available_skills(&cwd);

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
                }
                return Err(msg);
            }
        }
    } else {
        None
    };

    // ── Step 3: 解析 LLM 配置 ──
    let resolved = resolve_llm_config(profile, model, api_key, base_url)?;

    // ── Step 4: 构建 system prompt ──
    let base_prompt = format!(
        "{}{}",
        crate::agent::system_prompt::DEFAULT_SYSTEM_PROMPT,
        crate::agent::system_prompt::BEHAVIORAL_GUIDANCE,
    );
    let skill_list = build_skill_list_text(&all_skills);
    let system_prompt = if skill_list.is_empty() {
        base_prompt
    } else {
        format!("{}\n\n{}", base_prompt, skill_list)
    };

    // ── Step 5: 构建工具集 ──
    let all_handlers = build_tool_handlers(&resolved, permission_mode, active_skill.as_ref())?;

    // 完整工具（Phase 3 执行用）
    let full_tools = from_tool_handlers(all_handlers);

    // 只读工具（Phase 1 分析用）：过滤掉写操作工具
    let readonly_names = ["file_write", "file_edit", "shell_exec"];
    let readonly_tools = from_tool_handlers(
        build_tool_handlers(&resolved, permission_mode, active_skill.as_ref())?
            .into_iter()
            .filter(|h| !readonly_names.contains(&h.tool_definition().name.as_str()))
            .collect(),
    );

    // ── Step 6: 构建 Core 配置 ──
    let make_config = |tools: Vec<Box<dyn crate::core::AgentTool>>| -> Arc<AgentConfig> {
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

    // ── Step 7: 运行 ──
    match mode {
        ExecutionMode::Base => run_base(readonly_config, &preamble, &content).await,
        ExecutionMode::Plan => run_plan(readonly_config, full_config, &preamble, &content).await,
    }
}

// ============================================================================
// Base 模式
// ============================================================================

async fn run_base(config: Arc<AgentConfig>, preamble: &str, content: &str) -> Result<(), String> {
    let full_prompt = format!("{}{}", preamble, content);
    let (event_tx, mut event_rx) = mpsc::channel(256);

    let display = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            core_event_handler(&event);
        }
    });

    let mut messages = vec![];
    let result = agent_loop(config, &mut messages, &full_prompt, event_tx).await;

    display.await.ok();

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

async fn run_plan(
    readonly_config: Arc<AgentConfig>,
    full_config: Arc<AgentConfig>,
    preamble: &str,
    content: &str,
) -> Result<(), String> {
    // ════════════════════════════════════════════════════════════
    // Phase 1: 分析规划（只读工具）
    // ════════════════════════════════════════════════════════════
    output::send(&Message::info(
        "[Plan] Phase 1 — 分析规划阶段（仅只读工具）",
    ));

    let plan_prompt = format!("{}请开始分析规划。\n\n## 用户需求\n{}", preamble, content,);

    let mut messages = vec![];
    let plan_text =
        run_agent_with_output(readonly_config.clone(), &mut messages, &plan_prompt).await?;

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

        messages.push(crate::core::ConversationMessage::user(format!(
            "[用户对方案的反馈] {}\n\n请根据以上反馈调整方案。",
            feedback
        )));

        let feedback_prompt = format!(
            "{}请根据反馈调整方案。\n\n## 用户需求\n{}\n\n## 用户反馈\n请根据以上反馈调整方案。",
            preamble, content,
        );

        current_plan =
            run_agent_with_output(readonly_config.clone(), &mut messages, &feedback_prompt).await?;

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

    let tm = std::sync::Arc::new(task_manager::TaskManager::new());
    run_agent_with_output(full_config.clone(), &mut messages, &exec_prompt).await?;

    // 任务执行循环
    run_task_loop_core(full_config.clone(), &mut messages, tm.clone()).await?;

    // ════════════════════════════════════════════════════════════
    // Phase 4: 总结
    // ════════════════════════════════════════════════════════════
    output::send(&Message::info("[Plan] Phase 4 — 实施总结"));

    let _summary = run_agent_with_output(
        full_config.clone(),
        &mut messages,
        "所有任务已完成，请总结本次工作。",
    )
    .await?;

    Ok(())
}

/// 运行 agent_loop 并收集完整输出文本
async fn run_agent_with_output(
    config: Arc<AgentConfig>,
    messages: &mut Vec<crate::core::ConversationMessage>,
    input: &str,
) -> Result<String, String> {
    let (event_tx, mut event_rx) = mpsc::channel(256);

    let display = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            core_event_handler(&event);
        }
    });

    let result = agent_loop(config, messages, input, event_tx).await;
    display.await.ok();

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
    messages: &mut Vec<crate::core::ConversationMessage>,
    task_manager: std::sync::Arc<task_manager::TaskManager>,
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

        let result = agent_loop(config.clone(), messages, &continuation, event_tx).await;
        display.await.ok();

        match result {
            Ok(()) => {
                task_completed = true;
            }
            Err(e) => return Err(format!("任务执行失败: {}", e)),
        }
    }

    Ok(())
}

// ============================================================================
// 工具构建
// ============================================================================

/// 构建所有的工具处理器
fn build_tool_handlers(
    resolved: &ResolvedLlmConfig,
    permission_mode: PermissionMode,
    active_skill: Option<&SkillFile>,
) -> Result<Vec<ToolHandler>, String> {
    let mut handlers: Vec<ToolHandler> = Vec::new();

    // Ask User
    handlers.push(ToolHandler::AskUser(ask_user::AskUser::new()));

    // Web Fetch
    let wf = web_fetch::WebFetch::new(Default::default())
        .map_err(|e| format!("初始化 Web Fetch 失败: {}", e))?;
    handlers.push(ToolHandler::WebFetch(wf));

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
    handlers.push(ToolHandler::ShellExec(shell));

    // Web Search
    let search_model = crate::commands::config_resolver::get_search_model(&resolved.provider_name);
    let search_max_tokens = crate::commands::config_resolver::get_internal_max_tokens(search_model);
    if let Ok(ws) = web_search::WebSearch::new(
        resolved.api_key.clone(),
        resolved.base_url.clone(),
        search_model.to_string(),
        search_max_tokens,
    ) {
        handlers.push(ToolHandler::WebSearch(ws));
    }

    // 文件操作工具
    handlers.push(ToolHandler::FileSearch(file_search::FileSearch::new(
        Default::default(),
    )));
    handlers.push(ToolHandler::FileFind(file_find::FileFind::new(
        Default::default(),
    )));
    handlers.push(ToolHandler::FileRead(file_read::FileRead::new(
        Default::default(),
    )));
    handlers.push(ToolHandler::FileEdit(file_edit::FileEdit::new(
        Default::default(),
    )));
    handlers.push(ToolHandler::FileWrite(file_write::FileWrite::new(
        Default::default(),
    )));

    // Task 管理
    let tm = std::sync::Arc::new(task_manager::TaskManager::new());
    handlers.push(ToolHandler::TaskCreate(tm.clone()));
    handlers.push(ToolHandler::TaskGet(tm.clone()));
    handlers.push(ToolHandler::TaskList(tm.clone()));
    handlers.push(ToolHandler::TaskUpdate(tm.clone()));

    // SubAgent + Skill
    if let Ok(sa) = subagent::SubAgentTool::with_permission_mode(permission_mode) {
        handlers.push(ToolHandler::SubAgent(sa));
    }
    if let Ok(st) = skill::SkillTool::new() {
        handlers.push(ToolHandler::Skill(st));
    }

    // Skill 工具过滤
    if let Some(skill) = active_skill
        && !skill.allowed_tools.is_empty()
    {
        let tool_names: Vec<String> = handlers.iter().map(|h| h.tool_definition().name).collect();
        let to_remove = compute_denied_tools(&tool_names, &skill.allowed_tools);
        if !to_remove.is_empty() {
            output::send(&Message::info(format!(
                "[Skill] 工具过滤: 仅允许 {:?}",
                skill.allowed_tools
            )));
            handlers.retain(|h| {
                let name = h.tool_definition().name;
                !to_remove.contains(&name)
            });
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
        handlers.retain(|h| {
            let name = h.tool_definition().name;
            !deny_tools.contains(&name.as_str())
        });
    }

    Ok(handlers)
}

/// 为 user message 构建 skill body 前缀
fn build_skill_preamble(skill: Option<&SkillFile>) -> String {
    match skill {
        Some(s) => format!("## Skill: {}\n\n{}\n\n---\n\n", s.name, s.body),
        None => String::new(),
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

    #[test]
    fn test_build_tools_full_mode() {
        run_with_temp_home(|home| {
            setup_settings(home);
            let handlers =
                build_tool_handlers(&make_resolved(), PermissionMode::Full, None).unwrap();
            let names: Vec<String> = handlers.iter().map(|h| h.tool_definition().name).collect();
            assert!(names.contains(&"file_read".to_string()));
            assert!(names.contains(&"shell_exec".to_string()));
            assert!(names.contains(&"file_write".to_string()));
        });
    }

    #[test]
    fn test_build_tools_readonly_mode() {
        run_with_temp_home(|home| {
            setup_settings(home);
            let handlers =
                build_tool_handlers(&make_resolved(), PermissionMode::ReadOnly, None).unwrap();
            let names: Vec<String> = handlers.iter().map(|h| h.tool_definition().name).collect();
            assert!(names.contains(&"file_read".to_string()));
            assert!(!names.contains(&"file_write".to_string()));
        });
    }

    #[test]
    fn test_core_tools_implement_agent_tool() {
        run_with_temp_home(|home| {
            setup_settings(home);
            let handlers =
                build_tool_handlers(&make_resolved(), PermissionMode::Full, None).unwrap();
            let core_tools = from_tool_handlers(handlers);
            for tool in &core_tools {
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
}
