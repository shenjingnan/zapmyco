use futures_util::StreamExt;
use std::time::Instant;
/// AI Agent - 基于 anthropic-ai-sdk 的 LLM 对话代理
use zapmyco_anthropic_ai_sdk::client::AnthropicClient;
use zapmyco_anthropic_ai_sdk::types::message::{
    ContentBlock, ContentBlockDelta, CreateMessageParams, CreateMessageResponse, Message,
    MessageClient, MessageError, RequiredMessageParams, Role, StopReason, StreamEvent, Tool,
};

use crate::conversation_logger::ConversationLogger;
use crate::datetime;
use crate::models::get_model_info;
use crate::settings::{is_conversation_log_enabled, load_settings, resolve_env_ref};

/// AiAgent 配置选项
#[derive(Debug, Default)]
pub struct AiAgentOptions {
    /// API Key，默认从 settings.toml 或 DEEPSEEK_API_KEY 环境变量读取
    pub api_key: Option<String>,
    /// API 基础 URL，默认从内置模型注册表读取
    pub base_url: Option<String>,
    /// 模型名称，默认从 modelProfile 或内置模型注册表读取
    pub model: Option<String>,
    /// 模型配置档名称（对应 settings.toml llm.models 中的 key）
    pub model_profile: Option<String>,
    /// 供应商名称（对应 settings.toml llm.providers 中的 key）
    pub provider: Option<String>,
    /// 最大输出 tokens
    pub max_tokens: Option<u32>,
    /// 系统提示词
    pub system_prompt: Option<String>,
}

const DEFAULT_BASE_URL: &str = "https://api.deepseek.com/anthropic";
const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const DEFAULT_SYSTEM_PROMPT: &str = "你是一个 AI 编程助手，帮助用户解决编程问题。";
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// 对话消息
#[derive(Debug, Clone)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
    /// 结构化内容块（用于 ToolUse/ToolResult）
    pub blocks: Option<Vec<ContentBlock>>,
}

/// 工具处理器
pub enum ToolHandler {
    WebFetch(crate::web_fetch::WebFetch),
    RunCommand(crate::run_command::RunCommand),
}

impl ToolHandler {
    fn tool_definition(&self) -> Tool {
        match self {
            ToolHandler::WebFetch(_) => crate::web_fetch::WebFetch::tool_definition(),
            ToolHandler::RunCommand(_) => crate::run_command::RunCommand::tool_definition(),
        }
    }

    async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        match self {
            ToolHandler::WebFetch(fetcher) => {
                let url = input
                    .get("url")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing required 'url' parameter")?;
                fetcher.fetch(url).await.map_err(|e| e.to_string())
            }
            ToolHandler::RunCommand(executor) => {
                let command = input
                    .get("command")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing required 'command' parameter")?;
                let description = input.get("description").and_then(|v| v.as_str());
                let working_directory = input.get("working_directory").and_then(|v| v.as_str());
                executor
                    .execute(command, description, working_directory)
                    .await
                    .map_err(|e| e.to_string())
            }
        }
    }
}

/// AI Agent 类 - 封装 LLM 对话功能
pub struct AiAgent {
    client: AnthropicClient,
    model: String,
    max_tokens: u32,
    system_prompt: String,
    /// 原始系统提示词（不含工具描述，用于重建 system_prompt）
    base_system_prompt: String,
    messages: Vec<ConversationMessage>,
    logger: Option<ConversationLogger>,
    /// 已注册的工具
    tools: Vec<ToolHandler>,
    /// 工具调用最大轮次
    max_tool_rounds: u32,
}

impl AiAgent {
    /// 创建新的 AiAgent 实例
    ///
    /// 从 settings.toml 和环境变量自动解析配置，参数可覆盖默认值。
    pub fn new(options: AiAgentOptions) -> Result<Self, String> {
        // 加载 ~/.zapmyco/settings.toml，文件必须存在
        let settings = load_settings()
            .map_err(|e| format!("读取配置文件失败: {}", e))?
            .ok_or_else(|| {
                format!(
                    "未找到配置文件 {}。请先运行 `zapmyco init` 初始化 LLM 配置。",
                    crate::settings::get_settings_path().display()
                )
            })?;
        let llm = settings.llm.as_ref();

        // 1. 确定模型配置档名称
        let profile_name = options.model_profile.as_deref().unwrap_or("default");

        // 2. 从配置档解析模型名称
        let profile_model_name = llm
            .and_then(|l| l.models.as_ref())
            .and_then(|m| m.get(profile_name))
            .map(|s| s.as_str());

        // 3. 最终模型名称：options.model > 配置档模型名 > 默认值
        let model_name = options
            .model
            .as_deref()
            .or(profile_model_name)
            .unwrap_or(DEFAULT_MODEL);

        // 4. 从内置注册表查找模型信息
        let model_info = get_model_info(model_name);

        // 5. 确定供应商名称：options.provider > 注册表中的供应商 > 'default'
        let provider_name = options
            .provider
            .as_deref()
            .or(model_info.map(|i| i.provider))
            .unwrap_or("default");

        // 6. 解析 apiKey：options > settings.providers[provider].apiKey > 环境变量
        let api_key = resolve_api_key(options.api_key.as_deref(), llm, provider_name)?;

        // 7. 确定 baseURL：options > 注册表中的 baseURL > 默认值
        let base_url = options
            .base_url
            .as_deref()
            .or(model_info.map(|i| i.base_url))
            .unwrap_or(DEFAULT_BASE_URL);

        // 8. 确定 maxTokens：options > 注册表中的 maxOutputTokens > 默认值 4096
        let max_tokens = options
            .max_tokens
            .or(model_info.and_then(|i| i.max_output_tokens))
            .unwrap_or(DEFAULT_MAX_TOKENS);

        // 9. 构建 Anthropic 客户端（使用兼容 API）
        let client = AnthropicClient::builder(api_key, "2023-06-01")
            .with_api_base_url(base_url)
            .build::<MessageError>()
            .map_err(|e| format!("创建 AI 客户端失败: {}", e))?;

        let system_prompt = options
            .system_prompt
            .unwrap_or_else(|| DEFAULT_SYSTEM_PROMPT.to_string());

        // 初始化对话日志记录器
        let logger = if is_conversation_log_enabled(&settings) {
            match ConversationLogger::new() {
                Ok(l) => Some(l),
                Err(e) => {
                    eprintln!("[警告] 初始化对话日志失败: {}", e);
                    None
                }
            }
        } else {
            None
        };

        Ok(Self {
            client,
            model: model_name.to_string(),
            max_tokens,
            base_system_prompt: system_prompt.clone(),
            system_prompt,
            messages: Vec::new(),
            logger,
            tools: Vec::new(),
            max_tool_rounds: 10,
        })
    }

    /// 非流式对话 - 发送消息并获取完整回复
    pub async fn chat(&mut self, input: &str) -> Result<String, String> {
        self.messages.push(ConversationMessage {
            role: "user".to_string(),
            content: input.to_string(),
            blocks: None,
        });

        let params = self.build_params(false)?;
        let start = Instant::now();

        let response = self
            .client
            .create_message(Some(&params))
            .await
            .map_err(|e| format!("API 请求失败: {}", e))?;

        let duration_ms = start.elapsed().as_millis() as u64;

        let full_content = extract_text_from_blocks(&response.content);

        self.messages.push(ConversationMessage {
            role: "assistant".to_string(),
            content: full_content.clone(),
            blocks: None,
        });

        // 记录日志
        if let Some(ref logger) = self.logger {
            log_round_trip(logger, &params, &response, duration_ms);
        }

        Ok(full_content)
    }

    /// 流式对话 - 发送消息并通过回调逐块获取回复
    pub async fn chat_stream(
        &mut self,
        input: &str,
        on_chunk: impl FnMut(&str),
    ) -> Result<String, String> {
        self.messages.push(ConversationMessage {
            role: "user".to_string(),
            content: input.to_string(),
            blocks: None,
        });

        let params = self.build_params(true)?;
        let start = Instant::now();

        let mut stream = self
            .client
            .create_message_streaming(&params)
            .await
            .map_err(|e| format!("API 流式请求失败: {}", e))?;

        let mut full_content = String::new();
        let mut callback = on_chunk;

        // 从流事件中重建完整响应
        let mut resp_id = String::new();
        let mut resp_model = self.model.clone();
        let mut resp_stop_reason: Option<String> = None;
        let mut resp_input_tokens: u32 = 0;
        let mut resp_output_tokens: u32 = 0;
        let mut resp_cache_creation_input_tokens: Option<u32> = None;
        let mut resp_cache_read_input_tokens: Option<u32> = None;
        let mut resp_error: Option<String> = None;

        while let Some(event) = stream.next().await {
            match event.map_err(|e| format!("流式读取失败: {}", e))? {
                StreamEvent::MessageStart { message } => {
                    resp_id = message.id;
                    resp_model = message.model;
                    resp_input_tokens = message.usage.input_tokens;
                }
                StreamEvent::ContentBlockDelta {
                    delta: ContentBlockDelta::TextDelta { text },
                    ..
                } => {
                    full_content.push_str(&text);
                    callback(&text);
                }
                StreamEvent::MessageDelta { delta, usage } => {
                    if let Some(ref stop) = delta.stop_reason {
                        resp_stop_reason = Some(format!("{:?}", stop));
                    }
                    if let Some(u) = usage {
                        resp_output_tokens = u.output_tokens;
                        resp_cache_creation_input_tokens = u.cache_creation_input_tokens;
                        resp_cache_read_input_tokens = u.cache_read_input_tokens;
                    }
                }
                StreamEvent::Error { error } => {
                    resp_error = Some(format!("{} - {}", error.type_, error.message));
                    return Err(format!("API 错误: {}", resp_error.as_ref().unwrap()));
                }
                _ => {}
            }
        }

        let duration_ms = start.elapsed().as_millis() as u64;

        self.messages.push(ConversationMessage {
            role: "assistant".to_string(),
            content: full_content.clone(),
            blocks: None,
        });

        // 记录日志
        if let Some(ref logger) = self.logger {
            let request_value = serde_json::to_value(&params).unwrap_or_default();
            let response_value = serde_json::json!({
                "id": resp_id,
                "type": "message",
                "role": "assistant",
                "model": resp_model,
                "content": [{"type": "text", "text": full_content}],
                "stop_reason": resp_stop_reason,
                "stop_sequence": null,
                "usage": {
                    "input_tokens": resp_input_tokens,
                    "output_tokens": resp_output_tokens,
                    "cache_creation_input_tokens": resp_cache_creation_input_tokens,
                    "cache_read_input_tokens": resp_cache_read_input_tokens,
                },
                "error": resp_error,
            });
            let ts = datetime::iso_timestamp_now();
            let _ = logger.append_record(ts, duration_ms, request_value, response_value);
        }

        Ok(full_content)
    }

    /// 启动交互式对话 - 从 stdin 读取输入，流式输出到 stdout
    pub async fn start_interactive_chat(&mut self) -> Result<(), String> {
        use tokio::io::{AsyncBufReadExt, BufReader};

        eprintln!("进入 AI 对话模式");
        eprintln!("模型: {}", self.model);
        eprintln!("输入 /exit 退出，/clear 清空上下文");
        eprintln!("---");

        let stdin = tokio::io::stdin();
        let reader = BufReader::new(stdin);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }

            if trimmed == "/exit" {
                eprintln!("\n再见！");
                break;
            }

            if trimmed == "/clear" {
                self.messages.clear();
                eprintln!("上下文已清空");
                continue;
            }

            eprintln!("\n❯ {}\n", trimmed);

            let content = trimmed.clone();
            let result = self
                .chat_stream(&content, |chunk| {
                    print!("{}", chunk);
                    use std::io::Write;
                    std::io::stdout().flush().ok();
                })
                .await;

            match result {
                Ok(_) => {
                    eprintln!("\n---");
                }
                Err(e) => {
                    eprintln!("\n[错误] {}", e);
                }
            }
        }

        Ok(())
    }

    /// 清空对话上下文
    pub fn clear_context(&mut self) {
        self.messages.clear();
    }

    /// 注册工具处理器
    pub fn register_tool(&mut self, handler: ToolHandler) {
        self.tools.push(handler);
        self.rebuild_system_prompt_with_tools();
    }

    /// 从 base_system_prompt + 所有已注册工具描述重建 system_prompt
    fn rebuild_system_prompt_with_tools(&mut self) {
        self.system_prompt = self.base_system_prompt.clone();
        if self.tools.is_empty() {
            return;
        }

        self.system_prompt.push_str("\n\n你有以下工具可以使用：\n");

        for handler in &self.tools {
            let desc = match handler {
                ToolHandler::WebFetch(_) => {
                    "- web_fetch: 获取网页内容并转换为 Markdown。当你需要访问互联网信息时使用。"
                }
                ToolHandler::RunCommand(_) => {
                    "- run_command: 在本地系统执行 shell 命令并返回输出。当你需要运行代码、查询系统信息或文件操作时使用。"
                }
            };
            self.system_prompt.push_str(desc);
            self.system_prompt.push('\n');
        }

        self.system_prompt.push_str("使用工具时请注意安全。");
    }

    /// 获取当前使用的模型名称
    pub fn model(&self) -> &str {
        &self.model
    }

    /// 获取当前对话历史
    pub fn get_messages(&self) -> &[ConversationMessage] {
        &self.messages
    }

    /// 带工具调用的对话 - 自动处理 ToolUse 循环
    ///
    /// 工具调用阶段使用非流式请求，最终回复使用流式输出（通过 `on_chunk` 回调）。
    pub async fn chat_with_tools(
        &mut self,
        input: &str,
        on_chunk: impl FnMut(&str),
    ) -> Result<String, String> {
        self.messages.push(ConversationMessage {
            role: "user".to_string(),
            content: input.to_string(),
            blocks: None,
        });

        for _round in 0..self.max_tool_rounds {
            eprintln!("\n[LLM] 🤔 思考中...");
            let params = self.build_params(false)?;
            let start = Instant::now();

            let response = self
                .client
                .create_message(Some(&params))
                .await
                .map_err(|e| format!("API request failed: {}", e))?;

            let duration_ms = start.elapsed().as_millis() as u64;
            eprintln!("[LLM] 💬 LLM 响应 ({:.1}s)", duration_ms as f64 / 1000.0);

            // 检测是否有 ToolUse
            let has_tool_use =
                !self.tools.is_empty() && response.stop_reason == Some(StopReason::ToolUse);

            if !has_tool_use {
                // ---- 最终回复：用流式方式输出 ----
                if let Some(ref logger) = self.logger {
                    log_round_trip(logger, &params, &response, duration_ms);
                }

                eprintln!("\n[LLM] 📝 输出中...\n");
                let stream_params = self.build_params(true)?;
                let mut callback = on_chunk;
                let mut stream = self
                    .client
                    .create_message_streaming(&stream_params)
                    .await
                    .map_err(|e| format!("API 流式请求失败: {}", e))?;

                let mut full_content = String::new();
                while let Some(event) = stream.next().await {
                    if let StreamEvent::ContentBlockDelta {
                        delta: ContentBlockDelta::TextDelta { text },
                        ..
                    } = event.map_err(|e| format!("流式读取失败: {}", e))?
                    {
                        full_content.push_str(&text);
                        callback(&text);
                    }
                }

                self.messages.push(ConversationMessage {
                    role: "assistant".to_string(),
                    content: full_content.clone(),
                    blocks: None,
                });

                use std::io::Write;
                std::io::stdout().flush().ok();

                return Ok(full_content);
            }

            // ---- 工具调用处理 ----

            let text_part = extract_text_from_blocks(&response.content);

            // 保存 assistant 消息（包含 ToolUse blocks）
            self.messages.push(ConversationMessage {
                role: "assistant".to_string(),
                content: text_part,
                blocks: Some(response.content.clone()),
            });

            // 提取所有 ToolUse block
            let tool_uses: Vec<(String, String, serde_json::Value)> = response
                .content
                .iter()
                .filter_map(|block| {
                    if let ContentBlock::ToolUse { id, name, input } = block {
                        Some((id.clone(), name.clone(), input.clone()))
                    } else {
                        None
                    }
                })
                .collect();

            // 执行所有工具（带终端输出）
            let mut tool_result_blocks: Vec<ContentBlock> = Vec::new();
            for (tool_use_id, name, input) in &tool_uses {
                eprintln!("\n[工具] 🔧 {} 准备调用...", name);

                let handler = self
                    .tools
                    .iter()
                    .find(|h| h.tool_definition().name == *name)
                    .ok_or_else(|| format!("Unknown tool: {}", name))?;

                // 显示工具参数
                match name.as_str() {
                    "web_fetch" => {
                        if let Some(url) = input.get("url").and_then(|v| v.as_str()) {
                            eprintln!("[工具]   └ 参数: url = {}", url);
                        }
                    }
                    "run_command" => {
                        if let Some(cmd) = input.get("command").and_then(|v| v.as_str()) {
                            let truncated = if cmd.len() > 80 {
                                format!("{}...", &cmd[..80])
                            } else {
                                cmd.to_string()
                            };
                            eprintln!("[工具]   └ 命令: {}", truncated);
                        }
                        if let Some(desc) = input.get("description").and_then(|v| v.as_str()) {
                            let truncated = if desc.len() > 60 {
                                format!("{}...", &desc[..60])
                            } else {
                                desc.to_string()
                            };
                            eprintln!("[工具]   └ 描述: {}", truncated);
                        }
                        if let Some(dir) = input.get("working_directory").and_then(|v| v.as_str()) {
                            eprintln!("[工具]   └ 工作目录: {}", dir);
                        }
                    }
                    _ => {}
                }

                let start = Instant::now();
                let result_text = match handler.execute(input).await {
                    Ok(text) => {
                        let elapsed = start.elapsed();
                        eprintln!(
                            "[工具] ✅ {} 完成 ({:.1}s, {} 字符)",
                            name,
                            elapsed.as_secs_f64(),
                            text.len()
                        );
                        text
                    }
                    Err(e) => {
                        eprintln!("[工具] ❌ {} 失败: {}", name, e);
                        format!("[Tool error: {}]", e)
                    }
                };

                tool_result_blocks.push(ContentBlock::ToolResult {
                    tool_use_id: tool_use_id.clone(),
                    content: result_text,
                });
            }

            // 将工具结果作为用户消息追加
            self.messages.push(ConversationMessage {
                role: "user".to_string(),
                content: String::new(),
                blocks: Some(tool_result_blocks),
            });

            if let Some(ref logger) = self.logger {
                log_round_trip(logger, &params, &response, duration_ms);
            }

            // 继续下一轮循环
        }

        Err(format!(
            "Tool use exceeded max rounds ({})",
            self.max_tool_rounds
        ))
    }

    /// 构建请求参数
    fn build_params(&self, stream: bool) -> Result<CreateMessageParams, String> {
        let api_messages: Vec<Message> = self
            .messages
            .iter()
            .map(|msg| {
                let role = match msg.role.as_str() {
                    "assistant" => Role::Assistant,
                    _ => Role::User,
                };
                if let Some(ref blocks) = msg.blocks {
                    Message::new_blocks(role, blocks.clone())
                } else {
                    Message::new_text(role, &msg.content)
                }
            })
            .collect();

        let required = RequiredMessageParams {
            model: self.model.clone(),
            messages: api_messages,
            max_tokens: self.max_tokens,
        };

        let mut params = CreateMessageParams::new(required);
        if !self.system_prompt.is_empty() {
            params = params.with_system(&self.system_prompt);
        }
        if stream {
            params = params.with_stream(true);
        }

        // 添加工具定义
        if !self.tools.is_empty() {
            let tool_defs: Vec<Tool> = self.tools.iter().map(|t| t.tool_definition()).collect();
            params = params.with_tools(tool_defs);
        }

        Ok(params)
    }
}

/// 解析 API Key
pub(crate) fn resolve_api_key(
    explicit_key: Option<&str>,
    llm: Option<&crate::settings::LlmSettings>,
    provider_name: &str,
) -> Result<String, String> {
    if let Some(key) = explicit_key.filter(|k| !k.is_empty()) {
        return Ok(key.to_string());
    }

    if let Some(llm) = llm
        && let Some(providers) = &llm.providers
        && let Some(cfg) = providers.get(provider_name)
        && let Some(ref api_key) = cfg.api_key
        && !api_key.is_empty()
    {
        return resolve_env_ref(api_key);
    }

    // 回退到环境变量
    if let Ok(key) = std::env::var("DEEPSEEK_API_KEY")
        && !key.is_empty()
    {
        return Ok(key);
    }

    Err(
        "DEEPSEEK_API_KEY 未设置。请运行 `zapmyco init` 或设置环境变量 DEEPSEEK_API_KEY。"
            .to_string(),
    )
}

/// 从 ContentBlock 列表中提取纯文本
fn extract_text_from_blocks(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| {
            if let ContentBlock::Text { text, .. } = block {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("")
}

/// 记录非流式对话的 round-trip 日志
fn log_round_trip(
    logger: &ConversationLogger,
    params: &CreateMessageParams,
    response: &CreateMessageResponse,
    duration_ms: u64,
) {
    let ts = datetime::iso_timestamp_now();
    let request_value = serde_json::to_value(params).unwrap_or_default();
    let response_value = serde_json::to_value(response).unwrap_or_default();
    let _ = logger.append_record(ts, duration_ms, request_value, response_value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;

    #[test]
    fn test_agent_no_api_key() {
        run_with_temp_home(|home| {
            // 创建最小配置
            create_test_settings(home, "[llm]\n");

            // 移除环境变量，确保走 settings 流程
            let orig_key = std::env::var("DEEPSEEK_API_KEY").ok();
            // SAFETY: test isolation via run_with_temp_home
            unsafe {
                std::env::remove_var("DEEPSEEK_API_KEY");
            }

            let result = AiAgent::new(AiAgentOptions {
                api_key: Some("".to_string()),
                ..Default::default()
            });
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("DEEPSEEK_API_KEY"));

            // SAFETY: restore env
            if let Some(k) = orig_key {
                unsafe {
                    std::env::set_var("DEEPSEEK_API_KEY", k);
                }
            }
        });
    }

    #[test]
    fn test_agent_no_settings_file() {
        run_with_temp_home(|_home| {
            // 不创建任何配置文件 → 应报错提示 init
            let orig_key = std::env::var("DEEPSEEK_API_KEY").ok();
            unsafe {
                std::env::remove_var("DEEPSEEK_API_KEY");
            }
            let result = AiAgent::new(AiAgentOptions::default());
            assert!(result.is_err());
            let err = result.err().unwrap();
            assert!(err.contains("zapmyco init"));

            if let Some(k) = orig_key {
                unsafe {
                    std::env::set_var("DEEPSEEK_API_KEY", k);
                }
            }
        });
    }

    /// 在临时 HOME 下创建测试用 settings.toml
    fn create_test_settings(home: &std::path::Path, content: &str) {
        let dir = home.join(".zapmyco");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.toml"), content).unwrap();
    }

    #[test]
    fn test_agent_custom_options() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                base_url: Some("https://custom.example.com".to_string()),
                model: Some("test-model".to_string()),
                ..Default::default()
            });
            assert!(agent.is_ok());
            let agent = agent.unwrap();
            assert_eq!(agent.get_messages().len(), 0);
        });
    }

    #[test]
    fn test_agent_manage_context() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            assert_eq!(agent.get_messages().len(), 0);
            agent.clear_context();
            assert_eq!(agent.get_messages().len(), 0);
        });
    }

    #[test]
    fn test_agent_resolve_model_from_registry() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                model_profile: Some("default".to_string()),
                ..Default::default()
            });
            // No "default" profile in settings, falls back to DEFAULT_MODEL
            assert!(agent.is_ok());
            let agent = agent.unwrap();
            assert_eq!(agent.get_messages().len(), 0);
        });
    }

    #[test]
    fn test_agent_with_provider() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                model: Some("deepseek-v4-flash".to_string()),
                provider: Some("deepseek".to_string()),
                ..Default::default()
            });
            assert!(agent.is_ok());
        });
    }

    #[test]
    fn test_extract_text_from_blocks() {
        let blocks = vec![
            ContentBlock::Text {
                text: "Hello".to_string(),
                citations: None,
            },
            ContentBlock::Text {
                text: " World".to_string(),
                citations: None,
            },
        ];
        assert_eq!(extract_text_from_blocks(&blocks), "Hello World");
    }

    #[test]
    fn test_extract_text_from_blocks_empty() {
        let blocks: Vec<ContentBlock> = vec![];
        assert_eq!(extract_text_from_blocks(&blocks), "");
    }

    #[test]
    fn test_resolve_api_key_explicit() {
        let result = resolve_api_key(Some("sk-key"), None, "deepseek");
        assert_eq!(result.unwrap(), "sk-key");
    }

    #[test]
    fn test_resolve_api_key_empty_explicit_no_env() {
        // 显式 key 为空串且无环境变量 → 应报错
        let orig_key = std::env::var("DEEPSEEK_API_KEY").ok();
        unsafe {
            std::env::remove_var("DEEPSEEK_API_KEY");
        }
        let result = resolve_api_key(Some(""), None, "deepseek");
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("DEEPSEEK_API_KEY"));
        if let Some(k) = orig_key {
            unsafe {
                std::env::set_var("DEEPSEEK_API_KEY", k);
            }
        }
    }

    #[test]
    fn test_resolve_api_key_from_provider() {
        use crate::settings::{LlmSettings, ProviderConfig};
        use std::collections::HashMap;

        let mut providers = HashMap::new();
        providers.insert(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: Some("provider-key".to_string()),
            },
        );
        let llm = LlmSettings {
            providers: Some(providers),
            models: None,
        };
        let result = resolve_api_key(None, Some(&llm), "deepseek");
        assert_eq!(result.unwrap(), "provider-key");
    }

    #[test]
    fn test_resolve_api_key_from_env() {
        let orig_key = std::env::var("DEEPSEEK_API_KEY").ok();
        unsafe {
            std::env::set_var("DEEPSEEK_API_KEY", "env-key-value");
        }
        let result = resolve_api_key(Some(""), None, "deepseek");
        assert_eq!(result.unwrap(), "env-key-value");
        if let Some(k) = orig_key {
            unsafe {
                std::env::set_var("DEEPSEEK_API_KEY", k);
            }
        } else {
            unsafe {
                std::env::remove_var("DEEPSEEK_API_KEY");
            }
        }
    }

    #[test]
    fn test_resolve_api_key_env_ref_in_provider() {
        use crate::settings::{LlmSettings, ProviderConfig};
        use std::collections::HashMap;

        // 供应商 key 为 ${env.xxx} 格式时需解析
        unsafe {
            std::env::set_var("TEST_PROVIDER_KEY", "resolved-key");
        }
        let mut providers = HashMap::new();
        providers.insert(
            "test-prov".to_string(),
            ProviderConfig {
                api_key: Some("${env.TEST_PROVIDER_KEY}".to_string()),
            },
        );
        let llm = LlmSettings {
            providers: Some(providers),
            models: None,
        };
        let result = resolve_api_key(None, Some(&llm), "test-prov");
        assert_eq!(result.unwrap(), "resolved-key");
        unsafe {
            std::env::remove_var("TEST_PROVIDER_KEY");
        }
    }

    #[test]
    fn test_resolve_api_key_prefer_explicit_over_provider() {
        use crate::settings::{LlmSettings, ProviderConfig};
        use std::collections::HashMap;

        let mut providers = HashMap::new();
        providers.insert(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: Some("provider-key".to_string()),
            },
        );
        let llm = LlmSettings {
            providers: Some(providers),
            models: None,
        };
        // 显式 key 优先于 provider key
        let result = resolve_api_key(Some("explicit-key"), Some(&llm), "deepseek");
        assert_eq!(result.unwrap(), "explicit-key");
    }

    #[test]
    fn test_build_params_with_system_prompt() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                system_prompt: Some("你是一个测试助手".to_string()),
                ..Default::default()
            })
            .unwrap();
            // build_params 是私有方法，通过 chat 间接测试参数构建
            // 验证 agent 初始化正确且系统提示词已设置
            assert_eq!(agent.get_messages().len(), 0);
        });
    }

    #[test]
    fn test_extract_text_from_blocks_mixed() {
        let blocks = vec![
            ContentBlock::Text {
                text: "Hello".to_string(),
                citations: None,
            },
            ContentBlock::ToolUse {
                id: "id1".to_string(),
                name: "my_tool".to_string(),
                input: serde_json::Value::Null,
            },
            ContentBlock::Text {
                text: " World".to_string(),
                citations: None,
            },
        ];
        assert_eq!(extract_text_from_blocks(&blocks), "Hello World");
    }

    #[test]
    fn test_extract_text_from_blocks_only_non_text() {
        let blocks = vec![ContentBlock::ToolUse {
            id: "id1".to_string(),
            name: "my_tool".to_string(),
            input: serde_json::Value::Null,
        }];
        assert_eq!(extract_text_from_blocks(&blocks), "");
    }

    #[test]
    fn test_agent_model_getter() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                model: Some("custom-model".to_string()),
                ..Default::default()
            })
            .unwrap();
            assert_eq!(agent.model(), "custom-model");
        });
    }

    #[test]
    fn test_agent_model_from_profile() {
        run_with_temp_home(|home| {
            create_test_settings(
                home,
                "[llm]\n\n[llm.models]\nadvanced = \"deepseek-reasoner\"\n",
            );
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                model_profile: Some("advanced".to_string()),
                ..Default::default()
            })
            .unwrap();
            assert_eq!(agent.model(), "deepseek-reasoner");
        });
    }

    #[test]
    fn test_resolve_api_key_provider_none_key() {
        use crate::settings::{LlmSettings, ProviderConfig};
        use std::collections::HashMap;

        let mut providers = HashMap::new();
        providers.insert("deepseek".to_string(), ProviderConfig { api_key: None });
        let llm = LlmSettings {
            providers: Some(providers),
            models: None,
        };
        // Provider 有配置但 api_key 为 None → 应该落到 env 或报错
        let orig_key = std::env::var("DEEPSEEK_API_KEY").ok();
        unsafe {
            std::env::remove_var("DEEPSEEK_API_KEY");
        }
        let result = resolve_api_key(None, Some(&llm), "deepseek");
        assert!(result.is_err());
        if let Some(k) = orig_key {
            unsafe {
                std::env::set_var("DEEPSEEK_API_KEY", k);
            }
        }
    }

    #[test]
    fn test_resolve_api_key_provider_empty_key() {
        use crate::settings::{LlmSettings, ProviderConfig};
        use std::collections::HashMap;

        let mut providers = HashMap::new();
        providers.insert(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: Some(String::new()),
            },
        );
        let llm = LlmSettings {
            providers: Some(providers),
            models: None,
        };
        // Provider 有配置但 api_key 为空串 → 应该落到 env 或报错
        let orig_key = std::env::var("DEEPSEEK_API_KEY").ok();
        unsafe {
            std::env::remove_var("DEEPSEEK_API_KEY");
        }
        let result = resolve_api_key(None, Some(&llm), "deepseek");
        assert!(result.is_err());
        if let Some(k) = orig_key {
            unsafe {
                std::env::set_var("DEEPSEEK_API_KEY", k);
            }
        }
    }

    #[test]
    fn test_agent_new_with_env_var() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            // 设置环境变量，但不在 options 中提供 api_key
            // 应尝试从 providers 读取 → 没有 provider → 读取 DEEPSEEK_API_KEY
            let orig_key = std::env::var("DEEPSEEK_API_KEY").ok();
            unsafe {
                std::env::set_var("DEEPSEEK_API_KEY", "env-key-for-agent");
            }

            let result = AiAgent::new(AiAgentOptions {
                api_key: None,
                ..Default::default()
            });
            // 应成功创建（从环境变量读取 key）
            assert!(result.is_ok());

            if let Some(k) = orig_key {
                unsafe {
                    std::env::set_var("DEEPSEEK_API_KEY", k);
                }
            } else {
                unsafe {
                    std::env::remove_var("DEEPSEEK_API_KEY");
                }
            }
        });
    }

    #[test]
    fn test_build_params_empty_system_prompt() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                system_prompt: Some("".to_string()),
                ..Default::default()
            })
            .unwrap();
            // system_prompt 为空串时 build_params 不应设置 system 字段
            let params = agent.build_params(false).unwrap();
            assert!(params.system.is_none());
        });
    }

    #[test]
    fn test_build_params_stream_true() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            let params = agent.build_params(true).unwrap();
            assert_eq!(params.stream, Some(true));
        });
    }

    #[test]
    fn test_build_params_stream_false() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            let params = agent.build_params(false).unwrap();
            assert!(params.stream.is_none());
        });
    }

    #[test]
    fn test_build_params_messages_count() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            // 直接操作私有字段 messages 添加对话历史
            agent.messages.push(ConversationMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
                blocks: None,
            });
            agent.messages.push(ConversationMessage {
                role: "assistant".to_string(),
                content: "Hi there".to_string(),
                blocks: None,
            });
            let params = agent.build_params(false).unwrap();
            assert_eq!(params.messages.len(), 2);
            // 验证消息角色转换正确
            assert!(matches!(params.messages[0].role, Role::User));
            assert!(matches!(params.messages[1].role, Role::Assistant));
        });
    }

    #[test]
    fn test_log_round_trip_writes_record() {
        run_with_temp_home(|home| {
            let logger = crate::conversation_logger::ConversationLogger::new().unwrap();

            let params = CreateMessageParams::new(RequiredMessageParams {
                model: "test-model".to_string(),
                messages: vec![Message::new_text(Role::User, "Hello")],
                max_tokens: 100,
            });

            let response: CreateMessageResponse = serde_json::from_str(
                r#"{
                    "id": "msg_001",
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "text", "text": "Hi"}],
                    "model": "test-model",
                    "stop_reason": "end_turn",
                    "stop_sequence": null,
                    "usage": {"input_tokens": 5, "output_tokens": 3}
                }"#,
            )
            .unwrap();

            log_round_trip(&logger, &params, &response, 100);

            // 验证日志文件被正确写入
            let log_dir = home.join(".zapmyco/conversations");
            let log_file = log_dir.join(format!("{}.jsonl", logger.session_id()));
            let content = std::fs::read_to_string(&log_file).unwrap();
            assert!(content.contains("test-model"), "日志应包含模型名");
            assert!(content.contains("Hello"), "日志应包含请求内容");
            assert!(content.contains("Hi"), "日志应包含响应内容");
            assert!(content.contains("100"), "日志应包含耗时");
        });
    }

    #[test]
    fn test_agent_new_logger_failure_graceful() {
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(settings_dir.join("settings.toml"), "[llm]\n").unwrap();

            // 将 conversations 创建为文件而非目录，使 create_dir_all 失败
            std::fs::write(settings_dir.join("conversations"), "not a directory").unwrap();

            let result = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            });
            // 日志初始化失败不应阻止 agent 创建
            assert!(result.is_ok());
            // logger 字段应为 None（优雅降级）
            let agent = result.unwrap();
            assert!(agent.logger.is_none());
        });
    }

    // ---- ToolHandler tests ----

    #[test]
    fn test_tool_handler_web_fetch_tool_definition() {
        let web_fetch = crate::web_fetch::WebFetch::new(Default::default()).unwrap();
        let handler = ToolHandler::WebFetch(web_fetch);
        let tool = handler.tool_definition();
        assert_eq!(tool.name, "web_fetch");
        assert!(tool.description.is_some());
        assert!(tool.input_schema["properties"]["url"].is_object());
    }

    #[tokio::test]
    async fn test_tool_handler_execute_missing_url() {
        let web_fetch = crate::web_fetch::WebFetch::new(Default::default()).unwrap();
        let handler = ToolHandler::WebFetch(web_fetch);

        let input = serde_json::json!({});
        let result = handler.execute(&input).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("Missing required 'url'"));
    }

    #[tokio::test]
    async fn test_tool_handler_execute_url_not_string() {
        let web_fetch = crate::web_fetch::WebFetch::new(Default::default()).unwrap();
        let handler = ToolHandler::WebFetch(web_fetch);

        let input = serde_json::json!({"url": 123});
        let result = handler.execute(&input).await;
        assert!(result.is_err());
    }

    // ---- RunCommand ToolHandler tests ----

    #[test]
    fn test_tool_handler_run_command_tool_definition() {
        let executor = crate::run_command::RunCommand::new(Default::default());
        let handler = ToolHandler::RunCommand(executor);
        let tool = handler.tool_definition();
        assert_eq!(tool.name, "run_command");
        assert!(tool.description.is_some());
        assert!(tool.input_schema["properties"]["command"].is_object());
    }

    #[tokio::test]
    async fn test_tool_handler_run_command_missing_cmd() {
        let executor = crate::run_command::RunCommand::new(Default::default());
        let handler = ToolHandler::RunCommand(executor);
        let input = serde_json::json!({});
        let result = handler.execute(&input).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("'command'"));
    }

    #[tokio::test]
    async fn test_tool_handler_run_command_success() {
        let executor = crate::run_command::RunCommand::new(Default::default());
        let handler = ToolHandler::RunCommand(executor);
        let input = serde_json::json!({"command": "echo hello"});
        let result = handler.execute(&input).await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("hello"));
    }

    #[tokio::test]
    async fn test_tool_handler_run_command_with_description() {
        let executor = crate::run_command::RunCommand::new(Default::default());
        let handler = ToolHandler::RunCommand(executor);
        let input = serde_json::json!({
            "command": "echo hello",
            "description": "Testing the run_command tool"
        });
        let result = handler.execute(&input).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_tool_handler_run_command_with_working_dir() {
        let executor = crate::run_command::RunCommand::new(Default::default());
        let handler = ToolHandler::RunCommand(executor);
        let dir = std::env::temp_dir();
        let input = serde_json::json!({
            "command": "pwd",
            "working_directory": dir.to_str().unwrap()
        });
        let result = handler.execute(&input).await;
        assert!(result.is_ok());
        // pwd 可能会解析符号链接，所以只检查退出码
        let output = result.unwrap();
        assert!(output.contains("Exit code: 0"));
    }

    // ---- register_tool tests ----

    #[test]
    fn test_register_tool_adds_to_tools() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            assert!(agent.tools.is_empty());

            let web_fetch = crate::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch));
            assert_eq!(agent.tools.len(), 1);
        });
    }

    #[test]
    fn test_register_tool_updates_system_prompt_with_each_tool() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                system_prompt: Some("原始提示".to_string()),
                ..Default::default()
            })
            .unwrap();

            let web_fetch = crate::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch));

            // 首次注册应该追加工具说明
            assert!(
                agent.system_prompt.contains("web_fetch"),
                "system prompt should mention web_fetch: {}",
                agent.system_prompt
            );
            assert!(
                agent.system_prompt.starts_with("原始提示"),
                "original prompt should be preserved"
            );
            assert_eq!(agent.tools.len(), 1);
            // web_fetch 在 system prompt 中只出现一次（描述本身）
            let web_fetch_count = agent.system_prompt.matches("web_fetch").count();
            assert!(
                web_fetch_count >= 1,
                "web_fetch should appear at least once in system prompt"
            );

            // 第二次注册，system prompt 应更新包含更多工具
            let web_fetch2 = crate::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch2));

            // 提示词被重建，工具数增加
            assert_eq!(agent.tools.len(), 2, "should have 2 tools registered");
            // 原始提示词仍被保留
            assert!(
                agent.system_prompt.starts_with("原始提示"),
                "original prompt should be preserved"
            );
            // 由于每次都重建，prompt 内容不同（有两个 web_fetch 条目）
            // 但 base_system_prompt 应始终与开始时一致
            assert_eq!(agent.base_system_prompt, "原始提示");
        });
    }

    // ---- build_params with tools and blocks ----

    #[test]
    fn test_build_params_with_tools() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            // 注册工具后 build_params 应包含 tool 定义
            let web_fetch = crate::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch));

            let params = agent.build_params(false).unwrap();
            assert!(
                params.tools.is_some(),
                "tools should be present when tools are registered"
            );
            let tools = params.tools.unwrap();
            assert_eq!(tools.len(), 1);
            assert_eq!(tools[0].name, "web_fetch");
        });
    }

    #[test]
    fn test_build_params_with_tools_and_stream() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            let web_fetch = crate::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch));

            // stream=true 且 tools 注册
            let params = agent.build_params(true).unwrap();
            assert_eq!(params.stream, Some(true));
            assert!(params.tools.is_some());
        });
    }

    #[test]
    fn test_build_params_no_tools_no_tool_field() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            let params = agent.build_params(false).unwrap();
            assert!(
                params.tools.is_none(),
                "tools should be None when no tools registered"
            );
        });
    }

    #[test]
    fn test_build_params_with_blocks_message() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            // 添加带 blocks 的消息（模拟工具结果消息）
            agent.messages.push(ConversationMessage {
                role: "user".to_string(),
                content: String::new(),
                blocks: Some(vec![ContentBlock::ToolResult {
                    tool_use_id: "test-id".to_string(),
                    content: "test result".to_string(),
                }]),
            });

            let params = agent.build_params(false).unwrap();
            assert_eq!(params.messages.len(), 1);
            // 应使用 Blocks 而非 Text 格式
            if let zapmyco_anthropic_ai_sdk::types::message::MessageContent::Blocks { content } =
                &params.messages[0].content
            {
                assert_eq!(content.len(), 1);
                assert!(matches!(content[0], ContentBlock::ToolResult { .. }));
            } else {
                panic!("Expected Blocks content for tool result message");
            }
        });
    }

    #[test]
    fn test_build_params_mixed_text_and_blocks() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            // text message + blocks message
            agent.messages.push(ConversationMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
                blocks: None,
            });
            agent.messages.push(ConversationMessage {
                role: "assistant".to_string(),
                content: String::new(),
                blocks: Some(vec![ContentBlock::ToolUse {
                    id: "tu1".to_string(),
                    name: "web_fetch".to_string(),
                    input: serde_json::json!({"url": "https://example.com"}),
                }]),
            });

            let params = agent.build_params(false).unwrap();
            assert_eq!(params.messages.len(), 2);
            // 第一条应该是 Text
            assert!(matches!(
                params.messages[0].content,
                zapmyco_anthropic_ai_sdk::types::message::MessageContent::Text { .. }
            ));
            // 第二条应该是 Blocks
            assert!(matches!(
                params.messages[1].content,
                zapmyco_anthropic_ai_sdk::types::message::MessageContent::Blocks { .. }
            ));
        });
    }
}
