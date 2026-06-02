// task_create 工具 — 创建新任务
//
// 当 LLM 需要将复杂工作拆解为可跟踪的子任务时使用此工具。
// 新任务默认状态为 pending。

use crate::tools::task_manager::TaskManager;
use std::sync::Arc;

pub struct TaskCreate {
    pub manager: Arc<TaskManager>,
}

impl TaskCreate {
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "task_create".to_string(),
            description: Some(
                "创建新任务以跟踪复杂工作的进度。\
                 当你需要完成 3 个以上步骤的复杂任务时，使用此工具主动创建任务列表。\
                 接收到用户新指令后，立即将需求拆解为可跟踪的任务。\
                 创建后使用 task_list 查看所有任务，使用 task_update 更新任务状态。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "subject": {
                        "type": "string",
                        "description": "简洁的任务标题（如：'实现用户登录功能'）"
                    },
                    "description": {
                        "type": "string",
                        "description": "任务的具体描述和完成标准"
                    },
                    "active_form": {
                        "type": "string",
                        "description": "进行时态，用于进度显示（如：'正在实现登录'）"
                    }
                },
                "required": ["subject", "description"]
            })),
            ..Default::default()
        }
    }

    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        let subject = input
            .get("subject")
            .and_then(|v| v.as_str())
            .ok_or("缺少必填参数 'subject'")?;
        let description = input
            .get("description")
            .and_then(|v| v.as_str())
            .ok_or("缺少必填参数 'description'")?;
        let active_form = input.get("active_form").and_then(|v| v.as_str());

        let task = self
            .manager
            .create(subject, description, active_form, None)
            .await
            .map_err(|e| format!("创建任务失败: {}", e))?;

        Ok(format!(
            "Task #{} created successfully: {}",
            task.id, task.subject
        ))
    }
}
