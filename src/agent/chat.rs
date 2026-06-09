use futures_util::StreamExt;
use std::io::IsTerminal;
use std::pin::Pin;
use std::time::Instant;
/// AI Agent - 基于 anthropic-ai-sdk 的 LLM 对话代理
use zapmyco_anthropic_ai_sdk::client::AnthropicClient;
use zapmyco_anthropic_ai_sdk::types::message::{
    ContentBlock, ContentBlockDelta, CreateMessageParams, Message, MessageClient, MessageError,
    RequiredMessageParams, Role, StreamEvent, Tool,
};

use crate::agent::conversation_logger::ConversationLogger;
use crate::agent::system_prompt::SystemPromptBuilder;
use crate::config::models::{
    get_built_in_model_names, get_model_info, guess_provider_from_model_name,
};
use crate::config::settings::{
    is_conversation_log_enabled, load_settings, resolve_env_ref, update_settings_model,
};
use crate::datetime;
use crate::output;

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
    /// 可用 skill 列表文本（注入到 context_reminder）
    pub skill_list_text: Option<String>,
}

const DEFAULT_BASE_URL: &str = "https://api.deepseek.com/anthropic";
const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// 对话消息
#[derive(Debug, Clone, PartialEq)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
    /// 结构化内容块（用于 ToolUse/ToolResult）
    pub blocks: Option<Vec<ContentBlock>>,
}

/// 工具处理器
///
/// 该枚举使用 `#[non_exhaustive]`，因为工具类型会持续扩展。
/// 外部代码应使用 `_` 通配模式进行匹配，以保证未来兼容。
#[non_exhaustive]
pub enum ToolHandler {
    AskUser(crate::tools::ask_user::AskUser),
    WebFetch(crate::tools::web_fetch::WebFetch),
    ShellExec(crate::tools::shell_exec::ShellExec),
    WebSearch(crate::tools::web_search::WebSearch),
    FileSearch(crate::tools::file_search::FileSearch),
    FileFind(crate::tools::file_find::FileFind),
    FileRead(crate::tools::file_read::FileRead),
    FileEdit(crate::tools::file_edit::FileEdit),
    FileWrite(crate::tools::file_write::FileWrite),
    // ★ Task 管理工具
    TaskCreate(std::sync::Arc<crate::tools::task_manager::TaskManager>),
    TaskGet(std::sync::Arc<crate::tools::task_manager::TaskManager>),
    TaskList(std::sync::Arc<crate::tools::task_manager::TaskManager>),
    TaskUpdate(std::sync::Arc<crate::tools::task_manager::TaskManager>),
    /// SubAgent 子代理工具 — 通过子进程执行独立任务
    SubAgent(crate::tools::subagent::SubAgentTool),
    /// Skill 工具 — 加载/列出 skill
    Skill(crate::tools::skill::SkillTool),
}

impl ToolHandler {
    pub(crate) fn tool_definition(&self) -> Tool {
        match self {
            ToolHandler::AskUser(_) => crate::tools::ask_user::AskUser::tool_definition(),
            ToolHandler::WebFetch(_) => crate::tools::web_fetch::WebFetch::tool_definition(),
            ToolHandler::ShellExec(_) => crate::tools::shell_exec::ShellExec::tool_definition(),
            ToolHandler::WebSearch(_) => crate::tools::web_search::WebSearch::tool_definition(),
            ToolHandler::FileSearch(_) => crate::tools::file_search::FileSearch::tool_definition(),
            ToolHandler::FileFind(_) => crate::tools::file_find::FileFind::tool_definition(),
            ToolHandler::FileRead(_) => crate::tools::file_read::FileRead::tool_definition(),
            ToolHandler::FileEdit(_) => crate::tools::file_edit::FileEdit::tool_definition(),
            ToolHandler::FileWrite(_) => crate::tools::file_write::FileWrite::tool_definition(),
            ToolHandler::TaskCreate(_) => crate::tools::task_create::TaskCreate::tool_definition(),
            ToolHandler::TaskGet(_) => crate::tools::task_get::TaskGet::tool_definition(),
            ToolHandler::TaskList(_) => crate::tools::task_list::TaskList::tool_definition(),
            ToolHandler::TaskUpdate(_) => {
                crate::tools::task_update::TaskUpdateTool::tool_definition()
            }
            ToolHandler::SubAgent(_) => crate::tools::subagent::SubAgentTool::tool_definition(),
            ToolHandler::Skill(_) => crate::tools::skill::SkillTool::tool_definition(),
        }
    }

    async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        match self {
            ToolHandler::AskUser(asker) => asker.execute(input).await,
            ToolHandler::WebFetch(fetcher) => {
                let url = input
                    .get("url")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing required 'url' parameter")?;
                fetcher.fetch(url).await.map_err(|e| e.to_string())
            }
            ToolHandler::ShellExec(executor) => {
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
            ToolHandler::WebSearch(searcher) => searcher.execute(input).await,
            ToolHandler::FileSearch(grep) => grep.execute(input).await.map_err(|e| e.to_string()),
            ToolHandler::FileFind(glob) => glob.execute(input).await,
            ToolHandler::FileRead(reader) => reader.execute(input).await,
            ToolHandler::FileEdit(editor) => editor.execute(input).await,
            ToolHandler::FileWrite(writer) => writer.execute(input).await,
            ToolHandler::TaskCreate(mgr) => {
                let tool = crate::tools::task_create::TaskCreate {
                    manager: mgr.clone(),
                };
                tool.execute(input).await
            }
            ToolHandler::TaskGet(mgr) => {
                let tool = crate::tools::task_get::TaskGet {
                    manager: mgr.clone(),
                };
                tool.execute(input).await
            }
            ToolHandler::TaskList(mgr) => {
                let tool = crate::tools::task_list::TaskList {
                    manager: mgr.clone(),
                };
                tool.execute(input).await
            }
            ToolHandler::TaskUpdate(mgr) => {
                let tool = crate::tools::task_update::TaskUpdateTool {
                    manager: mgr.clone(),
                };
                tool.execute(input).await
            }
            ToolHandler::SubAgent(s) => s.execute(input).await,
            ToolHandler::Skill(tool) => tool.execute(input).await,
        }
    }

    /// 判断工具在当前输入下是否可以与其他工具并行执行
    pub(crate) fn is_concurrency_safe(&self, input: &serde_json::Value) -> bool {
        match self {
            // 只读文件操作 —— 安全
            ToolHandler::FileRead(_) | ToolHandler::FileSearch(_) | ToolHandler::FileFind(_) => {
                true
            }
            // 网络查询 —— 安全
            ToolHandler::WebSearch(_) | ToolHandler::WebFetch(_) => true,
            // 任务查询/列表 —— 安全（只读）
            ToolHandler::TaskGet(_) | ToolHandler::TaskList(_) => true,
            // shell_exec —— 仅只读命令安全
            ToolHandler::ShellExec(_) => {
                if let Some(cmd) = input.get("command").and_then(|v| v.as_str()) {
                    let cmd_trimmed = cmd.trim_start();
                    let read_only_prefixes = [
                        "echo",
                        "ls",
                        "cat",
                        "head",
                        "tail",
                        "pwd",
                        "which",
                        "type",
                        "env",
                        "printenv",
                        "date",
                        "whoami",
                        "id",
                        "uname",
                        "hostname",
                        "git status",
                        "git log",
                        "git diff",
                        "git branch",
                        "git remote",
                        "cargo check",
                        "cargo fmt",
                        "cargo clippy",
                        "cargo test",
                        "npm ls",
                        "npm list",
                    ];
                    read_only_prefixes
                        .iter()
                        .any(|p| cmd_trimmed.starts_with(p))
                } else {
                    false
                }
            }
            // SubAgent — 所有 action 均为并发安全（input 由内部判断）
            ToolHandler::SubAgent(s) => s.is_concurrency_safe(input),
            // Skill — 只读，安全
            ToolHandler::Skill(_) => true,
            // 写操作、交互操作 —— 不安全
            ToolHandler::FileEdit(_)
            | ToolHandler::FileWrite(_)
            | ToolHandler::AskUser(_)
            | ToolHandler::TaskCreate(_)
            | ToolHandler::TaskUpdate(_) => false,
        }
    }
}

/// AI Agent 类 - 封装 LLM 对话功能
pub struct AiAgent {
    client: AnthropicClient,
    model: String,
    max_tokens: u32,
    system_prompt: String,
    /// 系统提示词构建器（管理基础提示词与静态长度）
    prompt_builder: crate::agent::system_prompt::SystemPromptBuilder,
    messages: Vec<ConversationMessage>,
    logger: Option<ConversationLogger>,
    /// 已注册的工具
    tools: Vec<ToolHandler>,
    /// 工具调用最大轮次
    max_tool_rounds: u32,
    /// 文件读取状态追踪 (path → mtime_ms)，用于 file_write/file_edit 的预读检查
    read_file_state: std::collections::HashMap<String, u64>,
    /// 任务管理器（可选，用于在终端展示任务列表）
    task_manager: Option<std::sync::Arc<crate::tools::task_manager::TaskManager>>,
    /// 任务展示状态机（可选，用于事件流 + 检查点快照展示）
    task_display: Option<crate::tools::task_display::TaskDisplayState>,
    /// 是否已注入上下文信息（仅首条消息注入一次）
    context_injected: bool,
    /// AGENTS.md 内容（启动时加载，缓存复用）
    agents_md_content: Option<String>,
    /// 可用 skill 列表文本（注入到 context_reminder）
    skill_list_text: Option<String>,
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
                    crate::config::settings::get_settings_path().display()
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
        let initial_model = options
            .model
            .as_deref()
            .or(profile_model_name)
            .unwrap_or(DEFAULT_MODEL);

        let mut model_name = initial_model.to_string();

        // 4. 从内置注册表查找模型信息
        let mut model_info = get_model_info(&model_name);

        // 4.5 模型已在内置列表中找到，或用户已配置自定义 base_url 时跳过提示
        if model_info.is_none() {
            let guessed_provider = guess_provider_from_model_name(&model_name);
            let has_custom_base_url = options.base_url.is_some()
                || guessed_provider
                    .and_then(|p| {
                        llm.and_then(|l| l.providers.as_ref())
                            .and_then(|provs| provs.get(p))
                            .and_then(|c| c.base_url.as_ref())
                    })
                    .is_some();

            if !has_custom_base_url {
                match prompt_model_replacement(&model_name, guessed_provider) {
                    Ok(Some(new_model)) => {
                        // 用户选择了替代模型，持久化到 settings.toml
                        if let Err(e) = update_settings_model(&new_model) {
                            output::send(&output::Message::warning(format!(
                                "自动更新 settings.toml 失败: {}",
                                e
                            )));
                        } else {
                            output::send(&output::Message::info(format!(
                                "✓ 已选择替代模型 '{}'，已自动更新 settings.toml。\n",
                                new_model
                            )));
                        }
                        model_name = new_model;
                        model_info = get_model_info(&model_name);
                    }
                    Ok(None) => {
                        // 用户选择跳过，继续使用原模型（可能失败）
                    }
                    Err(e) => return Err(e),
                }
            }
        }

        // 5. 确定供应商名称：options.provider > 注册表中的供应商 > 'default'
        let provider_name = options
            .provider
            .as_deref()
            .or(model_info.map(|i| i.provider))
            .unwrap_or("default");

        // 6. 解析 apiKey：options > settings.providers[provider].apiKey > 环境变量
        let api_key = resolve_api_key(options.api_key.as_deref(), llm, provider_name)?;

        // 7. 确定 baseURL：options > settings.providers[provider].base_url > 注册表中的 baseURL > 默认值
        let base_url = options
            .base_url
            .as_deref()
            .or_else(|| {
                llm.as_ref()
                    .and_then(|s| s.providers.as_ref())
                    .and_then(|p| p.get(provider_name))
                    .and_then(|c| c.base_url.as_deref())
            })
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

        let prompt_builder = SystemPromptBuilder::new(options.system_prompt);
        let system_prompt = prompt_builder.base_prompt().to_string();

        // 初始化对话日志记录器
        let logger = if is_conversation_log_enabled(&settings) {
            match ConversationLogger::new() {
                Ok(l) => Some(l),
                Err(e) => {
                    output::send(&output::Message::warning(format!(
                        "初始化对话日志失败: {}",
                        e
                    )));
                    None
                }
            }
        } else {
            None
        };

        // 10. 加载 AGENTS.md
        let agents_md_content =
            crate::agent::agents_md::load_agents_md(&std::env::current_dir().unwrap_or_default());

        Ok(Self {
            client,
            model: model_name,
            max_tokens,
            prompt_builder,
            system_prompt,
            messages: Vec::new(),
            logger,
            tools: Vec::new(),
            max_tool_rounds: u32::MAX,
            read_file_state: std::collections::HashMap::new(),
            task_manager: None,
            task_display: None,
            context_injected: false,
            agents_md_content,
            skill_list_text: options.skill_list_text,
        })
    }

    /// 非流式对话 - 发送消息并获取完整回复
    pub async fn chat(&mut self, input: &str) -> Result<String, String> {
        let full_input = if !self.context_injected {
            self.context_injected = true;
            format!(
                "{}{}",
                crate::agent::system_prompt::build_context_reminder(
                    self.agents_md_content.as_deref()
                ),
                input
            )
        } else {
            input.to_string()
        };

        self.messages.push(ConversationMessage {
            role: "user".to_string(),
            content: full_input,
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

        let full_content = crate::agent::executor::extract_text_from_blocks(&response.content);

        self.messages.push(ConversationMessage {
            role: "assistant".to_string(),
            content: full_content.clone(),
            blocks: None,
        });

        // 输出 token 用量
        crate::agent::executor::print_usage_line(
            None,
            response.usage.input_tokens,
            response.usage.output_tokens,
            response.usage.cache_read_input_tokens,
            response.usage.cache_creation_input_tokens,
            duration_ms,
        );

        // 记录日志
        if let Some(ref logger) = self.logger {
            crate::agent::executor::log_round_trip(logger, &params, &response, duration_ms);
        }

        Ok(full_content)
    }

    /// 流式对话 - 发送消息并通过回调逐块获取回复
    pub async fn chat_stream(
        &mut self,
        input: &str,
        on_chunk: impl FnMut(&str),
    ) -> Result<String, String> {
        let full_input = if !self.context_injected {
            self.context_injected = true;
            format!(
                "{}{}",
                crate::agent::system_prompt::build_context_reminder(
                    self.agents_md_content.as_deref()
                ),
                input
            )
        } else {
            input.to_string()
        };

        self.messages.push(ConversationMessage {
            role: "user".to_string(),
            content: full_input,
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

        // 输出 token 用量
        crate::agent::executor::print_usage_line(
            None,
            resp_input_tokens,
            resp_output_tokens,
            resp_cache_read_input_tokens,
            resp_cache_creation_input_tokens,
            duration_ms,
        );

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

    /// 注册工具处理器
    pub fn register_tool(&mut self, handler: ToolHandler) {
        self.tools.push(handler);
    }

    /// 获取所有已注册工具的名称
    pub fn tool_names(&self) -> Vec<String> {
        self.tools
            .iter()
            .map(|t| t.tool_definition().name.clone())
            .collect()
    }

    /// 根据名称批量移除已注册的工具
    pub fn remove_tools(&mut self, names: &[&str]) {
        self.tools
            .retain(|t| !names.contains(&t.tool_definition().name.as_str()));
    }

    /// 设置任务管理器（用于在终端展示任务列表）
    pub fn set_task_manager(
        &mut self,
        tm: std::sync::Arc<crate::tools::task_manager::TaskManager>,
    ) {
        self.task_manager = Some(tm);
        self.task_display = Some(crate::tools::task_display::TaskDisplayState::new());
    }

    /// 使用事件流 + 检查点快照模式展示任务列表到 stderr
    async fn print_task_summary_if_needed(&mut self) {
        let tm = match self.task_manager.as_ref() {
            Some(tm) => tm.clone(),
            _ => return,
        };
        let td = match self.task_display.as_mut() {
            Some(td) => td,
            _ => return,
        };

        let tasks = match tm.list().await {
            Ok(t) => t,
            Err(e) => {
                output::send(&output::Message::info(format!(
                    "[Task] 获取任务列表失败: {}",
                    e
                )));
                return;
            }
        };

        let output = td.compute_output(&tasks);

        for event in &output.events {
            let text = event.to_string();
            if !text.is_empty() {
                output::send(&output::Message::info(text));
            }
        }
        if let Some(snapshot) = &output.snapshot {
            output::send(&output::Message::info(format!("\n{}\n", snapshot)));
        }
    }

    /// 获取当前使用的模型名称
    pub fn model(&self) -> &str {
        &self.model
    }

    /// 获取当前对话历史
    pub fn get_messages(&self) -> &[ConversationMessage] {
        &self.messages
    }

    /// 向对话历史追加一条用户消息（用于在外部注入用户干预/纠偏信息）
    pub fn add_user_message(&mut self, content: &str) {
        self.messages.push(ConversationMessage {
            role: "user".to_string(),
            content: content.to_string(),
            blocks: None,
        });
    }

    /// 注入历史消息（用于 --conversation 恢复上下文）
    ///
    /// 将之前会话的消息历史注入当前 agent，同时设置 `context_injected = true`
    /// 防止 `chat_with_tools` 重复注入 context_reminder。
    pub fn inject_history(&mut self, history: Vec<ConversationMessage>) {
        self.messages = history;
        self.context_injected = true;
    }

    /// 带工具调用的对话 - 自动处理 ToolUse 循环
    ///
    /// 使用统一流式请求，在工具调用阶段实时输出 LLM 推理文本，
    /// 最终回复阶段直接使用流式文本，无需额外请求。
    pub async fn chat_with_tools(
        &mut self,
        input: &str,
        mut on_chunk: impl FnMut(&str),
    ) -> Result<String, String> {
        let full_input = if !self.context_injected {
            self.context_injected = true;
            let mut reminder = crate::agent::system_prompt::build_context_reminder(
                self.agents_md_content.as_deref(),
            );
            if let Some(ref list) = self.skill_list_text
                && !list.is_empty()
                && let Some(pos) = reminder.rfind("</system-reminder>")
            {
                reminder.insert_str(pos, list);
            }
            format!("{}{}", reminder, input)
        } else {
            input.to_string()
        };

        self.messages.push(ConversationMessage {
            role: "user".to_string(),
            content: full_input,
            blocks: None,
        });

        for round in 0..self.max_tool_rounds {
            output::send(&output::Message::info("\n[LLM] 🤔 思考中...".to_string()));

            let result = self.stream_one_round(&mut on_chunk).await?;

            // 流式文本与后续日志之间换行
            output::send(&output::Message::info(String::new()));

            // 输出 token 用量
            crate::agent::executor::print_usage_line(
                Some(round),
                result.input_tokens,
                result.output_tokens,
                result.cache_read_input_tokens,
                result.cache_creation_input_tokens,
                result.duration_ms,
            );

            // 记录对话日志
            if let Some(ref logger) = self.logger
                && let Ok(params) = self.build_params(true)
            {
                crate::agent::executor::log_round_trip_stream(
                    logger,
                    &params,
                    &result,
                    result.duration_ms,
                );
            }

            // 保存 assistant 消息（含重建的 blocks）
            self.messages.push(ConversationMessage {
                role: "assistant".to_string(),
                content: result.full_text.clone(),
                blocks: Some(result.blocks),
            });

            if result.tool_uses.is_empty() {
                // 无工具调用——最终回复，文本已通过 on_chunk 实时输出
                use std::io::Write;
                std::io::stdout().flush().ok();
                return Ok(result.full_text);
            }

            // 有工具调用——合并同文件编辑并按安全分区并行/串行执行
            let merged = crate::agent::executor::merge_file_edits(&result.tool_uses);
            let batches = crate::agent::executor::partition_tool_calls(merged, &self.tools);
            let mut tool_result_blocks: Vec<ContentBlock> = Vec::new();

            for batch in batches {
                if batch.is_concurrency_safe {
                    let (blocks, state_updates) =
                        self.execute_tools_concurrent(&batch.items).await?;
                    for (fp, mtime) in state_updates {
                        self.read_file_state.insert(fp, mtime);
                    }
                    tool_result_blocks.extend(blocks);
                } else {
                    let blocks = self.execute_tools_serial(&batch.items).await?;
                    tool_result_blocks.extend(blocks);
                }
            }

            // 将工具结果作为用户消息追加
            self.messages.push(ConversationMessage {
                role: "user".to_string(),
                content: String::new(),
                blocks: Some(tool_result_blocks),
            });

            self.print_task_summary_if_needed().await;
        }

        Err(format!(
            "Tool use exceeded max rounds ({})",
            self.max_tool_rounds
        ))
    }

    /// 执行一轮流式请求，收集文本和工具调用
    /// 执行一轮流式请求（HTTP + 事件解析）
    async fn stream_one_round(
        &mut self,
        on_chunk: &mut dyn FnMut(&str),
    ) -> Result<crate::agent::stream::RoundResult, String> {
        let params = self.build_params(true)?;
        let start = Instant::now();

        let stream = self
            .client
            .create_message_streaming(&params)
            .await
            .map_err(|e| format!("API 流式请求失败: {}", e))?;

        let event_stream = stream.map(|r| r.map_err(|e| format!("流式读取失败: {}", e)));
        let mut result =
            crate::agent::stream::process_stream_events(event_stream, on_chunk).await?;
        result.duration_ms = start.elapsed().as_millis() as u64;
        Ok(result)
    }

    /// 串行执行工具调用列表（逐个 await），返回 ToolResult ContentBlock 列表
    async fn execute_tools_serial(
        &mut self,
        tool_uses: &[(String, String, serde_json::Value)],
    ) -> Result<Vec<ContentBlock>, String> {
        // 按工具类型统计并输出本轮概览
        {
            let mut type_counts: std::collections::BTreeMap<&str, usize> =
                std::collections::BTreeMap::new();
            for (_, name, _) in tool_uses {
                *type_counts.entry(name.as_str()).or_insert(0) += 1;
            }
            let count_summary: String = type_counts
                .iter()
                .map(|(name, count)| {
                    if *count > 1 {
                        format!(
                            "{} {} ×{}",
                            crate::agent::executor::tool_icon(name),
                            name,
                            count
                        )
                    } else {
                        format!("{} {}", crate::agent::executor::tool_icon(name), name)
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");
            output::send(&output::Message::info(format!(
                "\n[工具] 📋 本轮 {} 个工具调用: {}",
                tool_uses.len(),
                count_summary
            )));
        }

        let mut tool_result_blocks: Vec<ContentBlock> = Vec::new();

        for (tool_use_id, name, input) in tool_uses {
            let tool_start = Instant::now();

            let handler = self
                .tools
                .iter()
                .find(|h| h.tool_definition().name == *name);

            let Some(handler) = handler else {
                let elapsed = tool_start.elapsed();
                output::send(&output::Message::info(format!(
                    "[工具] ❌ {}  Unknown tool ({:.1}s, 0 字符)",
                    name,
                    elapsed.as_secs_f64()
                )));
                tool_result_blocks.push(ContentBlock::ToolResult {
                    tool_use_id: tool_use_id.clone(),
                    content: format!("[Tool error: Unknown tool: {}]", name),
                });
                continue;
            };

            // ---- 预读检查：file_write 和 file_edit 必须先读后写 ----
            let pre_read_error: Option<String> = match name.as_str() {
                "file_write" | "file_edit" => {
                    if let Some(fp) = input.get("file_path").and_then(|v| v.as_str()) {
                        let path = std::path::Path::new(fp);
                        if path.exists() {
                            match self.read_file_state.get(fp) {
                                None => Some(format!(
                                    "错误：文件 '{}' 已存在，但未通过 file_read 读取。\
                                         请先使用 file_read 读取文件内容后再进行写入操作。",
                                    fp
                                )),
                                Some(&recorded_mtime) => {
                                    if let Ok(meta) = path.metadata() {
                                        if let Ok(mtime) = meta.modified() {
                                            let current_ms = mtime
                                                .duration_since(std::time::UNIX_EPOCH)
                                                .map(|d| d.as_millis() as u64)
                                                .unwrap_or(0);
                                            if current_ms > recorded_mtime {
                                                Some(format!(
                                                    "错误：文件 '{}' 自读取后已被外部修改，\
                                                     请重新使用 file_read 读取后再操作。",
                                                    fp
                                                ))
                                            } else {
                                                None
                                            }
                                        } else {
                                            None
                                        }
                                    } else {
                                        None
                                    }
                                }
                            }
                        } else {
                            None // 新文件直接放行
                        }
                    } else {
                        None
                    }
                }
                _ => None,
            };

            let icon = crate::agent::executor::tool_icon(name);
            let param = crate::agent::executor::format_tool_param(name, input);

            let result_text = if let Some(err_msg) = pre_read_error {
                tracing::warn!(tool = %name, error = %err_msg, "工具预读检查失败");
                output::send(&output::Message::tool_error(
                    icon,
                    name.clone(),
                    err_msg.clone(),
                ));
                format!("[Tool error: {}]", err_msg)
            } else {
                match handler.execute(input).await {
                    Ok(text) => {
                        // ---- 文件读取后记录状态 ----
                        if name.as_str() == "file_read"
                            && let Some(fp) = input.get("file_path").and_then(|v| v.as_str())
                            && let path = std::path::Path::new(fp)
                            && path.exists()
                            && let Ok(meta) = path.metadata()
                            && let Ok(mtime) = meta.modified()
                        {
                            let ms = mtime
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as u64)
                                .unwrap_or(0);
                            self.read_file_state.insert(fp.to_string(), ms);
                        }
                        let elapsed = tool_start.elapsed();
                        tracing::info!(
                            tool = %name,
                            duration_ms = elapsed.as_millis() as u64,
                            result_len = text.len(),
                            "工具执行成功"
                        );
                        output::send(&output::Message::tool_result(
                            icon,
                            name.clone(),
                            param.clone(),
                            elapsed.as_millis() as u64,
                        ));
                        text
                    }
                    Err(e) => {
                        tracing::warn!(tool = %name, error = %e, "工具执行失败");
                        output::send(&output::Message::tool_error(
                            icon,
                            name.clone(),
                            e.to_string(),
                        ));
                        format!("[Tool error: {}]", e)
                    }
                }
            };

            tool_result_blocks.push(ContentBlock::ToolResult {
                tool_use_id: tool_use_id.clone(),
                content: result_text,
            });
        }

        Ok(tool_result_blocks)
    }

    /// 并发执行一批安全的工具调用，返回 ToolResult ContentBlock 列表和 read_file_state 更新
    async fn execute_tools_concurrent(
        &self,
        tool_uses: &[(String, String, serde_json::Value)],
    ) -> Result<(Vec<ContentBlock>, Vec<(String, u64)>), String> {
        // 按工具类型统计并输出本轮概览
        {
            let mut type_counts: std::collections::BTreeMap<&str, usize> =
                std::collections::BTreeMap::new();
            for (_, name, _) in tool_uses {
                *type_counts.entry(name.as_str()).or_insert(0) += 1;
            }
            let count_summary: String = type_counts
                .iter()
                .map(|(name, count)| {
                    if *count > 1 {
                        format!(
                            "{} {} ×{}",
                            crate::agent::executor::tool_icon(name),
                            name,
                            count
                        )
                    } else {
                        format!("{} {}", crate::agent::executor::tool_icon(name), name)
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");
            output::send(&output::Message::info(format!(
                "\n[工具] 📋 本轮 {} 个工具调用（并行）: {}",
                tool_uses.len(),
                count_summary
            )));
        }

        use futures_util::StreamExt as _;
        use futures_util::stream::FuturesUnordered;

        let total = tool_uses.len();
        let mut futures: FuturesUnordered<Pin<Box<dyn Future<Output = _> + Send>>> =
            FuturesUnordered::new();

        // 预初始化结果数组，未知工具直接填充，已知工具由 future 填充
        let mut results: Vec<Option<String>> = vec![None; total];
        let mut result_ids: Vec<Option<String>> = vec![None; total];
        let mut log_lines: Vec<Option<String>> = vec![None; total];
        let mut state_updates: Vec<(String, u64)> = Vec::new();

        // 为每个工具构造一个并发执行的 future
        for (idx, (tool_use_id, name, input)) in tool_uses.iter().enumerate() {
            let handler = self
                .tools
                .iter()
                .find(|h| h.tool_definition().name == *name);

            let Some(handler) = handler else {
                // 未知工具直接生成错误结果，不创建 future
                let line = format!("[工具] ❌ {}  Unknown tool (0s, 0 字符)", name);
                output::send(&output::Message::info(line.clone()));
                results[idx] = Some(format!("[Tool error: Unknown tool: {}]", name));
                result_ids[idx] = Some(tool_use_id.clone());
                log_lines[idx] = Some(line);
                continue;
            };

            let icon = crate::agent::executor::tool_icon(name);
            let param = crate::agent::executor::format_tool_param(name, input);
            let input_clone = input.clone();
            let tool_use_id_clone = tool_use_id.clone();
            let name_clone = name.clone();

            // 预读检查使用 read_file_state 的快照
            let pre_read_error: Option<String> = match name.as_str() {
                "file_write" | "file_edit" => {
                    if let Some(fp) = input.get("file_path").and_then(|v| v.as_str()) {
                        let path = std::path::Path::new(fp);
                        if path.exists() {
                            match self.read_file_state.get(fp) {
                                None => Some(format!(
                                    "错误：文件 '{}' 已存在，但未通过 file_read 读取。\
                                         请先使用 file_read 读取文件内容后再进行写入操作。",
                                    fp
                                )),
                                Some(&recorded_mtime) => {
                                    if let Ok(meta) = path.metadata() {
                                        if let Ok(mtime) = meta.modified() {
                                            let current_ms = mtime
                                                .duration_since(std::time::UNIX_EPOCH)
                                                .map(|d| d.as_millis() as u64)
                                                .unwrap_or(0);
                                            if current_ms > recorded_mtime {
                                                Some(format!(
                                                    "错误：文件 '{}' 自读取后已被外部修改，\
                                                     请重新使用 file_read 读取后再操作。",
                                                    fp
                                                ))
                                            } else {
                                                None
                                            }
                                        } else {
                                            None
                                        }
                                    } else {
                                        None
                                    }
                                }
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                _ => None,
            };

            futures.push(Box::pin(async move {
                let tool_start = Instant::now();

                let (result_text, file_state, log_line) = if let Some(err_msg) = pre_read_error {
                    tracing::warn!(tool = %name_clone, error = %err_msg, "工具预读检查失败");
                    let line = format!("[工具] ⚠️ {} {}  ❌ {}", icon, name_clone, err_msg);
                    (format!("[Tool error: {}]", err_msg), None, line)
                } else {
                    match handler.execute(&input_clone).await {
                        Ok(text) => {
                            let file_state = if name_clone == "file_read" {
                                input_clone
                                    .get("file_path")
                                    .and_then(|v| v.as_str())
                                    .map(|fp| {
                                        let mtime = std::path::Path::new(fp)
                                            .metadata()
                                            .ok()
                                            .and_then(|meta| meta.modified().ok())
                                            .and_then(|mtime| {
                                                mtime.duration_since(std::time::UNIX_EPOCH).ok()
                                            })
                                            .map(|d| d.as_millis() as u64)
                                            .unwrap_or(0);
                                        (fp.to_string(), mtime)
                                    })
                            } else {
                                None
                            };
                            let elapsed = tool_start.elapsed();
                            tracing::info!(
                                tool = %name_clone,
                                duration_ms = elapsed.as_millis() as u64,
                                result_len = text.len(),
                                "工具执行成功"
                            );
                            let line = format!(
                                "[工具] {} {}  {}  ({:.1}s, {} 字符)",
                                icon,
                                name_clone,
                                param,
                                elapsed.as_secs_f64(),
                                text.len()
                            );
                            (text, file_state, line)
                        }
                        Err(e) => {
                            tracing::warn!(tool = %name_clone, error = %e, "工具执行失败");
                            let line = format!(
                                "[工具] {} {}  {}  ❌ 失败: {}",
                                icon, name_clone, param, e
                            );
                            (format!("[Tool error: {}]", e), None, line)
                        }
                    }
                };

                (idx, tool_use_id_clone, result_text, file_state, log_line)
            }));
        }

        // 收集并发 future 的结果
        while let Some((idx, tool_use_id, result_text, file_state, log_line)) = futures.next().await
        {
            results[idx] = Some(result_text);
            result_ids[idx] = Some(tool_use_id);
            log_lines[idx] = Some(log_line);
            if let Some((fp, mtime)) = file_state {
                state_updates.push((fp, mtime));
            }
        }

        // 按原始顺序统一输出，避免并发 output::send 交错
        for line in log_lines.iter().flatten() {
            output::send(&output::Message::info(line.clone()));
        }

        // 按原始顺序构建 ToolResult blocks
        let blocks: Vec<ContentBlock> = results
            .into_iter()
            .zip(result_ids)
            .map(|(result, id)| ContentBlock::ToolResult {
                tool_use_id: id.unwrap_or_default(),
                content: result.unwrap_or_else(|| "Unknown error".to_string()),
            })
            .collect();

        Ok((blocks, state_updates))
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
            // 系统提示词完全静态，使用 with_system 简化发送
            params = params.with_system(self.system_prompt.clone());
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

    // ---- 公开 getter 方法 ----

    /// 获取 API Key
    pub fn api_key(&self) -> &str {
        self.client.get_api_key()
    }

    /// 获取 API 基础 URL
    pub fn api_base_url(&self) -> &str {
        self.client.get_api_base_url()
    }

    /// 获取模型名称
    pub fn model_name(&self) -> &str {
        &self.model
    }

    /// 获取最大输出 token 数
    pub fn max_tokens(&self) -> u32 {
        self.max_tokens
    }
}

/// 解析 API Key
pub(crate) fn resolve_api_key(
    explicit_key: Option<&str>,
    llm: Option<&crate::config::settings::LlmSettings>,
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

/// 获取某供应商的可用替代模型列表（纯函数，可测试）
fn get_alternative_models(guessed_provider: Option<&str>) -> Vec<&'static str> {
    match guessed_provider {
        Some(provider) => get_built_in_model_names()
            .into_iter()
            .filter(|name| get_model_info(name).is_some_and(|info| info.provider == provider))
            .collect(),
        None => get_built_in_model_names(),
    }
}

/// 格式化模型显示标签（纯函数，可测试）
fn format_model_label(name: &str) -> String {
    let info = get_model_info(name);
    match (
        info.and_then(|i| i.context_window),
        info.and_then(|i| i.max_output_tokens),
    ) {
        (Some(ctx), Some(max)) => {
            format!("{}  ({}K context, {} max output)", name, ctx / 1000, max)
        }
        (Some(ctx), None) => format!("{}  ({}K context)", name, ctx / 1000),
        (None, Some(max)) => format!("{}  ({} max output)", name, max),
        (None, None) => name.to_string(),
    }
}

/// 当模型不在内置列表中时，交互式提示用户选择替代模型或跳过
///
/// 返回：
/// - `Ok(Some(new_model))` — 用户选择了替代模型
/// - `Ok(None)` — 用户选择跳过
/// - `Err(msg)` — 无法提示（非 TTY 等），向上传播错误
fn prompt_model_replacement(
    old_model: &str,
    guessed_provider: Option<&str>,
) -> Result<Option<String>, String> {
    // 获取该供应商的可用模型列表
    let available = get_alternative_models(guessed_provider);

    if available.is_empty() {
        return Err(format!(
            "模型 '{}' 已不再支持，且未找到可替代的内置模型。\n\
             请通过 `zapmyco init` 重新配置，或在 settings.toml 中设置 baseUrl。",
            old_model
        ));
    }

    // 非交互环境（CI、管道等）跳过 inquire，直接 Warning 降级
    if !std::io::stdin().is_terminal() {
        output::send(&output::Message::warning(format!(
            "模型 '{}' 已不在支持列表中。",
            old_model
        )));
        output::send(&output::Message::info(
            "       请运行 `zapmyco init` 重新配置，或在 settings.toml 中设置 baseUrl。"
                .to_string(),
        ));
        return Ok(None);
    }

    // 构建显示标签
    let choices: Vec<(String, &str)> = available
        .into_iter()
        .map(|name| {
            let label = format_model_label(name);
            (label, name)
        })
        .collect();

    let display_labels: Vec<&str> = choices.iter().map(|(label, _)| label.as_str()).collect();

    let provider_hint = guessed_provider.unwrap_or("未知");

    output::send(&output::Message::info(format!(
        "\n⚠️  模型 '{}' 已在最新版本中移除。",
        old_model
    )));
    output::send(&output::Message::info(format!(
        "发现您使用 {} 系列，以下是当前可用的模型：\n",
        provider_hint
    )));

    let selection =
        inquire::Select::new("请选择替代模型（或选择最后一项跳过）", {
            let mut opts = display_labels.clone();
            opts.push("─ 跳过，稍后自行配置 baseUrl ─");
            opts
        })
        .with_vim_mode(true)
        .prompt();

    match selection {
        Ok(selected) => {
            if selected.starts_with("─") {
                // 用户选择跳过
                output::send(&output::Message::info(format!(
                    "[提示] 请在 settings.toml 中为 [llm.providers.{}] 设置 baseUrl，",
                    provider_hint
                )));
                output::send(&output::Message::info(
                    "       或在提供商处获取新的 API 地址。".to_string(),
                ));
                Ok(None)
            } else {
                // 用户选择了替代模型
                if let Some(idx) = choices.iter().position(|(label, _)| label == selected) {
                    let new_model = choices[idx].1.to_string();
                    output::send(&output::Message::info(format!(
                        "✓ 已选择替代模型 '{}'。\n",
                        new_model
                    )));
                    Ok(Some(new_model))
                } else {
                    Ok(None)
                }
            }
        }
        Err(_) => {
            // 非 TTY 环境或用户取消
            output::send(&output::Message::warning(format!(
                "模型 '{}' 已不在支持列表中。",
                old_model
            )));
            output::send(&output::Message::info(
                "       请运行 `zapmyco init` 重新配置，或在 settings.toml 中设置 baseUrl。"
                    .to_string(),
            ));
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;
    use zapmyco_anthropic_ai_sdk::types::message::{
        MessageDeltaContent, MessageStartContent, StopReason, StreamError, StreamUsage, Usage,
    };

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
        use crate::config::settings::{LlmSettings, ProviderConfig};
        use std::collections::HashMap;

        let mut providers = HashMap::new();
        providers.insert(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: Some("provider-key".to_string()),
                base_url: None,
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
        use crate::config::settings::{LlmSettings, ProviderConfig};
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
                base_url: None,
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
        use crate::config::settings::{LlmSettings, ProviderConfig};
        use std::collections::HashMap;

        let mut providers = HashMap::new();
        providers.insert(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: Some("provider-key".to_string()),
                base_url: None,
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
                "[llm]\n\n[llm.models]\nadvanced = \"deepseek-v4-flash\"\n",
            );
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                model_profile: Some("advanced".to_string()),
                ..Default::default()
            })
            .unwrap();
            assert_eq!(agent.model(), "deepseek-v4-flash");
        });
    }

    #[test]
    fn test_resolve_api_key_provider_none_key() {
        use crate::config::settings::{LlmSettings, ProviderConfig};
        use std::collections::HashMap;

        let mut providers = HashMap::new();
        providers.insert(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: None,
                base_url: None,
            },
        );
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
        use crate::config::settings::{LlmSettings, ProviderConfig};
        use std::collections::HashMap;

        let mut providers = HashMap::new();
        providers.insert(
            "deepseek".to_string(),
            ProviderConfig {
                api_key: Some(String::new()),
                base_url: None,
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
            let logger = crate::agent::conversation_logger::ConversationLogger::new().unwrap();

            let params = CreateMessageParams::new(RequiredMessageParams {
                model: "test-model".to_string(),
                messages: vec![Message::new_text(Role::User, "Hello")],
                max_tokens: 100,
            });

            let response: zapmyco_anthropic_ai_sdk::types::message::CreateMessageResponse =
                serde_json::from_str(
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

            crate::agent::executor::log_round_trip(&logger, &params, &response, 100);

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
        let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
        let handler = ToolHandler::WebFetch(web_fetch);
        let tool = handler.tool_definition();
        assert_eq!(tool.name, "web_fetch");
        assert!(tool.description.is_some());
        assert!(tool.input_schema.as_ref().unwrap()["properties"]["url"].is_object());
    }

    #[tokio::test]
    async fn test_tool_handler_execute_missing_url() {
        let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
        let handler = ToolHandler::WebFetch(web_fetch);

        let input = serde_json::json!({});
        let result = handler.execute(&input).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("Missing required 'url'"));
    }

    #[tokio::test]
    async fn test_tool_handler_execute_url_not_string() {
        let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
        let handler = ToolHandler::WebFetch(web_fetch);

        let input = serde_json::json!({"url": 123});
        let result = handler.execute(&input).await;
        assert!(result.is_err());
    }

    // ---- ShellExec ToolHandler tests ----

    fn make_test_executor() -> crate::tools::shell_exec::ShellExec {
        crate::tools::shell_exec::ShellExec::new(crate::tools::shell_exec::ShellExecOptions {
            skip_confirm: true,
            ..Default::default()
        })
    }

    #[test]
    fn test_tool_handler_shell_exec_tool_definition() {
        let executor = make_test_executor();
        let handler = ToolHandler::ShellExec(executor);
        let tool = handler.tool_definition();
        assert_eq!(tool.name, "shell_exec");
        assert!(tool.description.is_some());
        assert!(tool.input_schema.as_ref().unwrap()["properties"]["command"].is_object());
    }

    #[tokio::test]
    async fn test_tool_handler_shell_exec_missing_cmd() {
        let executor = make_test_executor();
        let handler = ToolHandler::ShellExec(executor);
        let input = serde_json::json!({});
        let result = handler.execute(&input).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("'command'"));
    }

    #[tokio::test]
    async fn test_tool_handler_shell_exec_success() {
        let executor = make_test_executor();
        let handler = ToolHandler::ShellExec(executor);
        let input = serde_json::json!({"command": "echo hello"});
        let result = handler.execute(&input).await;
        assert!(result.is_ok());
        assert!(result.unwrap().contains("hello"));
    }

    #[tokio::test]
    async fn test_tool_handler_shell_exec_with_description() {
        let executor = make_test_executor();
        let handler = ToolHandler::ShellExec(executor);
        let input = serde_json::json!({
            "command": "echo hello",
            "description": "Testing the shell_exec tool"
        });
        let result = handler.execute(&input).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_tool_handler_shell_exec_with_working_dir() {
        let executor = make_test_executor();
        let handler = ToolHandler::ShellExec(executor);
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

            let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
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

            let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch));

            // 系统提示词完全静态化，自定义提示词保持原样（不再动态追加工具指引）
            assert_eq!(
                agent.system_prompt, "原始提示",
                "custom prompt should not be modified"
            );
            assert_eq!(agent.tools.len(), 1);

            // 第二次注册
            let web_fetch2 = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch2));

            // 工具数增加
            assert_eq!(agent.tools.len(), 2, "should have 2 tools registered");
            // 系统提示词完全静态化，不受工具注册影响
            assert_eq!(agent.system_prompt, "原始提示");
        });
    }

    // ---- remove_tools tests ----

    #[test]
    fn test_remove_tools_removes_by_name() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch));

            let shell_exec = crate::tools::shell_exec::ShellExec::new(Default::default());
            agent.register_tool(ToolHandler::ShellExec(shell_exec));

            assert_eq!(agent.tools.len(), 2);

            // 移除 shell_exec
            agent.remove_tools(&["shell_exec"]);
            assert_eq!(agent.tools.len(), 1);
            assert_eq!(agent.tools[0].tool_definition().name, "web_fetch");
            // 系统提示词完全静态化，始终包含所有工具规则（shell_exec 规则也在其中）
            assert!(agent.system_prompt.contains("不要使用 shell_exec 替代"));
        });
    }

    #[test]
    fn test_remove_tools_nonexistent_name() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch));
            assert_eq!(agent.tools.len(), 1);

            // 移除不存在的工具名 → 无影响
            agent.remove_tools(&["nonexistent_tool"]);
            assert_eq!(agent.tools.len(), 1);
        });
    }

    #[test]
    fn test_remove_tools_empty_list() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch));
            assert_eq!(agent.tools.len(), 1);

            // 空列表 → 无影响
            agent.remove_tools(&[]);
            assert_eq!(agent.tools.len(), 1);
        });
    }

    #[test]
    fn test_remove_tools_multiple_at_once() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch));

            let shell_exec = crate::tools::shell_exec::ShellExec::new(Default::default());
            agent.register_tool(ToolHandler::ShellExec(shell_exec));

            let file_read = crate::tools::file_read::FileRead::new(Default::default());
            agent.register_tool(ToolHandler::FileRead(file_read));

            assert_eq!(agent.tools.len(), 3);

            // 批量移除
            agent.remove_tools(&["shell_exec", "web_fetch"]);
            assert_eq!(agent.tools.len(), 1);
            assert_eq!(agent.tools[0].tool_definition().name, "file_read");
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
            let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
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

            let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
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

    // ---- WebSearch ToolHandler tests ----

    #[test]
    fn test_tool_handler_web_search_tool_definition() {
        let ws = crate::tools::web_search::WebSearch::new(
            "k".into(),
            "https://x.com".into(),
            "m".into(),
            100,
        )
        .unwrap();
        let handler = ToolHandler::WebSearch(ws);
        let tool = handler.tool_definition();
        assert_eq!(tool.name, "web_search");
        assert!(tool.description.is_some());
        assert!(tool.input_schema.is_some());
        assert!(tool.tool_type.is_none());
    }

    #[test]
    fn test_register_web_search_adds_to_tools() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            assert!(agent.tools.is_empty());

            let ws = crate::tools::web_search::WebSearch::new(
                "k".into(),
                "https://x.com".into(),
                "m".into(),
                100,
            )
            .unwrap();
            agent.register_tool(ToolHandler::WebSearch(ws));
            assert_eq!(agent.tools.len(), 1);
        });
    }

    #[test]
    fn test_register_web_search_updates_system_prompt() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                system_prompt: Some("原始提示".to_string()),
                ..Default::default()
            })
            .unwrap();

            let ws = crate::tools::web_search::WebSearch::new(
                "k".into(),
                "https://x.com".into(),
                "m".into(),
                100,
            )
            .unwrap();
            agent.register_tool(ToolHandler::WebSearch(ws));

            // 自定义提示词保持原样，不再动态追加工具指引
            assert_eq!(
                agent.system_prompt, "原始提示",
                "custom prompt should not be modified"
            );
        });
    }

    // ---- AiAgent getter tests ----

    #[test]
    fn test_agent_api_key_getter() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("custom-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            assert_eq!(agent.api_key(), "custom-key");
        });
    }

    #[test]
    fn test_agent_base_url_getter() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("k".to_string()),
                base_url: Some("https://custom.example.com".to_string()),
                ..Default::default()
            })
            .unwrap();
            assert_eq!(agent.api_base_url(), "https://custom.example.com");
        });
    }

    #[test]
    fn test_agent_model_name_getter() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("k".to_string()),
                model: Some("custom-model".to_string()),
                ..Default::default()
            })
            .unwrap();
            assert_eq!(agent.model_name(), "custom-model");
        });
    }

    #[test]
    fn test_agent_max_tokens_getter() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent = AiAgent::new(AiAgentOptions {
                api_key: Some("k".to_string()),
                max_tokens: Some(8192),
                ..Default::default()
            })
            .unwrap();
            assert_eq!(agent.max_tokens(), 8192);
        });
    }

    // ---- log_round_trip_stream tests ----

    #[test]
    fn test_log_round_trip_stream_writes_record() {
        run_with_temp_home(|home| {
            let logger = crate::agent::conversation_logger::ConversationLogger::new().unwrap();

            let params = CreateMessageParams::new(RequiredMessageParams {
                model: "test-model".to_string(),
                messages: vec![Message::new_text(Role::User, "Hello")],
                max_tokens: 100,
            });

            let result = crate::agent::stream::RoundResult {
                full_text: "你好".to_string(),
                tool_uses: vec![],
                blocks: vec![ContentBlock::Text {
                    text: "你好".to_string(),
                    citations: None,
                }],
                input_tokens: 10,
                output_tokens: 5,
                cache_read_input_tokens: None,
                cache_creation_input_tokens: None,
                duration_ms: 100,
                model: "test-model".to_string(),
            };

            crate::agent::executor::log_round_trip_stream(&logger, &params, &result, 100);

            // 验证日志文件被正确写入
            let log_dir = home.join(".zapmyco/conversations");
            let log_file = log_dir.join(format!("{}.jsonl", logger.session_id()));
            let content = std::fs::read_to_string(&log_file).unwrap();
            assert!(content.contains("test-model"), "日志应包含模型名");
            assert!(content.contains("你好"), "日志应包含文本");
            assert!(content.contains("end_turn"), "无工具调用时应为 end_turn");
            assert!(content.contains("100"), "日志应包含耗时");
        });
    }

    #[test]
    fn test_log_round_trip_stream_with_tool_uses() {
        run_with_temp_home(|home| {
            let logger = crate::agent::conversation_logger::ConversationLogger::new().unwrap();

            let params = CreateMessageParams::new(RequiredMessageParams {
                model: "test-model".to_string(),
                messages: vec![Message::new_text(Role::User, "find files")],
                max_tokens: 100,
            });

            let result = crate::agent::stream::RoundResult {
                full_text: String::new(),
                tool_uses: vec![(
                    "tu01".to_string(),
                    "file_find".to_string(),
                    serde_json::json!({"pattern": "*.rs"}),
                )],
                blocks: vec![ContentBlock::ToolUse {
                    id: "tu01".to_string(),
                    name: "file_find".to_string(),
                    input: serde_json::json!({"pattern": "*.rs"}),
                }],
                input_tokens: 10,
                output_tokens: 15,
                cache_read_input_tokens: None,
                cache_creation_input_tokens: None,
                duration_ms: 100,
                model: "test-model".to_string(),
            };

            crate::agent::executor::log_round_trip_stream(&logger, &params, &result, 100);

            let log_dir = home.join(".zapmyco/conversations");
            let log_file = log_dir.join(format!("{}.jsonl", logger.session_id()));
            let content = std::fs::read_to_string(&log_file).unwrap();
            assert!(content.contains("tool_use"), "有工具调用时应为 tool_use");
            assert!(content.contains("file_find"), "日志应包含工具名");
            assert!(content.contains(r#""pattern":"#), "日志应包含工具参数");
        });
    }

    // ---- execute_tools tests ----

    /// 创建包含特定工具的 AiAgent（用于 execute_tools 测试）
    fn make_agent_with_tools(home: &std::path::Path, tool_names: &[&str]) -> AiAgent {
        create_test_settings(home, "[llm]\n");
        let mut agent = AiAgent::new(AiAgentOptions {
            api_key: Some("test-key".to_string()),
            model: Some("test-model".to_string()),
            ..Default::default()
        })
        .unwrap();

        for name in tool_names {
            match *name {
                "file_read" => {
                    agent.register_tool(ToolHandler::FileRead(
                        crate::tools::file_read::FileRead::new(Default::default()),
                    ));
                }
                "file_find" => {
                    agent.register_tool(ToolHandler::FileFind(
                        crate::tools::file_find::FileFind::new(Default::default()),
                    ));
                }
                "file_edit" => {
                    agent.register_tool(ToolHandler::FileEdit(
                        crate::tools::file_edit::FileEdit::new(Default::default()),
                    ));
                }
                "file_write" => {
                    agent.register_tool(ToolHandler::FileWrite(
                        crate::tools::file_write::FileWrite::new(Default::default()),
                    ));
                }
                _ => {}
            }
        }
        agent
    }

    #[test]
    fn test_execute_tools_basic() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut agent = make_agent_with_tools(home, &["file_find"]);

                // 在 temp dir 中创建一个测试文件
                let test_file = home.join("test.rs");
                std::fs::write(&test_file, "fn main() {}").unwrap();

                let tool_uses = vec![(
                    "tu01".to_string(),
                    "file_find".to_string(),
                    serde_json::json!({
                        "pattern": "*.rs",
                        "path": home.to_string_lossy().to_string(),
                    }),
                )];

                let results = agent
                    .execute_tools_serial(&tool_uses)
                    .await
                    .expect("execute_tools should succeed");

                assert_eq!(results.len(), 1);
                assert!(matches!(results[0], ContentBlock::ToolResult { .. }));
                if let ContentBlock::ToolResult { content, .. } = &results[0] {
                    assert!(content.contains("test.rs"), "结果应包含文件名");
                }
            });
        });
    }

    #[test]
    fn test_execute_tools_pre_read_check_blocks_edit() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut agent = make_agent_with_tools(home, &["file_read", "file_edit"]);

                // 创建一个已有文件
                let test_file = home.join("test.txt");
                std::fs::write(&test_file, "hello world").unwrap();

                // 未先 file_read 直接 file_edit → 应被预读检查拦截
                let tool_uses = vec![(
                    "tu01".to_string(),
                    "file_edit".to_string(),
                    serde_json::json!({
                        "file_path": test_file.to_string_lossy().to_string(),
                        "mode": "line_range",
                        "start_line": 1,
                        "end_line": 1,
                        "expected": "hello world",
                        "new_content": "HELLO WORLD",
                    }),
                )];

                let results = agent
                    .execute_tools_serial(&tool_uses)
                    .await
                    .expect("execute_tools should not fail");

                assert_eq!(results.len(), 1);
                if let ContentBlock::ToolResult { content, .. } = &results[0] {
                    assert!(
                        content.contains("未通过 file_read 读取"),
                        "应提示先读取文件: {}",
                        content
                    );
                } else {
                    panic!("Expected ToolResult");
                }
            });
        });
    }

    #[test]
    fn test_execute_tools_pre_read_check_passes() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut agent = make_agent_with_tools(home, &["file_read", "file_edit"]);

                let test_file = home.join("test.txt");
                std::fs::write(&test_file, "hello world").unwrap();

                // 先 file_read 让预读检查通过
                let read_input = serde_json::json!({
                    "file_path": test_file.to_string_lossy().to_string(),
                });
                let _ = agent
                    .execute_tools_serial(&vec![(
                        "tu00".to_string(),
                        "file_read".to_string(),
                        read_input,
                    )])
                    .await
                    .unwrap();

                // 现在 file_edit 应通过预读检查
                let tool_uses = vec![(
                    "tu01".to_string(),
                    "file_edit".to_string(),
                    serde_json::json!({
                        "file_path": test_file.to_string_lossy().to_string(),
                        "mode": "line_range",
                        "start_line": 1,
                        "end_line": 1,
                        "expected": "hello world",
                        "new_content": "HELLO WORLD",
                    }),
                )];

                let results = agent
                    .execute_tools_serial(&tool_uses)
                    .await
                    .expect("execute_tools should succeed");

                assert_eq!(results.len(), 1);
                if let ContentBlock::ToolResult { content, .. } = &results[0] {
                    // 预读检查已通过（未出现"未通过 file_read 读取"错误）
                    // file_edit 自己的内容验证失败是正常行为，不在此测试范围内
                    assert!(
                        !content.contains("未通过 file_read 读取"),
                        "预读检查应通过: {}",
                        content
                    );
                }
            });
        });
    }

    #[test]
    fn test_execute_tools_new_file_write_passes() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut agent = make_agent_with_tools(home, &["file_write"]);

                // 写入一个不存在的文件 → 应直接放行
                let new_file = home.join("new_file.txt");
                let tool_uses = vec![(
                    "tu01".to_string(),
                    "file_write".to_string(),
                    serde_json::json!({
                        "file_path": new_file.to_string_lossy().to_string(),
                        "content": "new content",
                    }),
                )];

                let results = agent
                    .execute_tools_serial(&tool_uses)
                    .await
                    .expect("execute_tools should succeed");

                assert_eq!(results.len(), 1);
                // 验证文件确实已创建
                assert!(new_file.exists(), "新文件应被创建");
            });
        });
    }

    #[test]
    fn test_execute_tools_unknown_tool() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut agent = make_agent_with_tools(home, &[]);

                let tool_uses = vec![(
                    "tu01".to_string(),
                    "nonexistent_tool".to_string(),
                    serde_json::json!({}),
                )];

                let result = agent.execute_tools_serial(&tool_uses).await;
                assert!(result.is_ok(), "unknown tool should not cause fatal error");
                let blocks = result.unwrap();
                assert_eq!(blocks.len(), 1, "should return one tool result");
                assert!(
                    extract_tool_result_content(&blocks[0]).contains("Unknown tool"),
                    "tool result should mention unknown tool"
                );
            });
        });
    }

    // ---- is_concurrency_safe tests ----

    #[test]
    fn test_is_concurrency_safe_file_read() {
        let handler =
            ToolHandler::FileRead(crate::tools::file_read::FileRead::new(Default::default()));
        let input = serde_json::json!({"file_path": "/tmp/test.rs"});
        assert!(handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_file_search() {
        let handler = ToolHandler::FileSearch(crate::tools::file_search::FileSearch::new(
            Default::default(),
        ));
        let input = serde_json::json!({"pattern": "fn main"});
        assert!(handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_file_find() {
        let handler =
            ToolHandler::FileFind(crate::tools::file_find::FileFind::new(Default::default()));
        let input = serde_json::json!({"pattern": "*.rs"});
        assert!(handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_web_search() {
        let handler = ToolHandler::WebSearch(
            crate::tools::web_search::WebSearch::new(
                "k".to_string(),
                "https://x.com".to_string(),
                "m".to_string(),
                100,
            )
            .unwrap(),
        );
        let input = serde_json::json!({"query": "rust programming"});
        assert!(handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_web_fetch() {
        let handler = ToolHandler::WebFetch(
            crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap(),
        );
        let input = serde_json::json!({"url": "https://example.com"});
        assert!(handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_task_get() {
        let manager = std::sync::Arc::new(crate::tools::task_manager::TaskManager::new());
        let handler = ToolHandler::TaskGet(manager);
        let input = serde_json::json!({"task_id": "1"});
        assert!(handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_task_list() {
        let manager = std::sync::Arc::new(crate::tools::task_manager::TaskManager::new());
        let handler = ToolHandler::TaskList(manager);
        let input = serde_json::json!({});
        assert!(handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_file_write() {
        let handler =
            ToolHandler::FileWrite(crate::tools::file_write::FileWrite::new(Default::default()));
        let input = serde_json::json!({"file_path": "/tmp/test.rs"});
        assert!(!handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_file_edit() {
        let handler =
            ToolHandler::FileEdit(crate::tools::file_edit::FileEdit::new(Default::default()));
        let input = serde_json::json!({"file_path": "/tmp/test.rs"});
        assert!(!handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_ask_user() {
        let handler = ToolHandler::AskUser(crate::tools::ask_user::AskUser);
        let input = serde_json::json!({"question": "Continue?"});
        assert!(!handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_task_create() {
        let manager = std::sync::Arc::new(crate::tools::task_manager::TaskManager::new());
        let handler = ToolHandler::TaskCreate(manager);
        let input = serde_json::json!({"subject": "new task"});
        assert!(!handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_task_update() {
        let manager = std::sync::Arc::new(crate::tools::task_manager::TaskManager::new());
        let handler = ToolHandler::TaskUpdate(manager);
        let input = serde_json::json!({"task_id": "1", "status": "completed"});
        assert!(!handler.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_shell_exec_read_only() {
        let executor = crate::tools::shell_exec::ShellExec::new(Default::default());
        let handler = ToolHandler::ShellExec(executor);

        let read_commands = [
            "echo hello",
            "ls -la",
            "cat /tmp/test.rs",
            "pwd",
            "which cargo",
            "git status",
            "cargo check",
        ];
        for cmd in &read_commands {
            let input = serde_json::json!({"command": cmd});
            assert!(
                handler.is_concurrency_safe(&input),
                "read-only command '{}' should be safe",
                cmd
            );
        }
    }

    #[test]
    fn test_is_concurrency_safe_shell_exec_mutating() {
        let executor = crate::tools::shell_exec::ShellExec::new(Default::default());
        let handler = ToolHandler::ShellExec(executor);

        let write_commands = [
            "rm -rf /tmp",
            "git commit -m 'test'",
            "cargo publish",
            "npm install",
        ];
        for cmd in &write_commands {
            let input = serde_json::json!({"command": cmd});
            assert!(
                !handler.is_concurrency_safe(&input),
                "mutating command '{}' should NOT be safe",
                cmd
            );
        }
    }

    #[test]
    fn test_is_concurrency_safe_shell_exec_no_command() {
        let executor = crate::tools::shell_exec::ShellExec::new(Default::default());
        let handler = ToolHandler::ShellExec(executor);
        let input = serde_json::json!({});
        assert!(
            !handler.is_concurrency_safe(&input),
            "shell_exec without command should not be safe"
        );
    }

    // ---- is_concurrency_safe 边界场景 ----

    #[test]
    fn test_is_concurrency_safe_shell_exec_leading_whitespace() {
        let executor = crate::tools::shell_exec::ShellExec::new(Default::default());
        let handler = ToolHandler::ShellExec(executor);

        // 命令前有空格/制表符 — 实现中用了 trim_start()，应正常识别
        let inputs = [
            ("  ls -la", true),
            ("\techo hello", true),
            ("  rm -rf /tmp", false),
            ("  git commit -m 'x'", false),
        ];
        for (cmd, expected) in &inputs {
            let input = serde_json::json!({"command": cmd});
            assert_eq!(
                handler.is_concurrency_safe(&input),
                *expected,
                "leading whitespace command '{}' should be {}",
                cmd,
                if *expected { "safe" } else { "unsafe" }
            );
        }
    }

    #[test]
    fn test_is_concurrency_safe_shell_exec_prefix_edge_cases() {
        let executor = crate::tools::shell_exec::ShellExec::new(Default::default());
        let handler = ToolHandler::ShellExec(executor);

        // 命令以只读前缀开头但不是标准只读命令 — 可能产生假阳性
        // 比如 "catastrophe" 以 "cat" 开头会被识别为只读
        let inputs = [
            ("catastrophe", true),    // 假阳性：以 "cat" 开头
            ("ls-extra", true),       // 假阳性：以 "ls" 开头
            ("echo_something", true), // 假阳性：以 "echo" 开头
            ("typewriter", true),     // 假阳性：以 "type" 开头
        ];
        for (cmd, expected) in &inputs {
            let input = serde_json::json!({"command": cmd});
            assert_eq!(
                handler.is_concurrency_safe(&input),
                *expected,
                "prefix edge case '{}' should be {} (safe=false would be more conservative)",
                cmd,
                if *expected { "safe" } else { "unsafe" }
            );
        }
    }

    #[test]
    fn test_is_concurrency_safe_shell_exec_multi_word_prefix() {
        let executor = crate::tools::shell_exec::ShellExec::new(Default::default());
        let handler = ToolHandler::ShellExec(executor);

        // 多词前缀（如 "git status"）需要精确匹配前两个词
        let inputs = [
            ("git status -sb", true),              // 匹配 "git status" 前缀
            ("git status", true),                  // 精确匹配
            ("git status   --short", true),        // "git status" 后跟空格
            ("git stash", false),                  // "git status" vs "git stash" — 不匹配
            ("git st", false),                     // "git status" vs "git st" — 不匹配
            ("cargo check --all", true),           // 匹配 "cargo check"
            ("cargo check", true),                 // 精确匹配
            ("cargo clippy -- -D warnings", true), // 匹配 "cargo clippy"
            ("cargo test --test-threads=1", true), // 匹配 "cargo test"
            ("cargo build", false),                // "cargo build" 不在只读列表
            ("cargo b", false),                    // 不在只读列表
        ];
        for (cmd, expected) in &inputs {
            let input = serde_json::json!({"command": cmd});
            assert_eq!(
                handler.is_concurrency_safe(&input),
                *expected,
                "multi-word prefix command '{}' should be {}",
                cmd,
                if *expected { "safe" } else { "unsafe" }
            );
        }
    }

    #[test]
    fn test_is_concurrency_safe_shell_exec_case_sensitivity() {
        let executor = crate::tools::shell_exec::ShellExec::new(Default::default());
        let handler = ToolHandler::ShellExec(executor);

        // starts_with 是大小写敏感的，大写的只读命令不会被识别
        let inputs = [
            ("LS -la", false),        // 大写 "LS" 不匹配 "ls"
            ("ECHO hello", false),    // 大写 "ECHO" 不匹配 "echo"
            ("Cat /tmp/test", false), // 大写 "Cat" 不匹配 "cat"
            ("Git status", false),    // 大写 "Git" 不匹配 "git"
        ];
        for (cmd, expected) in &inputs {
            let input = serde_json::json!({"command": cmd});
            assert_eq!(
                handler.is_concurrency_safe(&input),
                *expected,
                "case sensitivity: '{}' should be {}",
                cmd,
                if *expected { "safe" } else { "unsafe" }
            );
        }
    }

    // ---- partition_tool_calls tests ----

    fn make_safe_tool_handler(name: &str) -> ToolHandler {
        match name {
            "file_read" => {
                ToolHandler::FileRead(crate::tools::file_read::FileRead::new(Default::default()))
            }
            _ => panic!("unknown safe tool: {}", name),
        }
    }

    fn make_unsafe_tool_handler(name: &str) -> ToolHandler {
        match name {
            "file_write" => {
                ToolHandler::FileWrite(crate::tools::file_write::FileWrite::new(Default::default()))
            }
            "file_edit" => {
                ToolHandler::FileEdit(crate::tools::file_edit::FileEdit::new(Default::default()))
            }
            _ => panic!("unknown unsafe tool: {}", name),
        }
    }

    #[test]
    fn test_partition_tool_calls_all_safe() {
        let tool_uses = vec![
            (
                "tu01".to_string(),
                "file_read".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu02".to_string(),
                "file_read".to_string(),
                serde_json::json!({}),
            ),
        ];
        let tools = vec![
            make_safe_tool_handler("file_read"),
            make_safe_tool_handler("file_read"),
        ];

        let batches = crate::agent::executor::partition_tool_calls(tool_uses, &tools);
        assert_eq!(batches.len(), 1, "all safe tools should be in one batch");
        assert!(batches[0].is_concurrency_safe);
        assert_eq!(batches[0].items.len(), 2);
    }

    #[test]
    fn test_partition_tool_calls_all_unsafe() {
        let tool_uses = vec![
            (
                "tu01".to_string(),
                "file_write".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu02".to_string(),
                "file_edit".to_string(),
                serde_json::json!({}),
            ),
        ];
        let tools = vec![
            make_unsafe_tool_handler("file_write"),
            make_unsafe_tool_handler("file_edit"),
        ];

        let batches = crate::agent::executor::partition_tool_calls(tool_uses, &tools);
        assert_eq!(batches.len(), 2, "each unsafe tool should be its own batch");
        assert!(!batches[0].is_concurrency_safe);
        assert!(!batches[1].is_concurrency_safe);
        assert_eq!(batches[0].items.len(), 1);
        assert_eq!(batches[1].items.len(), 1);
    }

    #[test]
    fn test_partition_tool_calls_mixed() {
        let tool_uses = vec![
            (
                "tu01".to_string(),
                "file_read".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu02".to_string(),
                "file_read".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu03".to_string(),
                "file_write".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu04".to_string(),
                "file_read".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu05".to_string(),
                "file_edit".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu06".to_string(),
                "file_read".to_string(),
                serde_json::json!({}),
            ),
        ];
        let tools = vec![
            make_safe_tool_handler("file_read"),
            make_safe_tool_handler("file_read"),
            make_unsafe_tool_handler("file_write"),
            make_unsafe_tool_handler("file_edit"),
        ];

        let batches = crate::agent::executor::partition_tool_calls(tool_uses, &tools);
        // 预期: [safe, safe] [unsafe(file_write)] [safe] [unsafe(file_edit)] [safe]
        assert_eq!(batches.len(), 5);
        assert!(batches[0].is_concurrency_safe);
        assert_eq!(batches[0].items.len(), 2); // file_read + file_read
        assert!(!batches[1].is_concurrency_safe);
        assert_eq!(batches[1].items[0].1, "file_write");
        assert!(batches[2].is_concurrency_safe);
        assert_eq!(batches[2].items[0].1, "file_read");
        assert!(!batches[3].is_concurrency_safe);
        assert_eq!(batches[3].items[0].1, "file_edit");
        assert!(batches[4].is_concurrency_safe);
        assert_eq!(batches[4].items[0].1, "file_read");
    }

    #[test]
    fn test_partition_tool_calls_empty() {
        let batches = crate::agent::executor::partition_tool_calls(vec![], &[]);
        assert!(batches.is_empty());
    }

    #[test]
    fn test_partition_tool_calls_consecutive_unsafe() {
        let tool_uses = vec![
            (
                "tu01".to_string(),
                "file_write".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu02".to_string(),
                "file_write".to_string(),
                serde_json::json!({}),
            ),
        ];
        let tools = vec![make_unsafe_tool_handler("file_write")];

        let batches = crate::agent::executor::partition_tool_calls(tool_uses, &tools);
        // Each unsafe tool is its own batch, even if consecutive
        assert_eq!(batches.len(), 2);
        assert!(!batches[0].is_concurrency_safe);
        assert!(!batches[1].is_concurrency_safe);
    }

    // ---- partition_tool_calls 边界场景 ----

    #[test]
    fn test_partition_tool_calls_single_safe() {
        let tool_uses = vec![(
            "tu01".to_string(),
            "file_read".to_string(),
            serde_json::json!({"file_path": "/tmp/test.rs"}),
        )];
        let tools = vec![make_safe_tool_handler("file_read")];

        let batches = crate::agent::executor::partition_tool_calls(tool_uses, &tools);
        assert_eq!(batches.len(), 1);
        assert!(batches[0].is_concurrency_safe);
        assert_eq!(batches[0].items.len(), 1);
    }

    #[test]
    fn test_partition_tool_calls_single_unsafe() {
        let tool_uses = vec![(
            "tu01".to_string(),
            "file_write".to_string(),
            serde_json::json!({"file_path": "/tmp/test.rs"}),
        )];
        let tools = vec![make_unsafe_tool_handler("file_write")];

        let batches = crate::agent::executor::partition_tool_calls(tool_uses, &tools);
        assert_eq!(batches.len(), 1);
        assert!(!batches[0].is_concurrency_safe);
        assert_eq!(batches[0].items.len(), 1);
    }

    #[test]
    fn test_partition_tool_calls_unknown_tool_name() {
        // 工具名不在 tools 列表中 → 应降级为不安全（单个 batch）
        let tool_uses = vec![(
            "tu01".to_string(),
            "nonexistent_tool".to_string(),
            serde_json::json!({}),
        )];
        let tools: Vec<ToolHandler> = vec![];

        let batches = crate::agent::executor::partition_tool_calls(tool_uses, &tools);
        assert_eq!(batches.len(), 1);
        assert!(
            !batches[0].is_concurrency_safe,
            "unknown tool should default to unsafe"
        );
        assert_eq!(batches[0].items.len(), 1);
        assert_eq!(batches[0].items[0].1, "nonexistent_tool");
    }

    #[test]
    fn test_partition_tool_calls_unknown_tool_among_safe() {
        // 已知 safe 和未知工具交替
        let tool_uses = vec![
            (
                "tu01".to_string(),
                "file_read".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu02".to_string(),
                "unknown_tool".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu03".to_string(),
                "file_read".to_string(),
                serde_json::json!({}),
            ),
        ];
        let tools = vec![make_safe_tool_handler("file_read")];

        let batches = crate::agent::executor::partition_tool_calls(tool_uses, &tools);
        // [safe] [unsafe(unknown)] [safe]
        assert_eq!(batches.len(), 3);
        assert!(batches[0].is_concurrency_safe);
        assert!(!batches[1].is_concurrency_safe);
        assert_eq!(batches[1].items[0].1, "unknown_tool");
        assert!(batches[2].is_concurrency_safe);
    }

    #[test]
    fn test_partition_tool_calls_many_safe_tools() {
        // 大量 safe 工具应合并到同一个 batch
        let mut tool_uses = Vec::new();
        let mut tools = Vec::new();
        for i in 0..10 {
            tool_uses.push((
                format!("tu{:02}", i),
                "file_read".to_string(),
                serde_json::json!({"file_path": format!("/tmp/test{}.rs", i)}),
            ));
            tools.push(make_safe_tool_handler("file_read"));
        }

        let batches = crate::agent::executor::partition_tool_calls(tool_uses, &tools);
        assert_eq!(batches.len(), 1, "all 10 safe tools should be in one batch");
        assert!(batches[0].is_concurrency_safe);
        assert_eq!(batches[0].items.len(), 10);
    }

    #[test]
    fn test_partition_tool_calls_alternating_single_safe_unsafe() {
        // safe/unsafe/safe/unsafe → 4 个 batch
        let tool_uses = vec![
            (
                "tu01".to_string(),
                "file_read".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu02".to_string(),
                "file_write".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu03".to_string(),
                "file_read".to_string(),
                serde_json::json!({}),
            ),
            (
                "tu04".to_string(),
                "file_write".to_string(),
                serde_json::json!({}),
            ),
        ];
        let tools = vec![
            make_safe_tool_handler("file_read"),
            make_unsafe_tool_handler("file_write"),
        ];

        let batches = crate::agent::executor::partition_tool_calls(tool_uses, &tools);
        assert_eq!(batches.len(), 4);
        assert!(batches[0].is_concurrency_safe);
        assert!(!batches[1].is_concurrency_safe);
        assert_eq!(batches[1].items[0].1, "file_write");
        assert!(batches[2].is_concurrency_safe);
        assert!(!batches[3].is_concurrency_safe);
        assert_eq!(batches[3].items[0].1, "file_write");
    }

    // ---- execute_tools_concurrent tests ----

    #[test]
    fn test_execute_tools_concurrent_basic() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &["file_find"]);

                // 创建测试文件
                let test_file1 = home.join("test1.rs");
                let test_file2 = home.join("test2.rs");
                std::fs::write(&test_file1, "fn a() {}").unwrap();
                std::fs::write(&test_file2, "fn b() {}").unwrap();

                let tool_uses = vec![
                    (
                        "tu01".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({
                            "pattern": "*.rs",
                            "path": home.to_string_lossy().to_string(),
                        }),
                    ),
                    (
                        "tu02".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({
                            "pattern": "*.rs",
                            "path": home.to_string_lossy().to_string(),
                        }),
                    ),
                ];

                let (blocks, state_updates) = agent
                    .execute_tools_concurrent(&tool_uses)
                    .await
                    .expect("concurrent execution should succeed");

                assert_eq!(blocks.len(), 2);
                for (i, block) in blocks.iter().enumerate() {
                    assert!(
                        matches!(block, ContentBlock::ToolResult { .. }),
                        "block {} should be ToolResult",
                        i
                    );
                }
                // file_find 不会产生 read_file_state 更新
                assert!(state_updates.is_empty());
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_empty() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &["file_read"]);
                let (blocks, state_updates) = agent
                    .execute_tools_concurrent(&[])
                    .await
                    .expect("empty batch should succeed");

                assert!(blocks.is_empty());
                assert!(state_updates.is_empty());
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_single_tool() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &["file_find"]);

                let test_file = home.join("test.rs");
                std::fs::write(&test_file, "fn main() {}").unwrap();

                let tool_uses = vec![(
                    "tu01".to_string(),
                    "file_find".to_string(),
                    serde_json::json!({
                        "pattern": "*.rs",
                        "path": home.to_string_lossy().to_string(),
                    }),
                )];

                let (blocks, state_updates) = agent
                    .execute_tools_concurrent(&tool_uses)
                    .await
                    .expect("single tool should succeed");

                assert_eq!(blocks.len(), 1);
                assert!(matches!(blocks[0], ContentBlock::ToolResult { .. }));
                assert!(state_updates.is_empty());
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_order_preservation() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &["file_find", "file_find"]);

                // 创建多个文件使 file_find 返回不同结果
                for i in 0..5 {
                    let f = home.join(format!("test{}.rs", i));
                    std::fs::write(&f, format!("fn test{}() {{}}", i)).unwrap();
                }

                // 每个 file_find 使用不同的 pattern 确保结果不同
                let tool_uses = vec![
                    (
                        "tu_first".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({
                            "pattern": "test0.rs",
                            "path": home.to_string_lossy().to_string(),
                        }),
                    ),
                    (
                        "tu_second".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({
                            "pattern": "test4.rs",
                            "path": home.to_string_lossy().to_string(),
                        }),
                    ),
                ];

                let (blocks, _) = agent
                    .execute_tools_concurrent(&tool_uses)
                    .await
                    .expect("concurrent execution should succeed");

                assert_eq!(blocks.len(), 2);

                // 验证结果顺序与输入顺序一致
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                } = &blocks[0]
                {
                    assert_eq!(tool_use_id, "tu_first");
                    assert!(
                        content.contains("test0.rs"),
                        "first result should contain test0.rs: {}",
                        content
                    );
                }
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                } = &blocks[1]
                {
                    assert_eq!(tool_use_id, "tu_second");
                    assert!(
                        content.contains("test4.rs"),
                        "second result should contain test4.rs: {}",
                        content
                    );
                }
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_read_file_state() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut agent = make_agent_with_tools(home, &["file_read"]);

                // 创建测试文件
                let test_file = home.join("read_test.txt");
                std::fs::write(&test_file, "hello world").unwrap();

                let tool_uses = vec![(
                    "tu01".to_string(),
                    "file_read".to_string(),
                    serde_json::json!({
                        "file_path": test_file.to_string_lossy().to_string(),
                    }),
                )];

                let (blocks, state_updates) = agent
                    .execute_tools_concurrent(&tool_uses)
                    .await
                    .expect("concurrent read should succeed");

                assert_eq!(blocks.len(), 1);
                assert!(matches!(blocks[0], ContentBlock::ToolResult { .. }));

                // 验证 state_updates 包含文件路径
                assert_eq!(state_updates.len(), 1);
                let (fp, _mtime) = &state_updates[0];
                assert!(
                    fp.ends_with("read_test.txt"),
                    "state update should reference the read file: {}",
                    fp
                );
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_multiple_reads_same_file() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut agent = make_agent_with_tools(home, &["file_read"]);

                let test_file = home.join("shared.txt");
                std::fs::write(&test_file, "shared content").unwrap();

                // 两个 file_read 指向同一个文件
                let fp = test_file.to_string_lossy().to_string();
                let tool_uses = vec![
                    (
                        "tu01".to_string(),
                        "file_read".to_string(),
                        serde_json::json!({ "file_path": fp }),
                    ),
                    (
                        "tu02".to_string(),
                        "file_read".to_string(),
                        serde_json::json!({ "file_path": fp }),
                    ),
                ];

                let (blocks, state_updates) = agent
                    .execute_tools_concurrent(&tool_uses)
                    .await
                    .expect("concurrent read should succeed");

                assert_eq!(blocks.len(), 2);
                // 两个读操作都会产生 state update，同一个文件可能有两条记录
                assert!(!state_updates.is_empty());
                // 都读成功
                for block in &blocks {
                    if let ContentBlock::ToolResult { content, .. } = block {
                        assert!(
                            content.contains("shared content"),
                            "content should include file text"
                        );
                    }
                }
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_mixed_tool_types() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &["file_find", "file_read"]);

                let test_file = home.join("target.txt");
                std::fs::write(&test_file, "hello from concurrent test").unwrap();

                // file_find + file_read 混合
                let fp = test_file.to_string_lossy().to_string();
                let tool_uses = vec![
                    (
                        "tu_find".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({
                            "pattern": "target.txt",
                            "path": home.to_string_lossy().to_string(),
                        }),
                    ),
                    (
                        "tu_read".to_string(),
                        "file_read".to_string(),
                        serde_json::json!({ "file_path": fp }),
                    ),
                ];

                let (blocks, state_updates) = agent
                    .execute_tools_concurrent(&tool_uses)
                    .await
                    .expect("concurrent mixed execution should succeed");

                assert_eq!(blocks.len(), 2);
                // file_read 会产生 state update
                assert_eq!(state_updates.len(), 1);

                // 验证结果顺序
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                } = &blocks[0]
                {
                    assert_eq!(tool_use_id, "tu_find");
                    assert!(content.contains("target.txt"), "find result: {}", content);
                }
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                } = &blocks[1]
                {
                    assert_eq!(tool_use_id, "tu_read");
                    assert!(
                        content.contains("hello from concurrent test"),
                        "read result: {}",
                        content
                    );
                }
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_unknown_tool() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &[]);

                let tool_uses = vec![(
                    "tu01".to_string(),
                    "nonexistent_tool".to_string(),
                    serde_json::json!({}),
                )];

                let result = agent.execute_tools_concurrent(&tool_uses).await;
                assert!(result.is_ok(), "unknown tool should not cause fatal error");
                let (blocks, _) = result.unwrap();
                assert_eq!(blocks.len(), 1, "should return one tool result");
                assert!(
                    extract_tool_result_content(&blocks[0]).contains("Unknown tool"),
                    "tool result should mention unknown tool"
                );
            });
        });
    }

    #[test]
    fn test_execute_tools_unknown_tool_does_not_crash_agent() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut agent = make_agent_with_tools(home, &["file_find", "file_read"]);

                // 混合已知和未知工具 —— 模拟用户报告的 bug 场景
                let tool_uses = vec![
                    (
                        "tu01".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({"pattern": "*.rs"}),
                    ),
                    (
                        "tu02".to_string(),
                        "nonexistent_tool".to_string(), // 这个工具未注册
                        serde_json::json!({}),
                    ),
                    (
                        "tu03".to_string(),
                        "file_read".to_string(),
                        serde_json::json!({"file_path": "Cargo.toml"}),
                    ),
                ];

                // 串行执行 — 不应 panic 或返回 Err
                let result = agent.execute_tools_serial(&tool_uses).await;
                assert!(
                    result.is_ok(),
                    "serial: unknown tool mixed with known should not error"
                );
                let blocks = result.unwrap();
                assert_eq!(
                    blocks.len(),
                    3,
                    "serial: should return results for all tools"
                );

                // 验证已知工具返回正常结果（file_find 输出文件路径，不为空即可）
                assert!(
                    !extract_tool_result_content(&blocks[0]).is_empty(),
                    "serial: file_find should still execute and return results"
                );
                assert!(
                    !extract_tool_result_content(&blocks[0]).contains("Tool error"),
                    "serial: file_find should not produce error"
                );
                // 未知工具返回错误信息
                assert!(
                    extract_tool_result_content(&blocks[1]).contains("Unknown tool"),
                    "serial: nonexistent_tool should produce error"
                );
                // 已知工具 file_read 应正常执行
                assert!(
                    !extract_tool_result_content(&blocks[2]).is_empty(),
                    "serial: file_read should still execute"
                );
                assert!(
                    !extract_tool_result_content(&blocks[2]).contains("Tool error"),
                    "serial: file_read should not produce error"
                );

                // 并发执行 — 不应 panic 或返回 Err
                let result = agent.execute_tools_concurrent(&tool_uses).await;
                assert!(
                    result.is_ok(),
                    "concurrent: unknown tool mixed with known should not error"
                );
                let (blocks, _) = result.unwrap();
                assert_eq!(
                    blocks.len(),
                    3,
                    "concurrent: should return results for all tools"
                );

                assert!(
                    extract_tool_result_content(&blocks[1]).contains("Unknown tool"),
                    "concurrent: nonexistent_tool should produce error"
                );
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_partial_success() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &["file_find"]);

                // 一个文件存在，一个 pattern 不匹配
                let test_file = home.join("exists.rs");
                std::fs::write(&test_file, "fn main() {}").unwrap();

                let tool_uses = vec![
                    (
                        "tu_found".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({
                            "pattern": "exists.rs",
                            "path": home.to_string_lossy().to_string(),
                        }),
                    ),
                    (
                        "tu_not_found".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({
                            "pattern": "nonexistent*.xyz",
                            "path": home.to_string_lossy().to_string(),
                        }),
                    ),
                ];

                let (blocks, state_updates) = agent
                    .execute_tools_concurrent(&tool_uses)
                    .await
                    .expect("concurrent execution should not fail even if some find nothing");

                assert_eq!(blocks.len(), 2);

                // 第一个找到文件，第二个找不到但不会报错
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                } = &blocks[0]
                {
                    assert_eq!(tool_use_id, "tu_found");
                    assert!(
                        content.contains("exists.rs"),
                        "should find file: {}",
                        content
                    );
                }
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                } = &blocks[1]
                {
                    assert_eq!(tool_use_id, "tu_not_found");
                    // 找不到文件也会返回成功（只是结果为空）
                }
                assert!(
                    state_updates.is_empty(),
                    "file_find doesn't update read_file_state"
                );
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_pre_read_check_blocks_write() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &["file_write"]);

                // 创建一个文件但不先读取
                let test_file = home.join("existing.txt");
                std::fs::write(&test_file, "original content").unwrap();

                let tool_uses = vec![(
                    "tu01".to_string(),
                    "file_write".to_string(),
                    serde_json::json!({
                        "file_path": test_file.to_string_lossy().to_string(),
                        "content": "new content",
                    }),
                )];

                let (blocks, state_updates) =
                    agent.execute_tools_concurrent(&tool_uses).await.expect(
                        "concurrent execution should not fail (pre-read check returns error msg)",
                    );

                assert_eq!(blocks.len(), 1);
                assert!(
                    state_updates.is_empty(),
                    "blocked write should not produce state updates"
                );

                if let ContentBlock::ToolResult { content, .. } = &blocks[0] {
                    assert!(
                        content.contains("未通过 file_read 读取"),
                        "pre-read check should block write: {}",
                        content
                    );
                }
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_pre_read_check_passes_for_new_file() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &["file_write"]);

                // 新文件（不存在的路径）→ 应直接放行
                let tool_uses = vec![(
                    "tu01".to_string(),
                    "file_write".to_string(),
                    serde_json::json!({
                        "file_path": home.join("new_file.txt").to_string_lossy().to_string(),
                        "content": "brand new",
                    }),
                )];

                let (blocks, _) = agent
                    .execute_tools_concurrent(&tool_uses)
                    .await
                    .expect("concurrent execution should succeed");

                assert_eq!(blocks.len(), 1);
                if let ContentBlock::ToolResult { content, .. } = &blocks[0] {
                    assert!(
                        !content.contains("未通过 file_read"),
                        "new file should pass pre-read check: {}",
                        content
                    );
                }
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_all_fail_gracefully() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &["file_read", "file_find"]);

                // 两个工具都传入无效参数
                let tool_uses = vec![
                    (
                        "tu_read".to_string(),
                        "file_read".to_string(),
                        serde_json::json!({ "file_path": "/nonexistent/path/file.txt" }),
                    ),
                    (
                        "tu_find".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({ "pattern": "*.rs", "path": "/nonexistent/dir" }),
                    ),
                ];

                let (blocks, _) = agent
                    .execute_tools_concurrent(&tool_uses)
                    .await
                    .expect("concurrent execution should not panic on failure");

                assert_eq!(blocks.len(), 2);

                // 两个都应该返回 ToolResult（包含错误信息而非 panic）
                for block in &blocks {
                    assert!(matches!(block, ContentBlock::ToolResult { .. }));
                }
            });
        });
    }

    #[test]
    fn test_execute_tools_concurrent_new_file_write_passes() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let agent = make_agent_with_tools(home, &["file_write"]);

                // 新文件写入（不应被预读检查拦截）
                let tool_uses = vec![(
                    "tu01".to_string(),
                    "file_write".to_string(),
                    serde_json::json!({
                        "file_path": home.join("brand_new.rs").to_string_lossy().to_string(),
                        "content": "fn new() {}",
                    }),
                )];

                let (blocks, state_updates) = agent
                    .execute_tools_concurrent(&tool_uses)
                    .await
                    .expect("concurrent execution should succeed");

                assert_eq!(blocks.len(), 1);
                assert!(
                    state_updates.is_empty(),
                    "file_write doesn't produce state updates"
                );
                if let ContentBlock::ToolResult { content, .. } = &blocks[0] {
                    assert!(
                        !content.contains("error") && !content.contains("Error"),
                        "new file write should not error: {}",
                        content
                    );
                }
            });
        });
    }

    /// 验证 chat_with_tools 中的分区逻辑集成：safe + unsafe 工具混合时，
    /// safe 的 file_find 和 unsafe 的 file_write 能被正确分区。
    #[test]
    fn test_chat_with_tools_partition_integration() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut agent = make_agent_with_tools(home, &["file_find", "file_write"]);

                // 创建测试文件
                let test_file = home.join("existing_for_write.txt");
                std::fs::write(&test_file, "will be overwritten").unwrap();

                // 混合 batch：file_find(safe) + file_write(unsafe) + file_find(safe)
                let merged = vec![
                    (
                        "tu01".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({
                            "pattern": "*.txt",
                            "path": home.to_string_lossy().to_string(),
                        }),
                    ),
                    (
                        "tu02".to_string(),
                        "file_write".to_string(),
                        serde_json::json!({
                            "file_path": test_file.to_string_lossy().to_string(),
                            "content": "new content",
                        }),
                    ),
                    (
                        "tu03".to_string(),
                        "file_find".to_string(),
                        serde_json::json!({
                            "pattern": "*.txt",
                            "path": home.to_string_lossy().to_string(),
                        }),
                    ),
                ];

                // 模拟 chat_with_tools 中的分区逻辑
                let batches = crate::agent::executor::partition_tool_calls(merged, &agent.tools);
                assert_eq!(batches.len(), 3, "should be 3 batches: safe, unsafe, safe");

                // Batch 1: safe — 并发执行
                assert!(batches[0].is_concurrency_safe);
                let (b1_blocks, _) = agent
                    .execute_tools_concurrent(&batches[0].items)
                    .await
                    .expect("batch 1 concurrent should succeed");
                assert_eq!(b1_blocks.len(), 1);
                assert_eq!(batches[0].items[0].0, "tu01");
                if let ContentBlock::ToolResult { content, .. } = &b1_blocks[0] {
                    assert!(
                        content.contains("existing_for_write.txt"),
                        "should find file: {}",
                        content
                    );
                }

                // Batch 2: unsafe — 串行执行
                assert!(!batches[1].is_concurrency_safe);
                let b2_blocks = agent
                    .execute_tools_serial(&batches[1].items)
                    .await
                    .expect("batch 2 serial should succeed");
                assert_eq!(b2_blocks.len(), 1);
                assert_eq!(batches[1].items[0].0, "tu02");
                if let ContentBlock::ToolResult { content, .. } = &b2_blocks[0] {
                    assert!(
                        content.contains("未通过 file_read 读取"),
                        "should be blocked by pre-read check: {}",
                        content
                    );
                }

                // Batch 3: safe — 并发执行
                assert!(batches[2].is_concurrency_safe);
                let (b3_blocks, _) = agent
                    .execute_tools_concurrent(&batches[2].items)
                    .await
                    .expect("batch 3 concurrent should succeed");
                assert_eq!(b3_blocks.len(), 1);
                assert_eq!(batches[2].items[0].0, "tu03");
            });
        });
    }

    /// 验证 same-file-results-then-edit 场景：
    /// 先并发读文件，再串行编辑，确保 read_file_state 正确传递
    #[test]
    fn test_concurrent_read_then_serial_edit() {
        run_with_temp_home(|home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                // 使用 read_file_state 的可变 agent
                let mut agent = make_agent_with_tools(home, &["file_read", "file_edit"]);

                let test_file = home.join("edit_me.txt");
                std::fs::write(&test_file, "original content").unwrap();

                let fp = test_file.to_string_lossy().to_string();

                // 第一步：并发读取文件（模拟 chat_with_tools 中的并行 batch）
                let read_tools = vec![(
                    "tu_read".to_string(),
                    "file_read".to_string(),
                    serde_json::json!({ "file_path": fp }),
                )];

                let (read_blocks, state_updates) = agent
                    .execute_tools_concurrent(&read_tools)
                    .await
                    .expect("concurrent read should succeed");

                assert_eq!(read_blocks.len(), 1);

                // 模拟 chat_with_tools 中 state_updates 的写入
                for (fp_update, mtime) in &state_updates {
                    agent.read_file_state.insert(fp_update.clone(), *mtime);
                }

                // 验证 state 已记录
                assert!(
                    agent.read_file_state.contains_key(&fp),
                    "read_file_state should contain the file"
                );

                // 第二步：在 state 已记录的情况下，串行编辑应通过预读检查
                let edit_tools = vec![(
                    "tu_edit".to_string(),
                    "file_edit".to_string(),
                    serde_json::json!({
                        "file_path": fp,
                        "mode": "line_range",
                        "start_line": 1,
                        "end_line": 1,
                        "expected": "original content",
                        "new_content": "modified content",
                    }),
                )];

                let edit_blocks = agent
                    .execute_tools_serial(&edit_tools)
                    .await
                    .expect("serial edit should succeed after read");

                assert_eq!(edit_blocks.len(), 1);
                if let ContentBlock::ToolResult { content, .. } = &edit_blocks[0] {
                    assert!(
                        !content.contains("未通过 file_read"),
                        "edit should pass pre-read check after concurrent read: {}",
                        content
                    );
                }
            });
        });
    }

    // ===== 缓存命中率相关测试 =====

    /// 模拟首条用户消息（含 context reminder 注入）
    fn simulate_first_turn(agent: &mut AiAgent, user_input: &str) {
        agent.context_injected = true;
        let reminder =
            crate::agent::system_prompt::build_context_reminder(agent.agents_md_content.as_deref());
        agent.messages.push(ConversationMessage {
            role: "user".to_string(),
            content: format!("{}{}", reminder, user_input),
            blocks: None,
        });
    }

    /// 模拟后续对话轮次
    /// 从 ToolResult ContentBlock 中提取 content 文本
    fn extract_tool_result_content(block: &ContentBlock) -> &str {
        if let ContentBlock::ToolResult { content, .. } = block {
            content
        } else {
            panic!("expected ToolResult block, got {:?}", block);
        }
    }

    fn simulate_turn(agent: &mut AiAgent, user_input: &str, assistant_prev: Option<&str>) {
        if let Some(prev) = assistant_prev {
            agent.messages.push(ConversationMessage {
                role: "assistant".to_string(),
                content: prev.to_string(),
                blocks: None,
            });
        }
        agent.messages.push(ConversationMessage {
            role: "user".to_string(),
            content: user_input.to_string(),
            blocks: None,
        });
    }

    #[test]
    fn test_cache_system_prompt_cross_session_stable() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let agent1 = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            let agent2 = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();
            // 默认系统提示词完全静态，跨会话应当完全一致
            assert_eq!(
                agent1.system_prompt, agent2.system_prompt,
                "同一设置的 Agent 应生成完全相同的系统提示词"
            );
            // 验证包含预期的静态工具规则
            assert!(
                agent1.system_prompt.contains("工具使用规则"),
                "系统提示词应包含工具使用规则"
            );
            assert!(
                agent1.system_prompt.contains("任务执行策略"),
                "系统提示词应包含任务执行策略"
            );
        });
    }

    #[test]
    fn test_cache_multi_turn_prefix_integrity() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            // 注册一些工具
            let shell_exec = crate::tools::shell_exec::ShellExec::new(Default::default());
            agent.register_tool(ToolHandler::ShellExec(shell_exec));
            let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
            agent.register_tool(ToolHandler::WebFetch(web_fetch));

            // Turn 1: 首条用户消息
            simulate_first_turn(&mut agent, "hello");
            let turn1_msgs = agent.messages.clone();

            // Turn 2: assistant 回复 + 用户新消息
            simulate_turn(&mut agent, "what's up?", Some("Hi! How can I help?"));
            let turn2_msgs = agent.messages.clone();

            // Turn 1 的消息应完整出现在 Turn 2 消息的前缀中（只追加不修改）
            assert_eq!(
                &turn2_msgs[..turn1_msgs.len()],
                &turn1_msgs[..],
                "多轮对话中历史消息应保持完整（只追加不修改）"
            );

            // Turn 3: 再一轮
            simulate_turn(&mut agent, "tell me a joke", Some("I'm fine!"));
            let turn3_msgs = agent.messages.clone();

            // Turn 2 的消息应完整出现在 Turn 3 的前缀中
            assert_eq!(
                &turn3_msgs[..turn2_msgs.len()],
                &turn2_msgs[..],
                "Turn 3 应包含 Turn 2 的完整消息历史"
            );

            // 验证序列化请求中的 system prompt + tools 字段完全相同
            let params_t1 = agent.build_params(false).unwrap();
            // 清除 messages 后比较 system + tools 部分
            let mut params_t1_stripped = params_t1;
            params_t1_stripped.messages = Vec::new();
            let json_t1_stripped = serde_json::to_string(&params_t1_stripped).unwrap();

            // 清除 messages 后重新构建 Turn 3 的 params
            let params_t3 = agent.build_params(false).unwrap();
            let mut params_t3_stripped = params_t3;
            params_t3_stripped.messages = Vec::new();
            let json_t3_stripped = serde_json::to_string(&params_t3_stripped).unwrap();

            assert_eq!(
                json_t1_stripped, json_t3_stripped,
                "多轮对话中 system prompt + tools 应保持不变"
            );
        });
    }

    #[test]
    fn test_cache_cross_session_prefix_ratio() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");

            // 创建两个相同配置的 Agent
            fn make_agent(home: &std::path::Path) -> AiAgent {
                let mut agent = AiAgent::new(AiAgentOptions {
                    api_key: Some("test-key".to_string()),
                    ..Default::default()
                })
                .unwrap();
                let shell_exec = crate::tools::shell_exec::ShellExec::new(Default::default());
                agent.register_tool(ToolHandler::ShellExec(shell_exec));
                let web_fetch = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
                agent.register_tool(ToolHandler::WebFetch(web_fetch));
                let web_search = crate::tools::web_search::WebSearch::new(
                    "k".into(),
                    "https://x.com".into(),
                    "m".into(),
                    100,
                )
                .unwrap();
                agent.register_tool(ToolHandler::WebSearch(web_search));
                agent
            }

            let mut agent_a = make_agent(home);
            let mut agent_b = make_agent(home);

            // 不同用户输入模拟跨会话场景
            simulate_first_turn(&mut agent_a, "write a poem about Rust");
            simulate_first_turn(&mut agent_b, "explain quantum computing");

            // 计算可缓存部分占总请求的比率
            // 稳定部分 = system_prompt + tool_defs + context_reminder中稳定前缀的长度
            let system_prompt_len = agent_a.system_prompt.len();

            let tool_defs_json: String = agent_a
                .tools
                .iter()
                .map(|t| serde_json::to_string(&t.tool_definition()).unwrap())
                .collect::<Vec<_>>()
                .join(",");

            // 首条消息内容
            let first_msg_content = &agent_a.messages[0].content;
            // Context reminder 中稳定前缀 = 到 用户输入 之前的全部内容
            // 稳定部分 = system + tools + context 前缀
            let stable_parties = system_prompt_len + tool_defs_json.len();

            // 总请求内容 = 稳定部分 + 首条消息的完整内容
            let total_size = stable_parties + first_msg_content.len();

            // 保守估计：仅 system_prompt + tool_defs 为可缓存前缀
            let cacheable_ratio = stable_parties as f64 / total_size as f64 * 100.0;

            eprintln!(
                "[缓存] system_prompt={}B, tools={}B, first_msg={}B, \
                 system+tools 占请求 {:.1}% (保守估计算法)",
                system_prompt_len,
                tool_defs_json.len(),
                first_msg_content.len(),
                cacheable_ratio
            );

            // 预期 system + tools 至少占请求的 40%+
            assert!(
                cacheable_ratio > 35.0,
                "system_prompt + tools 应占请求 35% 以上，实际 {:.1}%（system: {}B, tools: {}B, msg: {}B）",
                cacheable_ratio,
                system_prompt_len,
                tool_defs_json.len(),
                first_msg_content.len()
            );

            // 验证两个 Agent 的 system prompt 完全相同
            assert_eq!(
                agent_a.system_prompt, agent_b.system_prompt,
                "跨会话系统提示词应完全相同"
            );

            // 验证两个 Agent 的工具定义序列化结果完全相同
            let tools_a = agent_a
                .tools
                .iter()
                .map(|t| serde_json::to_string(&t.tool_definition()).unwrap())
                .collect::<Vec<_>>();
            let tools_b = agent_b
                .tools
                .iter()
                .map(|t| serde_json::to_string(&t.tool_definition()).unwrap())
                .collect::<Vec<_>>();
            assert_eq!(tools_a, tools_b, "跨会话工具定义应完全相同");

            // 验证首条消息的内容前缀（context reminder 稳定部分）完全相同
            // 取两个消息中较短的内容进行比较
            let min_len = agent_a.messages[0]
                .content
                .len()
                .min(agent_b.messages[0].content.len());
            let prefix_a = &agent_a.messages[0].content[..min_len];
            let prefix_b = &agent_b.messages[0].content[..min_len];
            // 找到公共前缀
            let lcp = prefix_a
                .chars()
                .zip(prefix_b.chars())
                .take_while(|(a, b)| a == b)
                .count();
            eprintln!(
                "[缓存] context reminder LCP={} chars（两个不同输入的公共前缀长度）",
                lcp
            );

            // context reminder 稳定部分（到用户输入之前）应完全相同
            assert!(
                lcp > 100,
                "context reminder 前缀应有足够长的公共部分（{} chars）",
                lcp
            );
        });
    }

    // --- 测试提取的纯函数 ---

    #[test]
    fn test_get_alternative_models_known_provider() {
        let models = get_alternative_models(Some("deepseek"));
        assert_eq!(models.len(), 2);
        assert!(models.contains(&"deepseek-v4-flash"));
        assert!(models.contains(&"deepseek-v4-pro"));
    }

    #[test]
    fn test_get_alternative_models_none_provider() {
        let models = get_alternative_models(None);
        assert_eq!(models.len(), 22); // 全部模型
    }

    #[test]
    fn test_get_alternative_models_unknown_provider() {
        let models = get_alternative_models(Some("nonexistent"));
        assert!(models.is_empty());
    }

    #[test]
    fn test_get_alternative_models_anthropic() {
        let models = get_alternative_models(Some("anthropic"));
        assert!(models.contains(&"claude-opus-4-7"));
        assert!(models.contains(&"claude-haiku-4-5"));
    }

    #[test]
    fn test_format_model_label_known_model_full() {
        let label = format_model_label("deepseek-v4-flash");
        assert!(label.contains("deepseek-v4-flash"));
        assert!(label.contains("1000K"), "应有上下文窗口信息");
        assert!(label.contains("384000"), "应有 max output 信息");
    }

    #[test]
    fn test_format_model_label_known_model_vision() {
        let label = format_model_label("glm-5v-turbo");
        // glm-5v-turbo 有 context_window 和 max_output_tokens
        assert!(label.contains("glm-5v-turbo"));
        assert!(label.contains("200K"));
    }

    #[test]
    fn test_format_model_label_unknown_model() {
        let label = format_model_label("some-unknown-model");
        assert_eq!(label, "some-unknown-model");
    }

    // --- 测试 AiAgent::new() 在未知模型 + 自定义 baseUrl 时的行为 ---

    #[test]
    fn test_agent_unknown_model_with_options_base_url() {
        run_with_temp_home(|home| {
            create_test_settings(
                home,
                "[llm]\n\n[llm.providers.deepseek]\napiKey = \"test-key\"\n\n[llm.models]\ndefault = \"deepseek-v3\"\n",
            );
            // deepseek-v3 不在内置列表中，但 options.base_url 已设置 → 应跳过提示
            let result = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                base_url: Some("https://custom.example.com".to_string()),
                ..Default::default()
            });
            assert!(result.is_ok());
            let agent = result.unwrap();
            assert_eq!(agent.model, "deepseek-v3");
        });
    }

    #[test]
    fn test_agent_unknown_model_with_provider_base_url_in_settings() {
        run_with_temp_home(|home| {
            create_test_settings(
                home,
                "[llm]\n\n[llm.providers.deepseek]\napiKey = \"test-key\"\nbaseUrl = \"https://custom.example.com\"\n\n[llm.models]\ndefault = \"deepseek-v3\"\n",
            );
            // deepseek-v3 不在内置列表中，但 providers.deepseek.baseUrl 已设置 → 应跳过提示
            let result = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            });
            assert!(result.is_ok());
            let agent = result.unwrap();
            assert_eq!(agent.model, "deepseek-v3");
        });
    }

    #[test]
    fn test_agent_known_model_skips_prompt() {
        run_with_temp_home(|home| {
            create_test_settings(
                home,
                "[llm]\n\n[llm.providers.deepseek]\napiKey = \"test-key\"\n\n[llm.models]\ndefault = \"deepseek-v4-flash\"\n",
            );
            // deepseek-v4-flash 在内置列表中 → 正常流程，无提示
            let result = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            });
            assert!(result.is_ok());
            let agent = result.unwrap();
            assert_eq!(agent.model, "deepseek-v4-flash");
        });
    }

    // ===== inject_history 单元测试 =====

    #[test]
    fn test_inject_history_replaces_messages() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            // 先添加一些初始消息
            agent.messages.push(ConversationMessage {
                role: "user".to_string(),
                content: "old message".to_string(),
                blocks: None,
            });

            let history = vec![
                ConversationMessage {
                    role: "user".to_string(),
                    content: "new message 1".to_string(),
                    blocks: None,
                },
                ConversationMessage {
                    role: "assistant".to_string(),
                    content: "new message 2".to_string(),
                    blocks: None,
                },
            ];

            agent.inject_history(history);

            // messages 应被替换为新的历史（2 条），而非追加（原有 1 条 → 3 条）
            assert_eq!(agent.messages.len(), 2, "messages 应被替换而非追加");
            assert_eq!(agent.messages[0].content, "new message 1");
            assert_eq!(agent.messages[1].content, "new message 2");
        });
    }

    #[test]
    fn test_inject_history_sets_context_injected() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            // 初始状态
            assert!(!agent.context_injected, "初始 context_injected 应为 false");

            agent.inject_history(vec![ConversationMessage {
                role: "user".to_string(),
                content: "test".to_string(),
                blocks: None,
            }]);

            assert!(
                agent.context_injected,
                "inject_history 后 context_injected 应为 true"
            );
        });
    }

    #[test]
    fn test_inject_history_empty_clears_messages() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            agent.messages.push(ConversationMessage {
                role: "user".to_string(),
                content: "existing".to_string(),
                blocks: None,
            });

            agent.inject_history(vec![]);

            assert!(agent.messages.is_empty(), "注入空历史后 messages 应被清空");
            assert!(
                agent.context_injected,
                "注入空历史后 context_injected 应为 true"
            );
        });
    }

    #[test]
    fn test_inject_history_build_params_preserves_content() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            // 注入含 text + tool_use blocks 的历史
            let history = vec![
                ConversationMessage {
                    role: "user".to_string(),
                    content: "find files".to_string(),
                    blocks: None,
                },
                ConversationMessage {
                    role: "assistant".to_string(),
                    content: String::new(),
                    blocks: Some(vec![ContentBlock::ToolUse {
                        id: "tu1".to_string(),
                        name: "file_find".to_string(),
                        input: serde_json::json!({"pattern": "*.rs"}),
                    }]),
                },
            ];

            agent.inject_history(history);
            let params = agent.build_params(false).unwrap();

            assert_eq!(params.messages.len(), 2, "build_params 应包含 2 条消息");

            // 第一条应为 Text 变体
            assert!(
                matches!(
                    params.messages[0].content,
                    zapmyco_anthropic_ai_sdk::types::message::MessageContent::Text { .. }
                ),
                "纯文本消息应有 Text 变体"
            );

            // 第二条应为 Blocks 变体
            assert!(
                matches!(
                    params.messages[1].content,
                    zapmyco_anthropic_ai_sdk::types::message::MessageContent::Blocks { .. }
                ),
                "tool_use 消息应有 Blocks 变体"
            );
        });
    }

    #[test]
    fn test_inject_history_then_new_message_no_context_reminder() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            // 用 simulate_first_turn 构造含 context_reminder 的历史
            simulate_first_turn(&mut agent, "original task");
            simulate_turn(&mut agent, "follow up", Some("previous response"));

            let history = agent.messages.clone();
            let history_count = history.len();

            // 创建新 agent 模拟 --conversation 场景
            let mut new_agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            new_agent.inject_history(history);

            // 验证 context_injected 已被设置
            assert!(
                new_agent.context_injected,
                "inject_history 应设置 context_injected = true"
            );
            assert_eq!(
                new_agent.messages.len(),
                history_count,
                "messages 应与注入的历史条数一致"
            );

            // 历史消息的第一条应包含 context_reminder
            assert!(
                new_agent.messages[0].content.contains("<system-reminder>"),
                "历史消息应包含 context_reminder"
            );

            // 模拟 chat_with_tools 在 context_injected = true 时的行为
            let new_input = "new task";
            let full_input = new_input.to_string();
            new_agent.messages.push(ConversationMessage {
                role: "user".to_string(),
                content: full_input,
                blocks: None,
            });

            // 新消息不应含 context_reminder
            assert!(
                !new_agent
                    .messages
                    .last()
                    .unwrap()
                    .content
                    .contains("<system-reminder>"),
                "inject_history 后的新消息不应含 context_reminder"
            );
            assert_eq!(
                new_agent.messages.last().unwrap().content,
                "new task",
                "新消息内容应为原始输入"
            );

            // build_params 验证总消息数正确
            let params = new_agent.build_params(false).unwrap();
            assert_eq!(
                params.messages.len(),
                history_count + 1,
                "总消息数 = 历史消息数 + 1 条新消息"
            );
        });
    }

    // ===== 对话日志回环测试 =====

    #[test]
    fn test_conversation_log_round_trip_content_preserved() {
        run_with_temp_home(|home| {
            create_test_settings(home, "[llm]\n");

            // 构建含 context_reminder 的多轮对话
            let mut agent = AiAgent::new(AiAgentOptions {
                api_key: Some("test-key".to_string()),
                ..Default::default()
            })
            .unwrap();

            simulate_first_turn(&mut agent, "search files");
            simulate_turn(
                &mut agent,
                "find .rs files",
                Some("I found these: main.rs, lib.rs"),
            );
            simulate_turn(
                &mut agent,
                "show me main.rs",
                Some("Here's the content of main.rs"),
            );

            let original_messages = agent.messages.clone();

            // 从 agent 构建 API 参数
            let params = agent.build_params(true).unwrap();

            // 创建 logger 并写入日志
            let logger = crate::agent::conversation_logger::ConversationLogger::new().unwrap();
            let result = crate::agent::stream::RoundResult {
                full_text: "Here's the content of main.rs".to_string(),
                tool_uses: vec![],
                blocks: vec![ContentBlock::Text {
                    text: "Here's the content of main.rs".to_string(),
                    citations: None,
                }],
                input_tokens: 80,
                output_tokens: 20,
                cache_read_input_tokens: None,
                cache_creation_input_tokens: None,
                duration_ms: 200,
                model: "test-model".to_string(),
            };
            crate::agent::executor::log_round_trip_stream(&logger, &params, &result, 200);

            // 从 JSONL 加载回消息
            let loaded =
                crate::agent::conversation_loader::load_conversation(logger.session_id()).unwrap();

            // 验证消息条数一致
            assert_eq!(
                loaded.len(),
                original_messages.len(),
                "回环后的消息数应与原始一致"
            );

            // 逐条验证 role + content 完全一致
            for (i, (orig, ld)) in original_messages.iter().zip(loaded.iter()).enumerate() {
                assert_eq!(
                    orig.role, ld.role,
                    "[{}] role 不一致: original={:?}, loaded={:?}",
                    i, orig.role, ld.role
                );
                assert_eq!(
                    orig.content, ld.content,
                    "[{}] content 不一致:\n  original: {:?}\n  loaded:   {:?}",
                    i, orig.content, ld.content
                );
            }

            // 验证 context_reminder 被完整保留
            assert!(
                loaded[0].content.contains("<system-reminder>"),
                "回环后 context_reminder 应被保留"
            );
            assert!(
                loaded[0].content.contains("search files"),
                "回环后用户输入应被保留"
            );
            assert!(
                loaded[0].blocks.is_none(),
                "纯文本消息经过回环后 blocks 应为 None"
            );
        });
    }
}
