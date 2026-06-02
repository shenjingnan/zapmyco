// task_update 工具 — 更新任务的状态、字段或依赖关系
//
// 支持以下操作：
// - 状态流转：pending → in_progress → completed
// - 字段更新：subject、description、active_form、owner
// - 依赖管理：add_blocks、add_blocked_by（追加而非覆盖）
// - 删除操作：设置 status 为 "deleted"

use crate::tools::task_manager::{TaskManager, TaskStatus, TaskUpdate};
use std::sync::Arc;

pub struct TaskUpdateTool {
    pub manager: Arc<TaskManager>,
}

impl TaskUpdateTool {
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "task_update".to_string(),
            description: Some(
                "更新任务的状态、字段或依赖关系。\
                 开始工作前将任务标记为 in_progress，完成后标记为 completed。\
                 通过 add_blocks/add_blocked_by 设置任务间的依赖关系。\
                 设置 status 为 'deleted' 可永久删除任务。\
                 只有 FULLY 完成的任务才标记为 completed。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "要更新的任务 ID"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "in_progress", "completed", "deleted"],
                        "description": "新状态：pending（待处理）、in_progress（进行中）、completed（已完成）、deleted（删除）"
                    },
                    "subject": {
                        "type": "string",
                        "description": "新标题"
                    },
                    "description": {
                        "type": "string",
                        "description": "新描述"
                    },
                    "active_form": {
                        "type": "string",
                        "description": "进行时态"
                    },
                    "add_blocks": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "此任务阻塞的任务 ID 列表"
                    },
                    "add_blocked_by": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "阻塞此任务的任务 ID 列表"
                    },
                    "owner": {
                        "type": "string",
                        "description": "任务负责人（多 Agent 协作时使用）"
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

        // ---- 特殊处理：删除操作 ----
        if let Some(status) = input.get("status").and_then(|v| v.as_str())
            && status == "deleted"
        {
            let deleted = self
                .manager
                .delete(task_id)
                .await
                .map_err(|e| format!("删除任务失败: {}", e))?;
            return if deleted {
                Ok(format!("Task #{} deleted", task_id))
            } else {
                Ok(format!("Task #{} not found", task_id))
            };
        }

        // ---- 获取当前任务（验证存在 + 比对字段） ----
        let existing = self
            .manager
            .get(task_id)
            .await
            .map_err(|e| format!("获取任务失败: {}", e))?
            .ok_or_else(|| format!("Task #{} not found", task_id))?;

        // ---- 构建部分更新 ----
        let mut updates = TaskUpdate::default();

        if let Some(v) = input.get("subject").and_then(|v| v.as_str()) {
            updates.subject = Some(v.to_string());
        }
        if let Some(v) = input.get("description").and_then(|v| v.as_str()) {
            updates.description = Some(v.to_string());
        }
        if let Some(v) = input.get("active_form").and_then(|v| v.as_str()) {
            updates.active_form = Some(v.to_string());
        }
        if let Some(v) = input.get("status").and_then(|v| v.as_str()) {
            updates.status = Some(v.parse::<TaskStatus>()?);
        }
        if let Some(v) = input.get("owner").and_then(|v| v.as_str()) {
            updates.owner = Some(v.to_string());
        }
        if let Some(arr) = input.get("add_blocks").and_then(|v| v.as_array()) {
            updates.add_blocks = arr
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
        }
        if let Some(arr) = input.get("add_blocked_by").and_then(|v| v.as_array()) {
            updates.add_blocked_by = arr
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
        }

        // ---- 记录实际变更的字段 ----
        let mut changed_fields: Vec<&str> = Vec::new();
        if updates.subject.is_some() && updates.subject.as_deref() != Some(&existing.subject) {
            changed_fields.push("subject");
        }
        if updates.description.is_some()
            && updates.description.as_deref() != Some(&existing.description)
        {
            changed_fields.push("description");
        }
        if updates.active_form.is_some()
            && updates.active_form.as_deref() != existing.active_form.as_deref()
        {
            changed_fields.push("active_form");
        }
        if updates.status.is_some() && updates.status != Some(existing.status) {
            changed_fields.push("status");
        }
        if updates.owner.is_some() && updates.owner.as_deref() != existing.owner.as_deref() {
            changed_fields.push("owner");
        }
        if !updates.add_blocks.is_empty() {
            changed_fields.push("blocks");
        }
        if !updates.add_blocked_by.is_empty() {
            changed_fields.push("blocked_by");
        }

        // ---- 执行更新 ----
        let updated = self
            .manager
            .update(task_id, updates)
            .await
            .map_err(|e| format!("更新任务失败: {}", e))?;

        let change_summary = if changed_fields.is_empty() {
            "无变更".to_string()
        } else {
            format!("已更新: {}", changed_fields.join(", "))
        };

        Ok(format!(
            "Task #{} 当前状态: {}。{}",
            updated.id,
            updated.status.as_str(),
            change_summary,
        ))
    }
}
