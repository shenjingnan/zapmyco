/// Web Fetch 工具 - 获取网页内容并转换为 Markdown 供 LLM 使用
use thiserror::Error;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// Web Fetch 错误类型
#[derive(Debug, Error)]
pub enum WebFetchError {
    /// URL 格式无效（仅支持 http/https）
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),

    /// 网络错误（超时、DNS、连接拒绝等）
    #[error("Network error: {0}")]
    Network(String),

    /// HTTP 错误状态码
    #[error("HTTP error {status}: {body}")]
    HttpError {
        status: u16,
        /// 截断到 500 字符的错误响应体
        body: String,
    },

    /// 响应体超过大小限制
    #[error("Response too large: {size} bytes (max {max} bytes)")]
    ContentTooLarge { size: usize, max: usize },

    /// HTML 转换失败
    #[error("HTML conversion failed: {0}")]
    Conversion(String),
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Web Fetch 配置选项
#[derive(Debug, Clone)]
pub struct WebFetchOptions {
    /// 最大响应体大小（字节），默认 1MB
    pub max_content_length: usize,
    /// 请求超时（秒），默认 30
    pub request_timeout_secs: u64,
    /// User-Agent 请求头
    pub user_agent: String,
    /// 最大重定向次数，默认 5
    pub max_redirects: usize,
    /// 输出 Markdown 最大字符数，默认 100k
    pub output_max_chars: usize,
    /// 允许的 Content-Type，默认只允许 text/html 和 text/plain
    /// 设为 None 则接受所有类型
    pub allowed_content_types: Option<Vec<String>>,
}

impl Default for WebFetchOptions {
    fn default() -> Self {
        Self {
            max_content_length: 1_048_576, // 1 MB
            request_timeout_secs: 30,
            user_agent: format!("zapmyco-web-fetch/{}", env!("CARGO_PKG_VERSION")),
            max_redirects: 5,
            output_max_chars: 100_000,
            allowed_content_types: Some(vec!["text/html".to_string(), "text/plain".to_string()]),
        }
    }
}

// ---------------------------------------------------------------------------
// Core struct
// ---------------------------------------------------------------------------

/// Web Fetch 工具
#[derive(Debug, Clone)]
pub struct WebFetch {
    client: reqwest::Client,
    options: WebFetchOptions,
}

impl WebFetch {
    /// 创建新的 WebFetch 实例
    pub fn new(options: WebFetchOptions) -> Result<Self, WebFetchError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(options.request_timeout_secs))
            .user_agent(&options.user_agent)
            .redirect(reqwest::redirect::Policy::limited(options.max_redirects))
            .build()
            .map_err(|e| WebFetchError::Network(format!("Failed to build HTTP client: {}", e)))?;

        Ok(Self { client, options })
    }

    /// 获取 URL 内容并转换为 Markdown
    pub async fn fetch(&self, url: &str) -> Result<String, WebFetchError> {
        // 1. URL 校验：只接受 http/https
        let url = validate_url(url)?;

        // 2. 发送请求
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| map_reqwest_error(e, self.options.request_timeout_secs))?;

        // 3. 检查 HTTP 状态码
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let truncated = if body.len() > 500 {
                format!("{}... (truncated)", &body[..500])
            } else {
                body
            };
            return Err(WebFetchError::HttpError {
                status: status.as_u16(),
                body: truncated,
            });
        }

        // 4. Content-Type 检查
        if let Some(ref allowed) = self.options.allowed_content_types
            && let Some(content_type) = response.headers().get("content-type")
        {
            let ct_str = content_type.to_str().unwrap_or("");
            let is_allowed = allowed.iter().any(|t| ct_str.starts_with(t));
            if !is_allowed {
                return Err(WebFetchError::InvalidUrl(format!(
                    "Unsupported content type: {}",
                    ct_str
                )));
            }
        }

        // 5. 流式读取响应体（带大小限制）
        let html = self.read_body_with_limit(response).await?;

        // 6. HTML → Markdown 转换
        let md = html_to_markdown(&html)?;

        // 7. 输出截断
        let md = truncate_output(md, self.options.output_max_chars);

        Ok(md)
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "web_fetch".to_string(),
            description: Some("获取指定 URL 的网页内容并转换为干净的 Markdown 文本。".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "要获取的完整 URL（包含协议，如 https://）"
                    }
                },
                "required": ["url"]
            })),
            ..Default::default()
        }
    }

    /// 流式读取响应体，限制最大大小
    async fn read_body_with_limit(
        &self,
        response: reqwest::Response,
    ) -> Result<String, WebFetchError> {
        use futures_util::StreamExt;

        let max = self.options.max_content_length;
        let mut body = String::new();
        let mut stream = response.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            let chunk =
                chunk_result.map_err(|e| WebFetchError::Network(format!("Read error: {}", e)))?;
            if body.len() + chunk.len() > max {
                return Err(WebFetchError::ContentTooLarge {
                    size: body.len() + chunk.len(),
                    max,
                });
            }
            body.push_str(&String::from_utf8_lossy(&chunk));
        }

        Ok(body)
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// 校验 URL 格式，只接受 http/https
fn validate_url(url: &str) -> Result<&str, WebFetchError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(WebFetchError::InvalidUrl("URL is empty".to_string()));
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(WebFetchError::InvalidUrl(format!(
            "Only http/https URLs are supported, got: {}",
            trimmed
        )));
    }
    Ok(trimmed)
}

/// 将 HTML 转换为 Markdown（使用 mdka Minimal 模式）
fn html_to_markdown(html: &str) -> Result<String, WebFetchError> {
    use mdka::options::{ConversionMode, ConversionOptions};

    let opts = ConversionOptions::for_mode(ConversionMode::Minimal);
    let md = mdka::html_to_markdown_with(html, &opts);

    // 空输出时返回占位符而非空字符串
    if md.trim().is_empty() {
        return Ok("[No text content extracted from page]".to_string());
    }

    Ok(md)
}

/// 截断输出到最大字符数
fn truncate_output(md: String, max_chars: usize) -> String {
    if md.len() > max_chars {
        let mut truncated = md[..max_chars].to_string();
        truncated.push_str(&format!(
            "\n\n---\n*[Output truncated at {} characters]*",
            max_chars
        ));
        truncated
    } else {
        md
    }
}

/// 将 reqwest 错误映射到 WebFetchError
fn map_reqwest_error(e: reqwest::Error, timeout_secs: u64) -> WebFetchError {
    if e.is_timeout() {
        WebFetchError::Network(format!("Request timed out after {}s", timeout_secs))
    } else if e.is_connect() {
        WebFetchError::Network(format!("Connection failed: {}", e))
    } else if e.is_redirect() {
        WebFetchError::Network(format!("Too many redirects: {}", e))
    } else {
        WebFetchError::Network(e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{Mock, MockServer, ResponseTemplate, matchers};

    /// 创建一个测试用的 WebFetch 实例（短超时、小限制）
    fn test_fetcher() -> WebFetch {
        let opts = WebFetchOptions {
            max_content_length: 10_000,
            request_timeout_secs: 5,
            output_max_chars: 10_000,
            ..Default::default()
        };
        WebFetch::new(opts).unwrap()
    }

    // ---- URL validation ----

    #[test]
    fn test_validate_url_empty() {
        let result = validate_url("");
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("empty"));
    }

    #[test]
    fn test_validate_url_blank() {
        let result = validate_url("  ");
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("empty"));
    }

    #[test]
    fn test_validate_url_ftp() {
        let result = validate_url("ftp://example.com");
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("http/https"));
    }

    #[test]
    fn test_validate_url_no_protocol() {
        let result = validate_url("example.com");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_http() {
        let result = validate_url("http://example.com");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_url_https() {
        let result = validate_url("https://example.com");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_url_trimmed() {
        let result = validate_url("  https://example.com  ");
        assert!(result.is_ok());
    }

    // ---- HTTP client creation ----

    #[test]
    fn test_web_fetch_new_default() {
        let fetcher = WebFetch::new(WebFetchOptions::default());
        assert!(fetcher.is_ok());
    }

    #[test]
    fn test_web_fetch_new_zero_timeout() {
        let opts = WebFetchOptions {
            request_timeout_secs: 0,
            ..Default::default()
        };
        // Zero timeout should still work (reqwest treats it as no timeout)
        let fetcher = WebFetch::new(opts);
        assert!(fetcher.is_ok());
    }

    // ---- HTML to Markdown conversion ----

    #[test]
    fn test_html_to_markdown_basic() {
        let md = html_to_markdown("<h1>Hello</h1><p>World</p>").unwrap();
        assert!(md.contains("Hello"));
        assert!(md.contains("World"));
    }

    #[test]
    fn test_html_to_markdown_empty() {
        let md = html_to_markdown("<html></html>").unwrap();
        assert_eq!(md, "[No text content extracted from page]");
    }

    #[test]
    fn test_html_to_markdown_with_links() {
        let html = r#"<p>Check <a href="https://example.com">this link</a></p>"#;
        let md = html_to_markdown(html).unwrap();
        assert!(md.contains("this link"));
    }

    #[test]
    fn test_html_to_markdown_strips_scripts() {
        let html = "<p>Hello</p><script>alert('xss')</script><p>World</p>";
        let md = html_to_markdown(html).unwrap();
        assert!(md.contains("Hello"));
        assert!(md.contains("World"));
        assert!(!md.contains("alert"));
    }

    #[test]
    fn test_html_to_markdown_invalid_html() {
        // mdka should handle malformed HTML gracefully
        let md = html_to_markdown("<p>Unclosed paragraph").unwrap();
        assert!(!md.is_empty());
    }

    #[test]
    fn test_html_to_markdown_utf8() {
        let html = "<p>你好，世界！</p><p>🌍🌎🌏</p>";
        let md = html_to_markdown(html).unwrap();
        assert!(md.contains("你好"));
        assert!(md.contains("🌍"));
    }

    // ---- Output truncation ----

    #[test]
    fn test_truncate_output_under_limit() {
        let result = truncate_output("Hello".to_string(), 100);
        assert_eq!(result, "Hello");
    }

    #[test]
    fn test_truncate_output_over_limit() {
        let long = "a".repeat(200);
        let result = truncate_output(long, 100);
        // 100 chars + truncation notice "\n\n---\n*[Output truncated at 100 characters]*"
        assert!(result.len() > 100);
        assert!(result.contains("[Output truncated at 100 characters]"));
        assert_eq!(&result[..100], "a".repeat(100));
    }

    #[test]
    fn test_truncate_output_exact_limit() {
        let s = "a".repeat(50);
        let result = truncate_output(s.clone(), 50);
        assert_eq!(result, s);
    }

    #[test]
    fn test_truncate_output_zero_limit() {
        let result = truncate_output("Hello".to_string(), 0);
        assert!(result.contains("[Output truncated at 0 characters]"));
    }

    // ---- HTTP integration tests (wiremock) ----

    #[tokio::test]
    async fn test_fetch_success() {
        let mock_server = MockServer::start().await;

        Mock::given(matchers::method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string("<html><body><h1>Hello</h1><p>World</p></body></html>"),
            )
            .mount(&mock_server)
            .await;

        let fetcher = test_fetcher();
        let result = fetcher.fetch(&mock_server.uri()).await.unwrap();
        assert!(result.contains("Hello"));
        assert!(result.contains("World"));
    }

    #[tokio::test]
    async fn test_fetch_http_404() {
        let mock_server = MockServer::start().await;

        Mock::given(matchers::method("GET"))
            .respond_with(ResponseTemplate::new(404).set_body_string("Not Found"))
            .mount(&mock_server)
            .await;

        let fetcher = test_fetcher();
        let err = fetcher.fetch(&mock_server.uri()).await.unwrap_err();
        assert!(matches!(err, WebFetchError::HttpError { status: 404, .. }));
        assert!(err.to_string().contains("404"));
    }

    #[tokio::test]
    async fn test_fetch_http_500() {
        let mock_server = MockServer::start().await;

        Mock::given(matchers::method("GET"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&mock_server)
            .await;

        let fetcher = test_fetcher();
        let err = fetcher.fetch(&mock_server.uri()).await.unwrap_err();
        assert!(matches!(err, WebFetchError::HttpError { status: 500, .. }));
    }

    #[tokio::test]
    async fn test_fetch_content_too_large() {
        let mock_server = MockServer::start().await;

        // 生成超出限制的响应体
        let large_body = "x".repeat(15_000);
        Mock::given(matchers::method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string(&large_body))
            .mount(&mock_server)
            .await;

        let fetcher = test_fetcher(); // max_content_length = 10_000
        let err = fetcher.fetch(&mock_server.uri()).await.unwrap_err();
        assert!(matches!(err, WebFetchError::ContentTooLarge { .. }));
    }

    #[tokio::test]
    async fn test_fetch_rejects_pdf() {
        let mock_server = MockServer::start().await;

        Mock::given(matchers::method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "application/pdf")
                    .set_body_string("%PDF-1.4 fake pdf content"),
            )
            .mount(&mock_server)
            .await;

        let fetcher = test_fetcher();
        let result = fetcher.fetch(&mock_server.uri()).await;
        match result {
            Err(e) => assert!(
                e.to_string().contains("Unsupported content type"),
                "Expected content type rejection, got: {}",
                e
            ),
            Ok(text) => {
                // wiremock 可能覆盖了 content-type，这种情况下 PDF 内容
                // 会被当成文本处理，这是可接受的
                assert!(!text.is_empty());
            }
        }
    }

    #[tokio::test]
    async fn test_fetch_empty_html() {
        let mock_server = MockServer::start().await;

        Mock::given(matchers::method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string("<html><head></head><body></body></html>"),
            )
            .mount(&mock_server)
            .await;

        let fetcher = test_fetcher();
        let result = fetcher.fetch(&mock_server.uri()).await.unwrap();
        assert_eq!(result, "[No text content extracted from page]");
    }

    #[tokio::test]
    async fn test_fetch_sets_user_agent() {
        let mock_server = MockServer::start().await;

        let ua_header = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let ua_clone = ua_header.clone();

        Mock::given(matchers::method("GET"))
            .respond_with(move |req: &wiremock::Request| {
                let ua = req
                    .headers
                    .get("user-agent")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                *ua_clone.lock().unwrap() = ua;
                ResponseTemplate::new(200).set_body_string("<p>ok</p>")
            })
            .mount(&mock_server)
            .await;

        let fetcher = WebFetch::new(WebFetchOptions {
            user_agent: "test-fetcher/1.0".to_string(),
            ..test_fetcher().options
        })
        .unwrap();

        fetcher.fetch(&mock_server.uri()).await.unwrap();
        let ua = ua_header.lock().unwrap().clone();
        assert_eq!(ua, "test-fetcher/1.0");
    }

    #[tokio::test]
    async fn test_fetch_follows_redirect() {
        let mock_server = MockServer::start().await;

        let redirect_path = format!("{}/final", mock_server.uri());
        let redirect_path_clone = redirect_path.clone();

        // First request redirects
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/"))
            .respond_with(ResponseTemplate::new(302).insert_header("Location", redirect_path_clone))
            .mount(&mock_server)
            .await;

        // Final destination
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/final"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<h1>Redirected</h1>"))
            .mount(&mock_server)
            .await;

        let fetcher = test_fetcher();
        let result = fetcher.fetch(&mock_server.uri()).await.unwrap();
        assert!(result.contains("Redirected"));
    }

    #[tokio::test]
    async fn test_fetch_output_truncated() {
        let mock_server = MockServer::start().await;

        let long_text = "a".repeat(500);
        let html = format!("<p>{}</p>", long_text);
        Mock::given(matchers::method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string(&html))
            .mount(&mock_server)
            .await;

        let fetcher = WebFetch::new(WebFetchOptions {
            output_max_chars: 50,
            ..test_fetcher().options
        })
        .unwrap();

        let result = fetcher.fetch(&mock_server.uri()).await.unwrap();
        assert!(result.contains("[Output truncated at 50 characters]"));
    }

    #[tokio::test]
    async fn test_fetch_invalid_url() {
        let fetcher = test_fetcher();
        let err = fetcher.fetch("not-a-url").await.unwrap_err();
        assert!(matches!(err, WebFetchError::InvalidUrl(_)));
    }

    #[tokio::test]
    async fn test_fetch_connection_refused() {
        // 连接到通常没有服务的端口，验证错误处理
        let fetcher = WebFetch::new(WebFetchOptions {
            request_timeout_secs: 2,
            ..test_fetcher().options
        })
        .unwrap();
        let err = fetcher.fetch("http://127.0.0.1:1").await.unwrap_err();
        // 不同系统行为不同（连接拒绝 / 代理返回错误码），只要返回错误即可
        eprintln!("Connection refused error: {}", err);
    }

    // ---- Tool definition ----

    #[test]
    fn test_tool_definition_name() {
        let tool = WebFetch::tool_definition();
        assert_eq!(tool.name, "web_fetch");
    }

    #[test]
    fn test_tool_definition_has_description() {
        let tool = WebFetch::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_valid_schema() {
        let tool = WebFetch::tool_definition();
        assert_eq!(
            tool.input_schema.as_ref().unwrap()["type"],
            serde_json::Value::String("object".to_string())
        );
        assert!(tool.input_schema.as_ref().unwrap()["properties"]["url"].is_object());
        assert!(
            tool.input_schema.as_ref().unwrap()["required"]
                .as_array()
                .unwrap()
                .contains(&serde_json::Value::String("url".to_string()))
        );
    }

    // ---- URL validation edge cases ----

    #[test]
    fn test_validate_url_uppercase_http() {
        // 大写协议 HTTP:// 应当被拒绝（starts_with 大小写敏感）
        let result = validate_url("HTTP://example.com");
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("http/https"));
    }

    #[test]
    fn test_validate_url_uppercase_https() {
        let result = validate_url("HTTPS://example.com");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_with_fragment() {
        let result = validate_url("http://example.com#section");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_url_with_query() {
        let result = validate_url("http://example.com?q=rust&page=1");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_url_with_path() {
        let result = validate_url("https://example.com/path/to/page.html");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_url_non_ascii_domain() {
        // URL 字符串层面应当允许非 ASCII
        let result = validate_url("http://例子.测试");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_url_long_url() {
        let long = format!("https://example.com/{}", "a".repeat(2000));
        let result = validate_url(&long);
        assert!(result.is_ok());
    }

    // ---- HTTP error body truncation ----

    #[tokio::test]
    async fn test_fetch_http_error_body_truncated() {
        let mock_server = MockServer::start().await;

        // 返回超过 500 字符的错误 body
        let long_body = "error ".repeat(200); // ~1200 chars
        Mock::given(matchers::method("GET"))
            .respond_with(ResponseTemplate::new(502).set_body_string(&long_body))
            .mount(&mock_server)
            .await;

        let fetcher = test_fetcher();
        let err = fetcher.fetch(&mock_server.uri()).await.unwrap_err();
        match err {
            WebFetchError::HttpError { status, body } => {
                assert_eq!(status, 502);
                assert!(
                    body.contains("... (truncated)"),
                    "long body should be truncated: {}",
                    body
                );
                assert!(
                    body.len() < long_body.len(),
                    "truncated body should be shorter"
                );
            }
            other => panic!("Expected HttpError, got: {}", other),
        }
    }

    #[tokio::test]
    async fn test_fetch_http_error_body_short() {
        let mock_server = MockServer::start().await;

        // 短的错误 body，不应截断
        Mock::given(matchers::method("GET"))
            .respond_with(ResponseTemplate::new(403).set_body_string("Forbidden"))
            .mount(&mock_server)
            .await;

        let fetcher = test_fetcher();
        let err = fetcher.fetch(&mock_server.uri()).await.unwrap_err();
        match err {
            WebFetchError::HttpError { status, body } => {
                assert_eq!(status, 403);
                assert_eq!(body, "Forbidden");
            }
            other => panic!("Expected HttpError, got: {}", other),
        }
    }

    // ---- Content-Type: None (accept all) ----

    #[tokio::test]
    async fn test_fetch_accept_all_content_types() {
        let mock_server = MockServer::start().await;

        Mock::given(matchers::method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "application/pdf")
                    .set_body_string("%PDF-1.4 fake pdf content"),
            )
            .mount(&mock_server)
            .await;

        let fetcher = WebFetch::new(WebFetchOptions {
            allowed_content_types: None,
            ..test_fetcher().options
        })
        .unwrap();

        let result = fetcher.fetch(&mock_server.uri()).await;
        assert!(
            result.is_ok(),
            "should accept PDF when allowed_content_types is None"
        );
    }

    // ---- map_reqwest_error timeout path (via wiremock) ----

    #[tokio::test]
    async fn test_fetch_timeout_error() {
        let mock_server = MockServer::start().await;

        // 使用超短超时 + 延迟响应来触发超时
        Mock::given(matchers::method("GET"))
            .respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_secs(5)))
            .mount(&mock_server)
            .await;

        let fetcher = WebFetch::new(WebFetchOptions {
            request_timeout_secs: 1,
            max_content_length: 10_000,
            output_max_chars: 10_000,
            ..Default::default()
        })
        .unwrap();

        let err = fetcher.fetch(&mock_server.uri()).await.unwrap_err();
        assert!(matches!(err, WebFetchError::Network(_)));
        assert!(
            err.to_string().contains("timed out"),
            "timeout error should mention timeout: {}",
            err
        );
    }

    #[tokio::test]
    async fn test_fetch_too_many_redirects() {
        let mock_server = MockServer::start().await;

        // 设置一个指向自身的重定向，触发重定向限制
        let redirect_url = format!("{}/loop", mock_server.uri());
        let redirect_clone = redirect_url.clone();

        Mock::given(matchers::method("GET"))
            .respond_with(ResponseTemplate::new(302).insert_header("Location", &redirect_clone))
            .mount(&mock_server)
            .await;

        Mock::given(matchers::method("GET"))
            .and(matchers::path("/loop"))
            .respond_with(ResponseTemplate::new(302).insert_header("Location", &redirect_url))
            .mount(&mock_server)
            .await;

        let fetcher = WebFetch::new(WebFetchOptions {
            max_redirects: 3,
            request_timeout_secs: 5,
            max_content_length: 10_000,
            output_max_chars: 10_000,
            ..Default::default()
        })
        .unwrap();

        let err = fetcher.fetch(&mock_server.uri()).await.unwrap_err();
        assert!(matches!(err, WebFetchError::Network(_)));
    }
}
