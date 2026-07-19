//! `core-run` 命令 — 使用 Core 层的 `agent_loop()` 执行 AI 任务。
//!
//! 这是从 `cmd_run()`（基于 AiAgent）到 Core 层的迁移路径。
//! 当前支持 Base 模式（单次执行 + 工具调用），Plan 模式后续加入。

use std::sync::Arc;

use tokio::sync::mpsc;

use crate::agent::chat::ToolHandler;
use crate::cli::PermissionMode;
use crate::core::{AgentConfig, agent_loop};
use crate::core::{core_event_handler, from_tool_handlers};
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
///
/// 当前支持 Base 模式，Plan 模式待后续加入。
pub(crate) async fn cmd_core_run(
    content: Option<&str>,
    skill_name: Option<&str>,
    profile: Option<&str>,
    permission_mode: PermissionMode,
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

    // ── Step 5: 构建工具 ──
    let tool_handlers = build_tool_handlers(&resolved, permission_mode, active_skill.as_ref())?;
    let core_tools = from_tool_handlers(tool_handlers);

    // ── Step 6: 构建 Core 配置 ──
    let config = Arc::new(
        AgentConfig::new(&resolved.model, &resolved.api_key, &resolved.base_url)
            .with_max_tokens(resolved.max_tokens)
            .with_system_prompt(&system_prompt)
            .with_tools(core_tools),
    );

    // ── Step 7: 构建 skill 前缀 ──
    let preamble = build_skill_preamble(active_skill.as_ref());
    let full_prompt = format!("{}{}", preamble, content);

    // ── Step 8: 创建事件通道和消费者 ──
    let (event_tx, mut event_rx) = mpsc::channel(256);

    let display = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            core_event_handler(&event);
        }
    });

    // ── Step 9: 运行 Core 循环 ──
    let mut messages = vec![];
    let result = agent_loop(config, &mut messages, &full_prompt, event_tx).await;

    // 等待事件处理完成
    display.await.ok();

    // ── Step 10: 处理结果 ──
    match result {
        Ok(()) => Ok(()),
        Err(e) => {
            output::send(&Message::error(format!("Agent 执行失败: {}", e)));
            Err(format!("Agent 执行失败: {}", e))
        }
    }
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

    /// 验证 build_tool_handlers 在 Full 模式下包含所有关键工具
    #[test]
    fn test_build_tools_full_mode() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "[llm]\n").unwrap();

            let resolved = ResolvedLlmConfig {
                model: "deepseek-v4-flash".to_string(),
                api_key: "sk-test".to_string(),
                base_url: "https://api.test.com".to_string(),
                max_tokens: 4096,
                provider_name: "deepseek".to_string(),
            };

            let handlers = build_tool_handlers(&resolved, PermissionMode::Full, None).unwrap();
            let names: Vec<String> = handlers.iter().map(|h| h.tool_definition().name).collect();

            assert!(names.contains(&"file_read".to_string()), "应包含 file_read");
            assert!(
                names.contains(&"shell_exec".to_string()),
                "应包含 shell_exec"
            );
            assert!(
                names.contains(&"file_write".to_string()),
                "应包含 file_write"
            );
        });
    }

    /// 验证 ReadOnly 模式下过滤了写工具
    #[test]
    fn test_build_tools_readonly_mode() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "[llm]\n").unwrap();

            let resolved = ResolvedLlmConfig {
                model: "deepseek-v4-flash".to_string(),
                api_key: "sk-test".to_string(),
                base_url: "https://api.test.com".to_string(),
                max_tokens: 4096,
                provider_name: "deepseek".to_string(),
            };

            let handlers = build_tool_handlers(&resolved, PermissionMode::ReadOnly, None).unwrap();
            let names: Vec<String> = handlers.iter().map(|h| h.tool_definition().name).collect();

            assert!(names.contains(&"file_read".to_string()), "应保留 file_read");
            assert!(
                names.contains(&"shell_exec".to_string()),
                "ReadOnly 应保留 shell_exec（受限模式）"
            );
            assert!(
                !names.contains(&"file_write".to_string()),
                "不应包含 file_write"
            );
            assert!(
                !names.contains(&"file_edit".to_string()),
                "不应包含 file_edit"
            );
        });
    }

    /// 验证 from_tool_handlers 转换后的工具实现了 AgentTool trait
    #[test]
    fn test_core_tools_implement_agent_tool() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "[llm]\n").unwrap();

            let resolved = ResolvedLlmConfig {
                model: "deepseek-v4-flash".to_string(),
                api_key: "sk-test".to_string(),
                base_url: "https://api.test.com".to_string(),
                max_tokens: 4096,
                provider_name: "deepseek".to_string(),
            };

            let handlers = build_tool_handlers(&resolved, PermissionMode::Full, None).unwrap();
            let core_tools = from_tool_handlers(handlers);

            // 验证所有工具都有名称和描述
            for tool in &core_tools {
                assert!(!tool.name().is_empty(), "工具名称不能为空");
                assert!(!tool.description().is_empty(), "工具描述不能为空");
            }
        });
    }

    /// 验证 skill 前缀构建
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
