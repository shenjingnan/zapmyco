//! Agent 工具 trait 定义。
//!
//! 任何实现 `AgentTool` 的类型都可以注册为 Agent 可调用的工具。
//! 外部代码（如 CAD 插件）可以实现此 trait 来添加自定义操作。

use async_trait::async_trait;
use serde_json::Value;

/// Agent 工具定义
///
/// # 示例
///
/// ```ignore
/// struct GreetTool;
///
/// #[async_trait]
/// impl AgentTool for GreetTool {
///     fn name(&self) -> &str { "greet" }
///     fn description(&self) -> &str { "向用户打招呼" }
///     fn input_schema(&self) -> Value {
///         serde_json::json!({
///             "type": "object",
///             "properties": {
///                 "name": { "type": "string" }
///             }
///         })
///     }
///     async fn execute(&self, input: Value) -> Result<String, String> {
///         let name = input.get("name")
///             .and_then(|v| v.as_str())
///             .unwrap_or("world");
///         Ok(format!("Hello, {}!", name))
///     }
/// }
/// ```
#[async_trait]
pub trait AgentTool: Send + Sync {
    /// 工具名称（LLM 使用的标识符）
    fn name(&self) -> &str;

    /// 工具描述（LLM 决定是否调用时的参考）
    fn description(&self) -> &str;

    /// 工具参数的 JSON Schema
    fn input_schema(&self) -> Value;

    /// 执行工具
    ///
    /// # 参数
    /// - `input`: 已通过 schema 校验的输入参数
    ///
    /// # 返回
    /// - `Ok(String)`: 工具执行结果文本
    /// - `Err(String)`: 工具执行失败
    async fn execute(&self, input: Value) -> Result<String, String>;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一个简单的 mock 工具，用于测试 trait 的 Send + Sync 约束
    struct MockTool;

    #[async_trait]
    impl AgentTool for MockTool {
        fn name(&self) -> &str {
            "mock"
        }

        fn description(&self) -> &str {
            "mock tool for testing"
        }

        fn input_schema(&self) -> Value {
            serde_json::json!({
                "type": "object",
                "properties": {}
            })
        }

        async fn execute(&self, _input: Value) -> Result<String, String> {
            Ok("mock result".to_string())
        }
    }

    #[tokio::test]
    async fn test_mock_tool() {
        let tool = MockTool;
        assert_eq!(tool.name(), "mock");
        assert_eq!(tool.description(), "mock tool for testing");

        let schema = tool.input_schema();
        assert_eq!(schema["type"], "object");

        let result = tool.execute(serde_json::json!({})).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "mock result");
    }

    /// 验证工具可以放在 Vec<Box<dyn AgentTool>> 中使用
    #[tokio::test]
    async fn test_trait_object() {
        let tool: Box<dyn AgentTool> = Box::new(MockTool);
        assert_eq!(tool.name(), "mock");

        let result = tool.execute(serde_json::json!({})).await;
        assert!(result.is_ok());
    }

    /// 验证工具可以通过 &dyn AgentTool 调用
    #[tokio::test]
    async fn test_trait_reference() {
        let tool = MockTool;
        let ref_tool: &dyn AgentTool = &tool;
        assert_eq!(ref_tool.name(), "mock");

        let result = ref_tool.execute(serde_json::json!({})).await;
        assert!(result.is_ok());
    }
}
