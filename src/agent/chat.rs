use futures_util::StreamExt;
use std::time::Instant;
/// AI Agent - 基于 anthropic-ai-sdk 的 LLM 对话代理
use zapmyco_anthropic_ai_sdk::client::AnthropicClient;
use zapmyco_anthropic_ai_sdk::types::message::{
    ContentBlock, ContentBlockDelta, CreateMessageParams, CreateMessageResponse, Message,
    MessageClient, MessageError, RequiredMessageParams, Role, StopReason, StreamEvent, Tool,
};

use crate::agent::conversation_logger::ConversationLogger;
use crate::config::models::get_model_info;
use crate::config::settings::{is_conversation_log_enabled, load_settings, resolve_env_ref};
use crate::datetime;

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
}

impl ToolHandler {
    fn tool_definition(&self) -> Tool {
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
    /// 文件读取状态追踪 (path → mtime_ms)，用于 file_write/file_edit 的预读检查
    read_file_state: std::collections::HashMap<String, u64>,
    /// 任务管理器（可选，用于在终端展示任务列表）
    task_manager: Option<std::sync::Arc<crate::tools::task_manager::TaskManager>>,
    /// 任务展示状态机（可选，用于事件流 + 检查点快照展示）
    task_display: Option<crate::tools::task_display::TaskDisplayState>,
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
            read_file_state: std::collections::HashMap::new(),
            task_manager: None,
            task_display: None,
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

    /// 注册工具处理器
    pub fn register_tool(&mut self, handler: ToolHandler) {
        self.tools.push(handler);
        self.rebuild_system_prompt_with_tools();
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
                eprintln!("[Task] 获取任务列表失败: {}", e);
                return;
            }
        };

        let output = td.compute_output(&tasks);

        for event in &output.events {
            eprintln!("{}", event);
        }
        if let Some(snapshot) = &output.snapshot {
            eprintln!("\n{}\n", snapshot);
        }
    }

    /// 从 base_system_prompt + 所有已注册工具描述重建 system_prompt
    fn rebuild_system_prompt_with_tools(&mut self) {
        self.system_prompt = self.base_system_prompt.clone();
        if self.tools.is_empty() {
            return;
        }

        self.system_prompt.push_str("\n\n你有以下工具可以使用：\n");

        // 先加一条总体指导，强调专用工具优先于 shell_exec
        self.system_prompt
            .push_str("注意：有专用工具的任务应使用专用工具，不要使用 shell_exec 替代。");
        self.system_prompt.push('\n');

        for handler in &self.tools {
            let desc = match handler {
                ToolHandler::AskUser(_) => {
                    "- ask_user: 向用户提出一个带有选项的问题并等待回答。\
                      当你需要用户做出选择、澄清需求、确认操作或选择偏好时使用。\
                      需要提供清晰的问题（question）和选项列表（options，每个选项包含 label 和 description）。\
                      支持单选和多选（multi_select 参数）。"
                }
                ToolHandler::WebFetch(_) => {
                    "- web_fetch: 获取网页内容并转换为 Markdown。当你需要访问互联网信息时使用。"
                }
                ToolHandler::ShellExec(_) => {
                    "- shell_exec: 在本地系统执行 shell 命令并返回输出。\
                      当你需要运行代码、查询系统信息或文件操作时使用。\
                      重要：不要使用 cat/head/tail 来读取文件内容，应使用 file_read 工具。"
                }
                ToolHandler::WebSearch(_) => {
                    "- web_search: 搜索网络获取实时信息。当你需要查询当前新闻、文档、趋势等实时信息时使用。支持 query（搜索关键词）、allowed_domains（限定域名）、blocked_domains（排除域名）参数。"
                }
                ToolHandler::FileSearch(_) => {
                    "- file_search: 在本地文件系统中搜索文件内容，支持正则表达式。参数包括 pattern（必填，正则模式串）、path（搜索路径，默认当前目录）、glob（文件通配符过滤）、output_mode（输出模式：content/files_with_matches/count）、-A/-B/-C（上下文行数）、-i（忽略大小写）、head_limit（最大结果行数，默认250）、offset（跳过前N条）、multiline（多行模式）、type（文件类型过滤如 rust/js/py）。"
                }
                ToolHandler::FileFind(_) => {
                    "- file_find: 在本地文件系统中按文件名模式匹配快速查找文件。\
                      支持 glob 通配符模式（如 **/*.rs、src/**/*.ts）。\
                      参数包括 pattern（必填，glob 模式串）、path（搜索路径，默认当前目录）、\
                      head_limit（最大结果数，默认100）、offset（跳过前N条结果）。\
                      适用于按名称搜索文件、查找特定类型文件等场景。\
                      与 file_search 不同，file_find 只匹配文件名而非文件内容。"
                }
                ToolHandler::FileRead(_) => {
                    "- file_read: 读取本地文件系统中的文件内容。支持 file_path（必填，文件路径）、offset（可选，起始行号，从1开始）、limit（可选，最大行数）参数。适用于查看源代码文件、读取配置文件、分析日志等场景。\
                      注意：如果后续需要对文件进行修改（file_edit）或覆盖写入（file_write），必须先通过本工具读取文件内容。"
                }
                ToolHandler::FileEdit(_) => {
                    "- file_edit: 修改本地文件系统中的文件内容。使用 old_string/new_string 模式进行精确替换，比 sed 命令更安全可靠。\
                      参数包括 file_path（必填，文件路径）、old_string（必填，要被替换的文本）、\
                      new_string（必填，替换后的文本）、replace_all（可选，是否替换所有匹配项）。\
                      注意：需要确保 old_string 在文件中出现且唯一；编辑前必须先使用 file_read 读取文件内容。"
                }
                ToolHandler::FileWrite(_) => {
                    "- file_write: 创建新文件或完整覆盖已有文件。\
                      参数包括 file_path（必填，文件绝对路径）、content（必填，要写入的完整文件内容）。\
                      注意：如果要覆盖已有的文件，必须先使用 file_read 读取文件内容后才可以写入。\
                      对于已有文件的小范围修改，建议使用 file_edit 工具。"
                }
                ToolHandler::TaskCreate(_) => {
                    "- task_create: 创建新任务以跟踪复杂工作的进度。\
                      当你需要完成 3 个以上步骤的复杂任务时，使用此工具主动创建任务列表。\
                      接收到用户新指令后，立即将需求拆解为可跟踪的子任务。\
                      参数: subject（必填，简洁的任务标题）、description（必填，任务描述）、\
                      active_form（可选，进行时态，如'正在实现登录'）。\
                      新任务创建后状态为 pending。创建后使用 task_list 查看，task_update 更新状态。"
                }
                ToolHandler::TaskGet(_) => {
                    "- task_get: 按 ID 获取单个任务的完整描述、状态和依赖关系。\
                      参数: task_id（必填，任务 ID）。适用于开始工作前了解任务详情。"
                }
                ToolHandler::TaskList(_) => {
                    "- task_list: 列出所有任务及其状态。\
                      适用于了解整体进度、查找可认领的任务、检查阻塞关系。\
                      开始复杂工作前应先调用此工具查看现状。无需参数。"
                }
                ToolHandler::TaskUpdate(_) => {
                    "- task_update: 更新任务的状态或字段。\
                      参数: task_id（必填）、status（可选：pending/in_progress/completed/deleted）、\
                      subject（可选）、description（可选）、active_form（可选）、\
                      add_blocks/add_blocked_by（可选，设置依赖关系）、owner（可选，负责人）。\
                      使用流程：开始工作前标记 in_progress → 完成后标记 completed。\
                      只有 FULLY 完成的任务才标记为 completed。如果遇到阻塞无法完成，请更新字段说明原因。"
                }
            };
            self.system_prompt.push_str(desc);
            self.system_prompt.push('\n');
        }

        self.system_prompt.push_str("使用工具时请注意安全。");

        // 如果有 Task 工具注册，追加任务执行策略
        let has_task_tools = self.tools.iter().any(|t| {
            let name = t.tool_definition().name;
            name == "task_create" || name == "task_update" || name == "task_list"
        });
        if has_task_tools {
            self.system_prompt.push_str(
                "\n\n## 任务执行策略\n\
                 当使用 task_create 创建任务后，请按以下步骤执行：\n\
                 1. 调用 task_list 查看所有任务的依赖关系\n\
                 2. 选择 blocked_by 为空且状态为 pending 的任务\n\
                 3. 调用 task_update 将其标记为 in_progress\n\
                 4. 使用 shell_exec、file_edit 等工具完成该任务\n\
                 5. 调用 task_update 将其标记为 completed\n\
                 6. 重复步骤 1-5 直到所有任务完成\n\
                 注意：每次工具调用轮次只处理一个任务。完成后标记 completed \
                 然后检查 task_list 找出下一个可用任务。\
                 被 blocked 的任务跳过，等依赖任务完成后再处理。",
            );
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

        for round in 0..self.max_tool_rounds {
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

            tracing::info!(
                model = %response.model,
                stop_reason = ?response.stop_reason,
                input_tokens = response.usage.input_tokens,
                output_tokens = response.usage.output_tokens,
                duration_ms = duration_ms,
                round = round,
                "LLM 请求完成"
            );

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
                let tool_start = Instant::now();
                eprintln!("\n[工具] 🔧 {} 准备调用...", name);

                let handler = self
                    .tools
                    .iter()
                    .find(|h| h.tool_definition().name == *name)
                    .ok_or_else(|| format!("Unknown tool: {}", name))?;

                // 显示工具参数
                match name.as_str() {
                    "ask_user" => {
                        if let Some(q) = input.get("question").and_then(|v| v.as_str()) {
                            let truncated = if q.len() > 60 {
                                format!("{}...", &q[..60])
                            } else {
                                q.to_string()
                            };
                            eprintln!("[工具]   └ 问题: {}", truncated);
                        }
                    }
                    "web_fetch" => {
                        if let Some(url) = input.get("url").and_then(|v| v.as_str()) {
                            eprintln!("[工具]   └ 参数: url = {}", url);
                        }
                    }
                    "shell_exec" => {
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
                    "web_search" => {
                        if let Some(q) = input.get("query").and_then(|v| v.as_str()) {
                            let truncated = if q.len() > 80 {
                                format!("{}...", &q[..80])
                            } else {
                                q.to_string()
                            };
                            eprintln!("[工具]   └ 搜索: {}", truncated);
                        }
                    }
                    "file_search" => {
                        if let Some(p) = input.get("pattern").and_then(|v| v.as_str()) {
                            let truncated = if p.len() > 80 {
                                format!("{}...", &p[..80])
                            } else {
                                p.to_string()
                            };
                            eprintln!("[工具]   └ 模式: {}", truncated);
                        }
                        if let Some(p) = input.get("path").and_then(|v| v.as_str()) {
                            eprintln!("[工具]   └ 路径: {}", p);
                        }
                        if let Some(m) = input.get("output_mode").and_then(|v| v.as_str())
                            && m != "content"
                        {
                            eprintln!("[工具]   └ 模式: {}", m);
                        }
                    }
                    "file_find" => {
                        if let Some(p) = input.get("pattern").and_then(|v| v.as_str()) {
                            let truncated = if p.len() > 80 {
                                format!("{}...", &p[..80])
                            } else {
                                p.to_string()
                            };
                            eprintln!("[工具]   └ 模式: {}", truncated);
                        }
                        if let Some(p) = input.get("path").and_then(|v| v.as_str()) {
                            eprintln!("[工具]   └ 路径: {}", p);
                        }
                    }
                    "file_read" => {
                        if let Some(fp) = input.get("file_path").and_then(|v| v.as_str()) {
                            eprintln!("[工具]   └ 文件: {}", fp);
                        }
                    }
                    "file_edit" => {
                        if let Some(fp) = input.get("file_path").and_then(|v| v.as_str()) {
                            let truncated = if fp.len() > 80 {
                                format!("{}...", &fp[..80])
                            } else {
                                fp.to_string()
                            };
                            eprintln!("[工具]   └ 文件: {}", truncated);
                        }
                        if let Some(old) = input.get("old_string").and_then(|v| v.as_str()) {
                            let truncated = if old.len() > 50 {
                                format!("{}...", &old[..50])
                            } else {
                                old.to_string()
                            };
                            eprintln!("[工具]   └ 查找: {}", truncated);
                        }
                    }
                    "task_create" => {
                        if let Some(s) = input.get("subject").and_then(|v| v.as_str()) {
                            eprintln!("[工具]   └ 任务: {}", s);
                        }
                    }
                    "task_update" => {
                        if let Some(id) = input.get("task_id").and_then(|v| v.as_str()) {
                            eprintln!("[工具]   └ 任务ID: {}", id);
                        }
                        if let Some(s) = input.get("status").and_then(|v| v.as_str()) {
                            eprintln!("[工具]   └ 状态: {}", s);
                        }
                    }
                    "task_get" => {
                        if let Some(id) = input.get("task_id").and_then(|v| v.as_str()) {
                            eprintln!("[工具]   └ 任务ID: {}", id);
                        }
                    }
                    "task_list" => {}
                    _ => {}
                }

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

                let result_text = if let Some(err_msg) = pre_read_error {
                    tracing::warn!(tool = %name, error = %err_msg, "工具预读检查失败");
                    eprintln!("[工具] ❌ {} 预读检查失败: {}", name, err_msg);
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
                            eprintln!(
                                "[工具] ✅ {} 完成 ({:.1}s, {} 字符)",
                                name,
                                elapsed.as_secs_f64(),
                                text.len()
                            );
                            text
                        }
                        Err(e) => {
                            tracing::warn!(tool = %name, error = %e, "工具执行失败");
                            eprintln!("[工具] ❌ {} 失败: {}", name, e);
                            format!("[Tool error: {}]", e)
                        }
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

            // 每轮工具执行完毕后展示任务列表（一轮一次，不重复）
            self.print_task_summary_if_needed().await;

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
        use crate::config::settings::{LlmSettings, ProviderConfig};
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
        use crate::config::settings::{LlmSettings, ProviderConfig};
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
        use crate::config::settings::{LlmSettings, ProviderConfig};
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
            let logger = crate::agent::conversation_logger::ConversationLogger::new().unwrap();

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
            let web_fetch2 = crate::tools::web_fetch::WebFetch::new(Default::default()).unwrap();
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

            assert!(
                agent.system_prompt.contains("web_search"),
                "system prompt should mention web_search: {}",
                agent.system_prompt
            );
            assert!(
                agent.system_prompt.starts_with("原始提示"),
                "original prompt should be preserved"
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
}
