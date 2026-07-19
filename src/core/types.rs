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

/// 一条对话消息
#[derive(Debug, Clone)]
pub struct ConversationMessage {
    pub role: Role,
    pub content: String,
}

impl ConversationMessage {
    /// 创建用户消息
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
        }
    }

    /// 创建助手消息
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
        }
    }

    /// 创建工具结果消息
    pub fn tool(content: impl Into<String>) -> Self {
        Self {
            role: Role::Tool,
            content: content.into(),
        }
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
    }

    #[test]
    fn test_assistant_message() {
        let msg = ConversationMessage::assistant("hi there");
        assert_eq!(msg.role, Role::Assistant);
        assert_eq!(msg.content, "hi there");
    }

    #[test]
    fn test_tool_message() {
        let msg = ConversationMessage::tool("result: ok");
        assert_eq!(msg.role, Role::Tool);
        assert_eq!(msg.content, "result: ok");
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
