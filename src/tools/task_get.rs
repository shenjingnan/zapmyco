// task_get 工具 — 按 ID 获取单个任务详情
//
// 适用于开始工作前查看任务的完整描述、状态和依赖关系。

use crate::tools::task_manager::TaskManager;
use std::sync::Arc;

pub struct TaskGet {
    pub manager: Arc<TaskManager>,
}

impl TaskGet {
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "task_get".to_string(),
            description: Some(
                "按 ID 获取任务的详细信息，包括描述、状态、依赖关系和负责人。\
                 适用于开始工作前查看任务详情，或了解任务被哪些依赖阻塞。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "要获取的任务 ID"
                    }
                },
                "required": ["task_id"]
            })),
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
