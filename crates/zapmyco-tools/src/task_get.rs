// task_get 工具 — 按 ID 获取单个任务详情
//
// 适用于开始工作前查看任务的完整描述、状态和依赖关系。

use crate::task_manager::TaskManager;
use async_trait::async_trait;
use std::sync::Arc;
use zapmyco_core::AgentTool;

pub struct TaskGet {
    pub manager: Arc<TaskManager>,
}

#[async_trait]
impl AgentTool for TaskGet {
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

impl TaskGet {
    /// 工具名称
    pub fn tool_name() -> &'static str {
        "task_get"
    }

    /// 工具描述
    pub fn tool_description() -> &'static str {
        "按 ID 获取任务的详细信息，包括描述、状态、依赖关系和负责人。\
         适用于开始工作前查看任务详情，或了解任务被哪些依赖阻塞。"
    }

    /// 工具输入 JSON Schema
    pub fn input_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "要获取的任务 ID"
                }
            },
            "required": ["task_id"]
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

    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        let task_id = input
            .get("task_id")
            .and_then(|v| v.as_str())
            .ok_or("缺少必填参数 'task_id'")?;

        match self
            .manager
            .get(task_id)
            .await
            .map_err(|e| format!("获取任务失败: {}", e))?
        {
            Some(task) => Ok(task.detail()),
            None => Ok(format!("Task #{} not found", task_id)),
        }
    }
}
