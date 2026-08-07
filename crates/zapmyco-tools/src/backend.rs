//! 注入 trait 与聚合上下文 — 将工具对环境（终端输出、交互提示、会话日志、
//! 配置持久化、skill 解析）的依赖抽象为可注入后端，使 `zapmyco-tools` 保持
//! 环境无关，由宿主（主 crate / 外部项目）实现并注入。

use std::path::Path;
use std::sync::Arc;

use crate::types::{
    MultiSelectResult, SelectOption, SingleSelectResult, SkillDescriptor, SkillFile,
};

/// 输出级别（映射到主 crate `output::Message::info/warning/error`）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputLevel {
    Info,
    Warning,
    Error,
}

/// 输出后端 — 替换 `crate::output::send(&Message::info/warning/...)`
pub trait OutputEmitter: Send + Sync {
    fn emit(&self, level: OutputLevel, text: &str);
}

/// 用户交互后端 — 替换 `crate::tui::prompt_single_select` / `prompt_multi_select`
pub trait UserPrompt: Send + Sync {
    fn prompt_single_select(
        &self,
        question: &str,
        options: &[SelectOption],
    ) -> Option<SingleSelectResult>;
    fn prompt_multi_select(
        &self,
        question: &str,
        options: &[SelectOption],
    ) -> Option<MultiSelectResult>;
}

/// 会话日志后端 — 替换 `crate::session::logger::log_user_event`
pub trait SessionLogger: Send + Sync {
    fn log_user_event(&self, event: &str);
}

/// 白名单持久化后端 — 替换 `crate::config::settings::add_to_command_allowlist`
pub trait AllowlistPersister: Send + Sync {
    fn add_to_command_allowlist(&self, command: &str) -> Result<(), String>;
}

/// Skill 解析后端 — 替换 `crate::skills::{discovery, loader}`
pub trait SkillResolver: Send + Sync {
    fn list_available_skills(&self, cwd: &Path) -> Vec<SkillDescriptor>;
    fn resolve_skill(&self, name: &str, cwd: &Path) -> Option<SkillFile>;
    fn build_skill_list_text(&self, skills: &[SkillDescriptor]) -> String;
}

// ── no-op 默认实现：未注入时安全降级（输出静默、交互被拒、白名单写入成功、skill 为空）──

struct NoopOutputEmitter;
impl OutputEmitter for NoopOutputEmitter {
    fn emit(&self, _level: OutputLevel, _text: &str) {}
}

struct NoopUserPrompt;
impl UserPrompt for NoopUserPrompt {
    fn prompt_single_select(
        &self,
        _question: &str,
        _options: &[SelectOption],
    ) -> Option<SingleSelectResult> {
        None
    }
    fn prompt_multi_select(
        &self,
        _question: &str,
        _options: &[SelectOption],
    ) -> Option<MultiSelectResult> {
        None
    }
}

struct NoopSessionLogger;
impl SessionLogger for NoopSessionLogger {
    fn log_user_event(&self, _event: &str) {}
}

struct NoopAllowlistPersister;
impl AllowlistPersister for NoopAllowlistPersister {
    fn add_to_command_allowlist(&self, _command: &str) -> Result<(), String> {
        Ok(())
    }
}

struct NoopSkillResolver;
impl SkillResolver for NoopSkillResolver {
    fn list_available_skills(&self, _cwd: &Path) -> Vec<SkillDescriptor> {
        Vec::new()
    }
    fn resolve_skill(&self, _name: &str, _cwd: &Path) -> Option<SkillFile> {
        None
    }
    fn build_skill_list_text(&self, _skills: &[SkillDescriptor]) -> String {
        String::new()
    }
}

/// 聚合装配 — 各工具共享同一 `ToolsContext`，由宿主一次性构造并克隆注入。
#[derive(Clone)]
pub struct ToolsContext {
    pub output: Arc<dyn OutputEmitter>,
    pub prompt: Arc<dyn UserPrompt>,
    pub session_logger: Arc<dyn SessionLogger>,
    pub allowlist_persister: Arc<dyn AllowlistPersister>,
    pub skill_resolver: Arc<dyn SkillResolver>,
}

impl std::fmt::Debug for ToolsContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolsContext").finish_non_exhaustive()
    }
}

impl Default for ToolsContext {
    fn default() -> Self {
        Self {
            output: Arc::new(NoopOutputEmitter),
            prompt: Arc::new(NoopUserPrompt),
            session_logger: Arc::new(NoopSessionLogger),
            allowlist_persister: Arc::new(NoopAllowlistPersister),
            skill_resolver: Arc::new(NoopSkillResolver),
        }
    }
}
