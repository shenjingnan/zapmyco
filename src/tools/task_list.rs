// task_list 工具 — 列出所有任务及其状态
//
// 适用于了解整体进度、查找可认领的任务、检查阻塞关系。
// 开始复杂工作前应先调用此工具查看现状。

use crate::tools::task_manager::TaskManager;
use async_trait::async_trait;
use std::sync::Arc;
use zapmyco_core::AgentTool;

pub struct TaskList {
    pub manager: Arc<TaskManager>,
}

#[async_trait]
impl AgentTool for TaskList {
    fn name(&self) -> &str {
        Self::tool_name()
    }

    fn description(&self) -> &str {
        Self::tool_description()
    }

    fn input_schema(&self) -> serde_json::Value {
        Self::input_schema()
    }

    async fn execute(&self, input: serde_json::Value) -> Result<String, String> {
        self.execute(&input).await
    }
}

impl TaskList {
    /// 工具名称
    pub fn tool_name() -> &'static str {
        "task_list"
    }

    /// 工具描述
    pub fn tool_description() -> &'static str {
        "列出所有任务及其状态。适用于了解整体进度、查找可认领的任务、\
         以及检查哪些任务被阻塞。开始复杂工作前应先调用此工具查看现状。"
    }

    /// 工具输入 JSON Schema
    pub fn input_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {}
        })
    }

    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: Self::tool_name().to_string(),
            description: Some(Self::tool_description().to_string()),
            input_schema: Some(Self::input_schema()),
            ..Default::default()
        }
    }

    pub async fn execute(&self, _input: &serde_json::Value) -> Result<String, String> {
        let tasks = self
            .manager
            .list()
            .await
            .map_err(|e| format!("列出任务失败: {}", e))?;

        if tasks.is_empty() {
            return Ok("暂无任务。使用 task_create 创建新任务。".to_string());
        }

        let lines: Vec<String> = tasks.iter().map(|t| t.summary_line()).collect();
        Ok(lines.join("\n"))
    }
}
