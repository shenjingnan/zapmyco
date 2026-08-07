//! `zapmyco-tools` 注入 trait 的主 crate 实现。
//!
//! 将工具对环境（终端输出、交互提示、会话日志、配置持久化、skill 解析）的
//! 依赖桥接到主 crate 的既有实现，供 `build_tools` / `build_web_tools` 装配
//! `zapmyco_tools::ToolsContext` 使用。

use std::path::Path;
use std::sync::Arc;

use zapmyco_tools::ToolsContext;
use zapmyco_tools::backend::{
    AllowlistPersister, OutputEmitter, OutputLevel, SessionLogger as SessionLoggerTrait,
    SkillResolver as SkillResolverTrait, UserPrompt as UserPromptTrait,
};
use zapmyco_tools::types::{
    MultiSelectResult, SelectOption, SingleSelectResult, SkillDescriptor, SkillFile, SkillSource,
};

use crate::config::settings;
use crate::output;
use crate::session::logger;
use crate::skills;
use crate::tui;

/// `OutputEmitter` → `crate::output::send`（终端渲染总线）
pub struct RouterEmitter;

impl OutputEmitter for RouterEmitter {
    fn emit(&self, level: OutputLevel, text: &str) {
        let msg = match level {
            OutputLevel::Info => output::Message::info(text.to_string()),
            OutputLevel::Warning => output::Message::warning(text.to_string()),
            OutputLevel::Error => output::Message::error(text.to_string()),
        };
        output::send(&msg);
    }
}

/// `UserPrompt` → `crate::tui` 的 SelectPrompt 组件
pub struct TuiPrompt;

impl UserPromptTrait for TuiPrompt {
    fn prompt_single_select(
        &self,
        question: &str,
        options: &[SelectOption],
    ) -> Option<SingleSelectResult> {
        let opts: Vec<tui::types::SelectOption<'_>> = options
            .iter()
            .map(|o| tui::types::SelectOption {
                label: &o.label,
                description: &o.description,
                custom_input: o.custom_input,
            })
            .collect();
        match tui::prompt_single_select(question, &opts) {
            Some(tui::types::SingleSelectResult::Index(i)) => Some(SingleSelectResult::Index(i)),
            Some(tui::types::SingleSelectResult::Custom(s)) => Some(SingleSelectResult::Custom(s)),
            None => None,
        }
    }

    fn prompt_multi_select(
        &self,
        question: &str,
        options: &[SelectOption],
    ) -> Option<MultiSelectResult> {
        let opts: Vec<tui::types::SelectOption<'_>> = options
            .iter()
            .map(|o| tui::types::SelectOption {
                label: &o.label,
                description: &o.description,
                custom_input: o.custom_input,
            })
            .collect();
        tui::prompt_multi_select(question, &opts).map(|r| MultiSelectResult {
            indices: r.indices,
            custom_text: r.custom_text,
        })
    }
}

/// `SessionLogger` → `crate::session::logger::log_user_event`
pub struct SessionLoggerBackend;

impl SessionLoggerTrait for SessionLoggerBackend {
    fn log_user_event(&self, event: &str) {
        logger::log_user_event(event);
    }
}

/// `AllowlistPersister` → `crate::config::settings::add_to_command_allowlist`
pub struct SettingsAllowlistPersister;

impl AllowlistPersister for SettingsAllowlistPersister {
    fn add_to_command_allowlist(&self, command: &str) -> Result<(), String> {
        settings::add_to_command_allowlist(command)
    }
}

/// `SkillResolver` → `crate::skills::{discovery, loader}`
pub struct SkillsResolverBackend;

impl SkillResolverTrait for SkillsResolverBackend {
    fn list_available_skills(&self, cwd: &Path) -> Vec<SkillDescriptor> {
        skills::discovery::list_available_skills(cwd)
            .into_iter()
            .map(|s| SkillDescriptor {
                name: s.name,
                description: s.description,
                source: map_source(s.source),
            })
            .collect()
    }

    fn resolve_skill(&self, name: &str, cwd: &Path) -> Option<SkillFile> {
        skills::discovery::resolve_skill(name, cwd).map(|s| SkillFile {
            name: s.name,
            description: s.description,
            allowed_tools: s.allowed_tools,
            body: s.body,
        })
    }

    fn build_skill_list_text(&self, tools_skills: &[SkillDescriptor]) -> String {
        let skills: Vec<skills::types::SkillDescriptor> = tools_skills
            .iter()
            .map(|s| skills::types::SkillDescriptor {
                name: s.name.clone(),
                description: s.description.clone(),
                source: map_source_back(s.source.clone()),
            })
            .collect();
        skills::loader::build_skill_list_text(&skills)
    }
}

fn map_source(s: skills::types::SkillSource) -> SkillSource {
    match s {
        skills::types::SkillSource::Project => SkillSource::Project,
        skills::types::SkillSource::ProjectAgents => SkillSource::ProjectAgents,
        skills::types::SkillSource::User => SkillSource::User,
    }
}

fn map_source_back(s: SkillSource) -> skills::types::SkillSource {
    match s {
        SkillSource::Project => skills::types::SkillSource::Project,
        SkillSource::ProjectAgents => skills::types::SkillSource::ProjectAgents,
        SkillSource::User => skills::types::SkillSource::User,
    }
}

/// 构造 CLI/Web 通用的 `ToolsContext`（全部桥接到主 crate 既有实现）。
pub fn default_tools_context() -> ToolsContext {
    ToolsContext {
        output: Arc::new(RouterEmitter),
        prompt: Arc::new(TuiPrompt),
        session_logger: Arc::new(SessionLoggerBackend),
        allowlist_persister: Arc::new(SettingsAllowlistPersister),
        skill_resolver: Arc::new(SkillsResolverBackend),
    }
}
