//! Web 模式工具构建 — 8 个工具，AskUser/ShellExec 使用 Channel 后端。
//!
//! `CwdShellExec` 包装器负责跨命令跟踪工作目录（core 层零环境依赖，不感知 cwd）。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};
use zapmyco_core::AgentTool;

use crate::tools::confirm::{AskBackend, ConfirmBackend, PendingApprovals, PendingAsks};
use crate::tools::{
    ask_user, file_edit, file_find, file_read, file_search, file_write,
    shell_exec::{ShellExec, ShellExecOptions},
    web_fetch,
};

/// 解析 shell_exec 结果首行的 "Working directory: <path>"（cwd 追踪）
pub(crate) fn parse_working_dir(text: &str) -> Option<String> {
    text.lines()
        .next()
        .and_then(|l| l.strip_prefix("Working directory: "))
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string())
}

/// ShellExec 的 cwd 注入包装器：缺失 working_directory 时注入共享 cwd，
/// 执行后从结果解析并更新共享 cwd。核心层不感知 cwd，故在 Web 适配层实现。
pub(crate) struct CwdShellExec {
    inner: ShellExec,
    cwd: Arc<Mutex<PathBuf>>,
}

#[async_trait]
impl AgentTool for CwdShellExec {
    fn name(&self) -> &str {
        ShellExec::tool_name()
    }

    fn description(&self) -> &str {
        ShellExec::tool_description()
    }

    fn input_schema(&self) -> Value {
        ShellExec::input_schema()
    }

    async fn execute(&self, input: Value) -> Result<String, String> {
        let mut input = input;
        let command = input
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing required 'command' parameter".to_string())?
            .to_string();
        let description = input
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // 缺失或空 working_directory 时注入共享 cwd
        let needs_inject = input
            .get("working_directory")
            .and_then(|v| v.as_str())
            .is_none_or(|s| s.is_empty());
        if needs_inject {
            let cwd = { self.cwd.lock().unwrap().clone() }; // await 前释放锁
            input["working_directory"] = json!(cwd.to_string_lossy().to_string());
        }
        let working_directory = input
            .get("working_directory")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let result = self
            .inner
            .execute(
                &command,
                description.as_deref(),
                working_directory.as_deref(),
            )
            .await
            .map_err(|e| e.to_string());
        if let Ok(text) = &result
            && let Some(path) = parse_working_dir(text)
        {
            *self.cwd.lock().unwrap() = PathBuf::from(path);
        }
        result
    }
}

/// 构建 web 的 8 个工具（Channel 后端）
pub(crate) fn build_web_tools(
    approvals: &PendingApprovals,
    asks: &PendingAsks,
    cwd: Arc<Mutex<PathBuf>>,
) -> Result<Vec<Box<dyn AgentTool>>, String> {
    let mut tools: Vec<Box<dyn AgentTool>> = Vec::new();

    tools.push(Box::new(ask_user::AskUser::with_backend(
        AskBackend::Channel(asks.clone()),
    )));

    tools.push(Box::new(CwdShellExec {
        inner: ShellExec::new(ShellExecOptions {
            confirm_backend: ConfirmBackend::Channel(approvals.clone()),
            ..Default::default()
        }),
        cwd,
    }));

    let wf = web_fetch::WebFetch::new(Default::default())
        .map_err(|e| format!("初始化 WebFetch 失败: {e}"))?;
    tools.push(Box::new(wf));

    tools.push(Box::new(file_search::FileSearch::new(Default::default())));
    tools.push(Box::new(file_find::FileFind::new(Default::default())));
    tools.push(Box::new(file_read::FileRead::new(Default::default())));
    tools.push(Box::new(file_edit::FileEdit::new(Default::default())));
    tools.push(Box::new(file_write::FileWrite::new(Default::default())));

    Ok(tools)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_working_dir() {
        let text = "Working directory: /tmp/test\n\nExit code: 0\n\n--- STDOUT ---\n...";
        assert_eq!(parse_working_dir(text), Some("/tmp/test".to_string()));

        assert_eq!(parse_working_dir("Exit code: 0\n"), None);
        assert_eq!(parse_working_dir("Working directory: "), None);
        assert_eq!(parse_working_dir(""), None);
    }

    #[test]
    fn test_build_web_tools_has_eight() {
        let approvals = PendingApprovals::new();
        let asks = PendingAsks::new();
        let cwd = Arc::new(Mutex::new(PathBuf::from("/tmp")));
        let tools = build_web_tools(&approvals, &asks, cwd).unwrap();
        let names: Vec<String> = tools.iter().map(|t| t.name().to_string()).collect();
        assert_eq!(names.len(), 8);
        assert!(names.contains(&"ask_user".to_string()));
        assert!(names.contains(&"shell_exec".to_string()));
        assert!(names.contains(&"web_fetch".to_string()));
        assert!(names.contains(&"file_read".to_string()));
        assert!(names.contains(&"file_write".to_string()));
    }
}
