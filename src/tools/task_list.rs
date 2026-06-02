// task_list 工具 — 列出所有任务及其状态
//
// 适用于了解整体进度、查找可认领的任务、检查阻塞关系。
// 开始复杂工作前应先调用此工具查看现状。

use crate::tools::task_manager::TaskManager;
use std::sync::Arc;

pub struct TaskList {
    pub manager: Arc<TaskManager>,
}

impl TaskList {
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "task_list".to_string(),
            description: Some(
                "列出所有任务及其状态。适用于了解整体进度、查找可认领的任务、\
                 以及检查哪些任务被阻塞。开始复杂工作前应先调用此工具查看现状。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {}
            })),
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
