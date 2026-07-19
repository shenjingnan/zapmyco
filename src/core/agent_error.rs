//! Core 层错误类型。

use std::fmt;

/// Agent 核心循环错误
#[derive(Debug)]
pub enum AgentError {
    /// API 调用失败
    Api(String),
    /// 工具执行失败
    ToolExecution { name: String, error: String },
    /// 达到最大工具调用轮次
    MaxRoundsReached,
    /// 事件通道关闭
    ChannelClosed,
    /// 消息转换失败
    Conversion(String),
}

impl fmt::Display for AgentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentError::Api(msg) => write!(f, "API error: {}", msg),
            AgentError::ToolExecution { name, error } => {
                write!(f, "tool '{}' execution error: {}", name, error)
            }
            AgentError::MaxRoundsReached => {
                write!(f, "max tool rounds reached")
            }
            AgentError::ChannelClosed => {
                write!(f, "event channel closed")
            }
            AgentError::Conversion(msg) => {
                write!(f, "conversion error: {}", msg)
            }
        }
    }
}

impl std::error::Error for AgentError {}

// 允许从 String 快速创建 API 错误
impl From<String> for AgentError {
    fn from(msg: String) -> Self {
        AgentError::Api(msg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_display_api() {
        let err = AgentError::Api("timeout".to_string());
        assert_eq!(format!("{}", err), "API error: timeout");
    }

    #[test]
    fn test_display_tool_execution() {
        let err = AgentError::ToolExecution {
            name: "read".to_string(),
            error: "not found".to_string(),
        };
        assert_eq!(format!("{}", err), "tool 'read' execution error: not found");
    }

    #[test]
    fn test_display_max_rounds() {
        let err = AgentError::MaxRoundsReached;
        assert_eq!(format!("{}", err), "max tool rounds reached");
    }

    #[test]
    fn test_display_channel_closed() {
        let err = AgentError::ChannelClosed;
        assert_eq!(format!("{}", err), "event channel closed");
    }

    #[test]
    fn test_display_conversion() {
        let err = AgentError::Conversion("bad format".to_string());
        assert_eq!(format!("{}", err), "conversion error: bad format");
    }

    #[test]
    fn test_error_impl() {
        let err = AgentError::MaxRoundsReached;
        assert!(std::error::Error::source(&err).is_none());
    }

    #[test]
    fn test_from_string() {
        let err: AgentError = "oops".to_string().into();
        assert!(matches!(err, AgentError::Api(_)));
    }
}
