/// Web Search 工具 - 利用 API 服务端 web_search_20250305 实现联网搜索
use futures_util::StreamExt;
use serde_json::Value;
use zapmyco_anthropic_ai_sdk::client::AnthropicClient;
use zapmyco_anthropic_ai_sdk::types::message::{
    ContentBlock, ContentBlockDelta, CreateMessageParams, Message, MessageClient, MessageError,
    RequiredMessageParams, Role, StreamEvent, StreamUsage, Tool, WebSearchToolResultContent,
};

/// Web 搜索工具
///
/// 客户端注册为普通 tool_use，execute() 内部发起 API 子请求并传入
/// web_search_20250305 server-side tool schema，由服务端执行搜索并返回结果。
pub struct WebSearch {
    client: AnthropicClient,
    model: String,
    max_tokens: u32,
}

impl WebSearch {
    /// 创建 WebSearch 实例
    ///
    /// 需要从 AiAgent 传入 api_key、base_url、model、max_tokens 以构建内部子请求客户端。
    pub fn new(
        api_key: String,
        base_url: String,
        model: String,
        max_tokens: u32,
    ) -> Result<Self, String> {
        let client = AnthropicClient::builder(&api_key, "2023-06-01")
            .with_api_base_url(&base_url)
            .build::<MessageError>()
            .map_err(|e| format!("Failed to create AnthropicClient: {}", e))?;
        Ok(Self {
            client,
            model,
            max_tokens,
        })
    }

    /// 返回 Anthropic Tool 定义（对主模型来说是普通 tool_use）
    pub fn tool_definition() -> Tool {
        Tool {
            name: "web_search".to_string(),
            description: Some(
                "搜索网络获取实时信息，支持 query（搜索关键词）、allowed_domains（限定域名）、blocked_domains（排除域名）参数。搜索由服务器端自动执行。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索查询关键词"
                    },
                    "allowed_domains": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "仅在这些域名内搜索"
                    },
                    "blocked_domains": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "排除这些域名的结果"
                    }
                },
                "required": ["query"]
            })),
            ..Default::default()
        }
    }

    /// 执行搜索（内部发起 API 流式子请求，传入 web_search_20250305 schema）
    ///
    /// 子请求由服务端自动执行搜索，返回 server_tool_use + web_search_tool_result + text 块。
    /// 本方法流式解析这些事件，组合为最终文本结果。
    pub async fn execute(&self, input: &Value) -> Result<String, String> {
        let query = input
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or("Missing required 'query' parameter")?;

        // 构建子请求消息
        let msg = Message::new_text(
            Role::User,
            format!("Perform a web search for the query: {}", query),
        );

        // 构建子请求参数（含 web_search_20250305 server-side tool schema + stream: true）
        let params = CreateMessageParams::new(RequiredMessageParams {
            model: self.model.clone(),
            messages: vec![msg],
            max_tokens: self.max_tokens,
        })
        .with_stream(true)
        .with_tools(vec![Tool {
            name: "web_search".to_string(),
            tool_type: Some("web_search_20250305".to_string()),
            max_uses: Some(8),
            allowed_domains: input
                .get("allowed_domains")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
            blocked_domains: input
                .get("blocked_domains")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
            ..Default::default()
        }]);

        // 发起流式子请求（类似 Claude Code 的 queryModelWithStreaming）
        let mut stream = self
            .client
            .create_message_streaming(&params)
            .await
            .map_err(|e| format!("Web search stream failed: {}", e))?;

        // 流式解析事件
        let mut result = String::new();

        while let Some(event) = stream.next().await {
            let event = event.map_err(|e| format!("Stream error: {}", e))?;
            match event {
                StreamEvent::ContentBlockStart { content_block, .. } => match &content_block {
                    ContentBlock::ServerToolUse { input, .. } => {
                        let q = input.get("query").and_then(|v| v.as_str()).unwrap_or("...");
                        crate::output::send(&crate::output::Message::info(format!(
                            "[工具] 🔍 正在搜索: {}",
                            q
                        )));
                    }
                    ContentBlock::WebSearchToolResult {
                        content: WebSearchToolResultContent::Results(results),
                        ..
                    } => {
                        crate::output::send(&crate::output::Message::info(format!(
                            "[工具] 📄 获得 {} 条搜索结果",
                            results.len()
                        )));
                        for r in results {
                            result.push_str(&format!("- [{}]({})\n", r.title, r.url));
                        }
                    }
                    _ => {}
                },
                StreamEvent::ContentBlockDelta {
                    delta: ContentBlockDelta::TextDelta { text },
                    ..
                } => {
                    result.push_str(&text);
                }
                StreamEvent::MessageDelta {
                    usage:
                        Some(StreamUsage {
                            server_tool_use: Some(su),
                            ..
                        }),
                    ..
                } => {
                    crate::output::send(&crate::output::Message::info(format!(
                        "[工具] ✅ 搜索完成 ({} 次搜索)",
                        su.web_search_requests
                    )));
                }
                _ => {}
            }
        }

        Ok(result)
    }
}

/// 获取工具描述（用于系统提示词）
pub fn tool_description() -> &'static str {
    "web_search: 搜索网络获取实时信息，支持 query（搜索关键词）、allowed_domains（限定域名）、blocked_domains（排除域名）参数。搜索由服务器端自动执行。"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_web_search() -> WebSearch {
        WebSearch::new(
            "test-key".to_string(),
            "https://api.example.com".to_string(),
            "test-model".to_string(),
            4096,
        )
        .unwrap()
    }

    #[test]
    fn test_new_success() {
        let ws = WebSearch::new("test-key".into(), "https://x.com".into(), "m".into(), 100);
        assert!(ws.is_ok());
    }

    #[test]
    fn test_new_empty_api_key() {
        let ws = WebSearch::new("".into(), "https://x.com".into(), "m".into(), 100);
        assert!(ws.is_ok());
    }

    #[test]
    fn test_tool_definition_name() {
        let tool = WebSearch::tool_definition();
        assert_eq!(tool.name, "web_search");
        assert!(tool.description.is_some());
        assert!(tool.input_schema.is_some());
        assert!(tool.tool_type.is_none());
    }

    #[test]
    fn test_tool_definition_input_schema() {
        let tool = WebSearch::tool_definition();
        let schema = tool.input_schema.as_ref().unwrap();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["query"].is_object());
        assert!(schema["properties"]["allowed_domains"].is_object());
        assert!(schema["properties"]["blocked_domains"].is_object());

        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&serde_json::Value::String("query".to_string())));
    }

    #[test]
    fn test_sub_request_tool_schema() {
        let tool = Tool {
            name: "web_search".to_string(),
            tool_type: Some("web_search_20250305".to_string()),
            max_uses: Some(8),
            allowed_domains: None,
            blocked_domains: None,
            ..Default::default()
        };
        assert_eq!(tool.tool_type.as_ref().unwrap(), "web_search_20250305");
        assert_eq!(tool.max_uses, Some(8));
        assert!(tool.input_schema.is_none());
        assert!(tool.description.is_none());
    }

    #[test]
    fn test_sub_request_tool_schema_with_domains() {
        let tool = Tool {
            name: "web_search".to_string(),
            tool_type: Some("web_search_20250305".to_string()),
            max_uses: Some(8),
            allowed_domains: Some(vec!["rust-lang.org".to_string()]),
            blocked_domains: Some(vec!["example.com".to_string()]),
            ..Default::default()
        };
        assert_eq!(
            tool.allowed_domains.as_ref().unwrap(),
            &["rust-lang.org".to_string()]
        );
        assert_eq!(
            tool.blocked_domains.as_ref().unwrap(),
            &["example.com".to_string()]
        );
    }

    #[test]
    fn test_tool_description_not_empty() {
        let desc = tool_description();
        assert!(!desc.is_empty());
        assert!(desc.contains("web_search"));
    }

    #[tokio::test]
    async fn test_execute_missing_query() {
        let ws = make_test_web_search();
        let result = ws.execute(&serde_json::json!({})).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("Missing required 'query'"));
    }

    #[tokio::test]
    async fn test_execute_query_not_string() {
        let ws = make_test_web_search();
        let result = ws.execute(&serde_json::json!({"query": 123})).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("Missing required 'query'"));
    }

    #[test]
    fn test_execute_domain_filter_extraction() {
        let input = serde_json::json!({
            "query": "test",
            "allowed_domains": ["good.com"],
            "blocked_domains": ["bad.com"]
        });
        let query = input.get("query").and_then(|v| v.as_str()).unwrap();
        assert_eq!(query, "test");
        let allowed: Option<Vec<String>> = input
            .get("allowed_domains")
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        assert_eq!(allowed, Some(vec!["good.com".to_string()]));
        let blocked: Option<Vec<String>> = input
            .get("blocked_domains")
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        assert_eq!(blocked, Some(vec!["bad.com".to_string()]));
    }
}
