//! Core 层基础数据类型。
//!
//! 定义 Agent 核心循环中使用的纯数据类型，不包含任何环境依赖。

/// 对话角色
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// 用户
    User,
    /// AI 助手
    Assistant,
    /// 工具执行结果
    Tool,
}

/// 消息内容块 — 用于表示结构化的工具调用/结果
///
/// 简单的纯文本消息可以只用 `ConversationMessage.content`，
/// 当涉及工具调用时，使用 `blocks` 字段携带结构化数据。
#[derive(Debug, Clone)]
pub enum MessageBlock {
    /// 文本内容
    Text(String),
    /// 工具调用
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    /// 工具执行结果
    ToolResult {
        id: String,
        content: String,
        is_error: bool,
    },
}

/// 一条对话消息
#[derive(Debug, Clone)]
pub struct ConversationMessage {
    pub role: Role,
    /// 文本内容（纯文本场景直接用此字段）
    pub content: String,
    /// 结构化内容块（工具调用/结果时使用）
    pub blocks: Option<Vec<MessageBlock>>,
}

impl ConversationMessage {
    /// 创建纯文本用户消息
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
            blocks: None,
        }
    }

    /// 创建纯文本助手消息
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
            blocks: None,
        }
    }

    /// 创建工具结果消息
    pub fn tool_result(content: impl Into<String>) -> Self {
        Self {
            role: Role::Tool,
            content: content.into(),
            blocks: None,
        }
    }

    /// 创建带结构化块的消息
    pub fn with_blocks(role: Role, content: impl Into<String>, blocks: Vec<MessageBlock>) -> Self {
        Self {
            role,
            content: content.into(),
            blocks: Some(blocks),
        }
    }

    /// 是否有工具调用
    pub fn has_tool_calls(&self) -> bool {
        self.blocks
            .as_ref()
            .is_some_and(|b| b.iter().any(|b| matches!(b, MessageBlock::ToolUse { .. })))
    }

    /// 获取所有的工具调用
    pub fn tool_calls(&self) -> Vec<(&str, &str, &serde_json::Value)> {
        self.blocks
            .as_ref()
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|b| match b {
                        MessageBlock::ToolUse { id, name, input } => {
                            Some((id.as_str(), name.as_str(), input))
                        }
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_message() {
        let msg = ConversationMessage::user("hello");
        assert_eq!(msg.role, Role::User);
        assert_eq!(msg.content, "hello");
        assert!(msg.blocks.is_none());
    }

    #[test]
    fn test_assistant_message() {
        let msg = ConversationMessage::assistant("hi there");
        assert_eq!(msg.role, Role::Assistant);
        assert_eq!(msg.content, "hi there");
    }

    #[test]
    fn test_tool_result_message() {
        let msg = ConversationMessage::tool_result("result: ok");
        assert_eq!(msg.role, Role::Tool);
        assert_eq!(msg.content, "result: ok");
    }

    #[test]
    fn test_message_with_blocks() {
        let blocks = vec![
            MessageBlock::Text("hello".to_string()),
            MessageBlock::ToolUse {
                id: "call_1".to_string(),
                name: "file_read".to_string(),
                input: serde_json::json!({}),
            },
        ];
        let msg = ConversationMessage::with_blocks(Role::Assistant, "", blocks);
        assert!(msg.has_tool_calls());
        let calls = msg.tool_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "call_1");
        assert_eq!(calls[0].1, "file_read");
    }

    #[test]
    fn test_has_tool_calls_false() {
        let msg = ConversationMessage::user("hello");
        assert!(!msg.has_tool_calls());
    }

    #[test]
    fn test_tool_calls_empty() {
        let msg = ConversationMessage::user("hello");
        assert!(msg.tool_calls().is_empty());
    }

    #[test]
    fn test_role_equality() {
        assert_eq!(Role::User, Role::User);
        assert_ne!(Role::User, Role::Assistant);
        assert_ne!(Role::User, Role::Tool);
    }

    #[test]
    fn test_clone() {
        let msg = ConversationMessage::user("hello");
        let cloned = msg.clone();
        assert_eq!(msg.content, cloned.content);
        assert_eq!(msg.role, cloned.role);
    }
}
