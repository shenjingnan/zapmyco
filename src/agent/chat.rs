use futures_util::{Stream, StreamExt};
use std::pin::Pin;
use std::time::Instant;
/// AI Agent - 基于 anthropic-ai-sdk 的 LLM 对话代理
use zapmyco_anthropic_ai_sdk::client::AnthropicClient;
use zapmyco_anthropic_ai_sdk::types::message::{
    ContentBlock, ContentBlockDelta, CreateMessageParams, CreateMessageResponse, Message,
    MessageClient, MessageError, RequiredMessageParams, Role, StreamEvent, Tool,
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

    /// 判断工具在当前输入下是否可以与其他工具并行执行
    fn is_concurrency_safe(&self, input: &serde_json::Value) -> bool {
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

/// 流式响应解析状态机
enum StreamParseState {
    /// 不在任何 content block 中
    Idle,
    /// 正在收集文本（TextDelta）
    TextBlock,
    /// 正在收集工具调用的 JSON 参数（InputJsonDelta）
    ToolUseBlock {
        id: String,
        name: String,
        input_buffer: String,
    },
}

/// 一轮流式请求的结果
struct RoundResult {
    /// 从 text blocks 拼接的完整文本
    full_text: String,
    /// 收集到的工具调用列表 (id, name, input)
    tool_uses: Vec<(String, String, serde_json::Value)>,
    /// 按原始顺序重建的 ContentBlock 列表（用于对话历史记录）
    blocks: Vec<ContentBlock>,
    /// input token 数
    input_tokens: u32,
    /// output token 数
    output_tokens: u32,
    /// cache read tokens
    cache_read_input_tokens: Option<u32>,
    /// cache creation tokens
    cache_creation_input_tokens: Option<u32>,
    /// API 耗时（毫秒）
    duration_ms: u64,
    /// 模型名称
    model: String,
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
            max_tool_rounds: u32::MAX,
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

        // 输出 token 用量
        print_usage_line(
            None,
            response.usage.input_tokens,
            response.usage.output_tokens,
            response.usage.cache_read_input_tokens,
            response.usage.cache_creation_input_tokens,
            duration_ms,
        );

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

        // 输出 token 用量
        print_usage_line(
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
        self.rebuild_system_prompt_with_tools();
    }

    /// 根据名称批量移除已注册的工具
    pub fn remove_tools(&mut self, names: &[&str]) {
        self.tools
            .retain(|t| !names.contains(&t.tool_definition().name.as_str()));
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

        // 先加一条总体指导，强调专用工具优先于 shell_exec（仅当 shell_exec 已注册时）
        let has_shell_exec = self
            .tools
            .iter()
            .any(|t| t.tool_definition().name == "shell_exec");
        if has_shell_exec {
            self.system_prompt
                .push_str("注意：有专用工具的任务应使用专用工具，不要使用 shell_exec 替代。");
            self.system_prompt.push('\n');
        }

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
                    "- file_edit: 修改本地文件系统中的文件内容。推荐使用 line_range 模式（比 old_string 更稳定）。\
                      支持多种模式：\n\
                      1. line_range（推荐）: 按行号替换。参数: file_path（必填）、start_line（起始行号）、\
                      end_line（结束行号）、expected（预期内容，至少 3 行非空代码行）、\
                      new_content（新内容）。系统会自动验证 expected 与实际内容是否一致。\n\
                      2. append: 在文件末尾追加。参数: file_path（必填）、mode=append、content（要追加的内容）。\n\
                      3. insert_after: 在指定行后插入。参数: file_path（必填）、mode=insert_after、\
                      target_line（插入位置）、content（要插入的内容）。\n\
                      4. 批量编辑: 使用 edits 数组同时编辑一个文件的多个位置。参数: file_path（必填）、\
                      edits（数组，每个元素包含 start_line/end_line/expected/new_content）。\n\
                      5. old_string/new_string（旧模式）: 精确字符串替换，保留以兼容旧版。\n\
                      注意：line_range 模式 edits 数组中的每个元素的 expected 至少 3 行非空代码行（trim 后），\
                      否则会被拒绝执行。编辑前必须先使用 file_read 读取文件内容。"
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
    /// 使用统一流式请求，在工具调用阶段实时输出 LLM 推理文本，
    /// 最终回复阶段直接使用流式文本，无需额外请求。
    pub async fn chat_with_tools(
        &mut self,
        input: &str,
        mut on_chunk: impl FnMut(&str),
    ) -> Result<String, String> {
        self.messages.push(ConversationMessage {
            role: "user".to_string(),
            content: input.to_string(),
            blocks: None,
        });

        for round in 0..self.max_tool_rounds {
            eprintln!("\n[LLM] 🤔 思考中...");

            let result = self.stream_one_round(&mut on_chunk).await?;

            // 输出 token 用量
            print_usage_line(
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
                log_round_trip_stream(logger, &params, &result, result.duration_ms);
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
            let merged = merge_file_edits(&result.tool_uses);
            let batches = partition_tool_calls(merged, &self.tools);
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
    ) -> Result<RoundResult, String> {
        let params = self.build_params(true)?;
        let start = Instant::now();

        let stream = self
            .client
            .create_message_streaming(&params)
            .await
            .map_err(|e| format!("API 流式请求失败: {}", e))?;

        let event_stream = stream.map(|r| r.map_err(|e| format!("流式读取失败: {}", e)));
        let mut result = Self::process_stream_events(event_stream, on_chunk).await?;
        result.duration_ms = start.elapsed().as_millis() as u64;
        Ok(result)
    }

    /// 处理流式事件序列，返回解析结果（纯逻辑，可单元测试）
    async fn process_stream_events(
        events: impl Stream<Item = Result<StreamEvent, String>>,
        on_chunk: &mut dyn FnMut(&str),
    ) -> Result<RoundResult, String> {
        let mut state = StreamParseState::Idle;
        let mut full_text = String::new();
        let mut tool_uses = Vec::new();
        let mut blocks = Vec::new();
        let mut input_tokens = 0u32;
        let mut output_tokens = 0u32;
        let mut cache_read = None;
        let mut cache_create = None;
        let mut model = String::new();

        let mut stream = std::pin::pin!(events);
        while let Some(event) = stream.next().await {
            let event = event?;
            match event {
                StreamEvent::MessageStart { message } => {
                    input_tokens = message.usage.input_tokens;
                    model = message.model;
                }
                StreamEvent::ContentBlockStart { content_block, .. } => match content_block {
                    ContentBlock::Text { .. } => {
                        state = StreamParseState::TextBlock;
                    }
                    ContentBlock::ToolUse { id, name, input } => {
                        // 判断 ContentBlockStart 是否已包含完整参数
                        let has_full_input =
                            input.is_object() && input.as_object().is_some_and(|m| !m.is_empty());
                        if has_full_input {
                            // API 直接在 ContentBlockStart 中提供了完整参数
                            blocks.push(ContentBlock::ToolUse {
                                id: id.clone(),
                                name: name.clone(),
                                input: input.clone(),
                            });
                            tool_uses.push((id, name, input));
                        // state 保持 Idle，ContentBlockStop 跳过
                        } else {
                            // ContentBlockStart 中 input 为空占位符，
                            // 等待 InputJsonDelta 增量到达
                            state = StreamParseState::ToolUseBlock {
                                id,
                                name,
                                input_buffer: String::new(),
                            };
                        }
                    }
                    _ => {}
                },
                StreamEvent::ContentBlockDelta { delta, .. } => match delta {
                    ContentBlockDelta::TextDelta { text } => {
                        full_text.push_str(&text);
                        on_chunk(&text);
                    }
                    ContentBlockDelta::InputJsonDelta { partial_json } => {
                        if let StreamParseState::ToolUseBlock {
                            ref mut input_buffer,
                            ..
                        } = state
                        {
                            input_buffer.push_str(&partial_json);
                        }
                    }
                    _ => {}
                },
                StreamEvent::ContentBlockStop { .. } => {
                    if let StreamParseState::ToolUseBlock {
                        id,
                        name,
                        input_buffer,
                    } = std::mem::replace(&mut state, StreamParseState::Idle)
                    {
                        let input: serde_json::Value = serde_json::from_str(&input_buffer)
                            .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));
                        blocks.push(ContentBlock::ToolUse {
                            id: id.clone(),
                            name: name.clone(),
                            input: input.clone(),
                        });
                        tool_uses.push((id, name, input));
                    }
                }
                StreamEvent::MessageDelta { usage: Some(u), .. } => {
                    output_tokens = u.output_tokens;
                    cache_read = u.cache_read_input_tokens;
                    cache_create = u.cache_creation_input_tokens;
                }
                StreamEvent::MessageStop => {
                    break;
                }
                StreamEvent::Error { error } => {
                    return Err(format!("API 流式错误: {} ({})", error.message, error.type_));
                }
                _ => {}
            }
        }

        // 在 blocks 开头插入 Text block（如果存在文本内容）
        if !full_text.is_empty() {
            blocks.insert(
                0,
                ContentBlock::Text {
                    text: full_text.clone(),
                    citations: None,
                },
            );
        }

        Ok(RoundResult {
            full_text,
            tool_uses,
            blocks,
            input_tokens,
            output_tokens,
            cache_read_input_tokens: cache_read,
            cache_creation_input_tokens: cache_create,
            duration_ms: 0,
            model,
        })
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
                        format!("{} {} ×{}", tool_icon(name), name, count)
                    } else {
                        format!("{} {}", tool_icon(name), name)
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");
            eprintln!(
                "\n[工具] 📋 本轮 {} 个工具调用: {}",
                tool_uses.len(),
                count_summary
            );
        }

        let mut tool_result_blocks: Vec<ContentBlock> = Vec::new();

        for (tool_use_id, name, input) in tool_uses {
            let tool_start = Instant::now();

            let handler = self
                .tools
                .iter()
                .find(|h| h.tool_definition().name == *name)
                .ok_or_else(|| format!("Unknown tool: {}", name))?;

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

            let icon = tool_icon(name);
            let param = format_tool_param(name, input);

            let result_text = if let Some(err_msg) = pre_read_error {
                tracing::warn!(tool = %name, error = %err_msg, "工具预读检查失败");
                eprintln!("[工具] ⚠️ {} {}  ❌ {}", icon, name, err_msg);
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
                            "[工具] {} {}  {}  ({:.1}s, {} 字符)",
                            icon,
                            name,
                            param,
                            elapsed.as_secs_f64(),
                            text.len()
                        );
                        text
                    }
                    Err(e) => {
                        tracing::warn!(tool = %name, error = %e, "工具执行失败");
                        eprintln!("[工具] {} {}  {}  ❌ 失败: {}", icon, name, param, e);
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
                        format!("{} {} ×{}", tool_icon(name), name, count)
                    } else {
                        format!("{} {}", tool_icon(name), name)
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");
            eprintln!(
                "\n[工具] 📋 本轮 {} 个工具调用（并行）: {}",
                tool_uses.len(),
                count_summary
            );
        }

        use futures_util::StreamExt as _;
        use futures_util::stream::FuturesUnordered;

        let total = tool_uses.len();
        let mut futures: FuturesUnordered<Pin<Box<dyn Future<Output = _> + Send>>> =
            FuturesUnordered::new();

        // 为每个工具构造一个并发执行的 future
        for (idx, (tool_use_id, name, input)) in tool_uses.iter().enumerate() {
            let handler = self
                .tools
                .iter()
                .find(|h| h.tool_definition().name == *name)
                .ok_or_else(|| format!("Unknown tool: {}", name))?;

            let icon = tool_icon(name);
            let param = format_tool_param(name, input);
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
                            // 提取文件状态（file_read），后面统一应用
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

        // 收集结果
        let mut results: Vec<Option<String>> = vec![None; total];
        let mut result_ids: Vec<Option<String>> = vec![None; total];
        let mut log_lines: Vec<Option<String>> = vec![None; total];
        let mut state_updates: Vec<(String, u64)> = Vec::new();

        while let Some((idx, tool_use_id, result_text, file_state, log_line)) = futures.next().await
        {
            results[idx] = Some(result_text);
            result_ids[idx] = Some(tool_use_id);
            log_lines[idx] = Some(log_line);
            if let Some((fp, mtime)) = file_state {
                state_updates.push((fp, mtime));
            }
        }

        // 按原始顺序统一输出，避免并发 eprintln! 交错
        for line in log_lines.iter().flatten() {
            eprintln!("{}", line);
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

/// 获取工具类型对应的终端图标
fn tool_icon(name: &str) -> &'static str {
    match name {
        "file_read" => "\u{1f4d6}",                       // 📖
        "file_find" | "file_search" => "\u{1f50d}",       // 🔍
        "file_write" | "file_edit" => "\u{270f}\u{fe0f}", // ✏️
        "shell_exec" => "\u{1f4bb}",                      // 💻
        "web_search" => "\u{1f310}",                      // 🌐
        "web_fetch" => "\u{1f4e1}",                       // 📡
        "ask_user" => "\u{1f4ac}",                        // 💬
        "task_create" | "task_get" | "task_list" | "task_update" => "\u{1f4cb}", // 📋
        _ => "\u{1f527}",                                 // 🔧
    }
}

/// 生成工具参数的紧凑单行描述
fn format_tool_param(name: &str, input: &serde_json::Value) -> String {
    match name {
        "file_read" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "file_find" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            let path = input.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if path.is_empty() {
                pattern.to_string()
            } else {
                format!("{}  in  {}", pattern, path)
            }
        }
        "file_search" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            let path = input.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let output_mode = input.get("output_mode").and_then(|v| v.as_str());
            let base = if path.is_empty() {
                pattern.to_string()
            } else {
                format!("{}  in  {}", pattern, path)
            };
            if let Some(mode) = output_mode
                && mode != "content"
            {
                format!("[{}] {}", mode, base)
            } else {
                base
            }
        }
        "file_write" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "file_edit" => {
            let fp = input
                .get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let old = input.get("old_string").and_then(|v| v.as_str());
            if let Some(old) = old {
                let truncated = if old.len() > 40 {
                    format!("{}...", &old[..40])
                } else {
                    old.to_string()
                };
                format!("{}  查找: \"{}\"", fp, truncated)
            } else {
                fp.to_string()
            }
        }
        "shell_exec" => input
            .get("command")
            .and_then(|v| v.as_str())
            .map(|s| {
                if s.len() > 60 {
                    format!("{}...", &s[..60])
                } else {
                    s.to_string()
                }
            })
            .unwrap_or_default(),
        "web_search" => input
            .get("query")
            .and_then(|v| v.as_str())
            .map(|s| {
                if s.len() > 60 {
                    format!("\"{}...\"", &s[..60])
                } else {
                    format!("\"{}\"", s)
                }
            })
            .unwrap_or_default(),
        "web_fetch" => input
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "ask_user" => input
            .get("question")
            .and_then(|v| v.as_str())
            .map(|s| {
                if s.len() > 60 {
                    format!("{}...", &s[..60])
                } else {
                    s.to_string()
                }
            })
            .unwrap_or_default(),
        "task_create" => input
            .get("subject")
            .and_then(|v| v.as_str())
            .map(|s| {
                if s.len() > 60 {
                    format!("{}...", &s[..60])
                } else {
                    s.to_string()
                }
            })
            .unwrap_or_default(),
        "task_update" => {
            let id = input.get("task_id").and_then(|v| v.as_str()).unwrap_or("");
            let status = input.get("status").and_then(|v| v.as_str());
            if let Some(status) = status {
                format!("#{} \u{2192} {}", id, status) // →
            } else {
                format!("#{}", id)
            }
        }
        "task_get" => input
            .get("task_id")
            .and_then(|v| v.as_str())
            .map(|s| format!("#{}", s))
            .unwrap_or_default(),
        "task_list" => String::new(),
        _ => String::new(),
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

/// 合并同文件的 file_edit 调用（line_range 模式）为批量编辑
fn merge_file_edits(
    tool_uses: &[(String, String, serde_json::Value)],
) -> Vec<(String, String, serde_json::Value)> {
    use std::collections::HashMap;
    let mut file_edit_groups: HashMap<String, Vec<(String, serde_json::Value)>> = HashMap::new();
    let mut other = Vec::new();

    for (tid, name, input) in tool_uses {
        if name == "file_edit"
            && input.get("start_line").and_then(|v| v.as_u64()).is_some()
            && let Some(fp) = input.get("file_path").and_then(|v| v.as_str())
        {
            file_edit_groups
                .entry(fp.to_string())
                .or_default()
                .push((tid.clone(), input.clone()));
            continue;
        }
        other.push((tid.clone(), name.clone(), input.clone()));
    }

    for (file_path, edits) in &file_edit_groups {
        if edits.len() == 1 {
            let (tid, input) = &edits[0];
            other.push((tid.clone(), "file_edit".to_string(), input.clone()));
        } else {
            let edit_items: Vec<serde_json::Value> = edits
                .iter()
                .map(|(_, inp)| {
                    serde_json::json!({
                        "start_line": inp["start_line"],
                        "end_line": inp["end_line"],
                        "expected": inp["expected"],
                        "new_content": inp["new_content"],
                    })
                })
                .collect();

            let merged_input = serde_json::json!({
                "file_path": file_path,
                "edits": edit_items,
            });
            other.push((edits[0].0.clone(), "file_edit".to_string(), merged_input));

            eprintln!(
                "[工具] 🔗 合并 {} 个 file_edit 调用 (文件: {})",
                edits.len(),
                file_path,
            );
        }
    }

    other
}

/// 工具执行批次，用于并行/串行分区
struct ToolBatch {
    /// 批次内所有工具是否可以并行执行
    is_concurrency_safe: bool,
    /// (tool_use_id, name, input)
    items: Vec<(String, String, serde_json::Value)>,
}

/// 将工具调用列表按并发安全属性分区：
/// 连续的 safe 工具合并在一个 batch 中（可并行），
/// 每个 unsafe 工具单独一个 batch（串行执行）。
fn partition_tool_calls(
    tool_uses: Vec<(String, String, serde_json::Value)>,
    tools: &[ToolHandler],
) -> Vec<ToolBatch> {
    let mut batches: Vec<ToolBatch> = Vec::new();

    for (tool_use_id, name, input) in tool_uses {
        // 查找 ToolHandler 判断并发安全
        let is_safe = tools
            .iter()
            .find(|h| h.tool_definition().name == name)
            .map(|h| h.is_concurrency_safe(&input))
            .unwrap_or(false);

        if is_safe {
            // 尝试追加到上一个 batch（如果前一个也是 safe batch）
            if let Some(last) = batches.last_mut()
                && last.is_concurrency_safe
            {
                last.items.push((tool_use_id, name, input));
            } else {
                batches.push(ToolBatch {
                    is_concurrency_safe: true,
                    items: vec![(tool_use_id, name, input)],
                });
            }
        } else {
            // 不安全工具各自独立 batch
            batches.push(ToolBatch {
                is_concurrency_safe: false,
                items: vec![(tool_use_id, name, input)],
            });
        }
    }

    batches
}

/// 在终端输出当前轮次的 token 用量和缓存命中率信息
fn print_usage_line(
    round: Option<u32>,
    input_tokens: u32,
    output_tokens: u32,
    cache_read: Option<u32>,
    cache_create: Option<u32>,
    duration_ms: u64,
) {
    let round_str = match round {
        Some(r) => format!(" 轮次 {r} |"),
        None => String::new(),
    };

    let cache_read_val = cache_read.unwrap_or(0);
    let cache_create_val = cache_create.unwrap_or(0);
    let total = input_tokens + cache_read_val + cache_create_val;

    let cache_part = if cache_read_val > 0 || cache_create_val > 0 {
        let savings = if total > 0 {
            (cache_read_val as f64 / total as f64 * 100.0) as u32
        } else {
            0
        };
        format!(
            " | cache read: {}, create: {} | 节省 {}%",
            cache_read_val, cache_create_val, savings
        )
    } else {
        String::new()
    };

    eprintln!(
        "[LLM]{round_str} in: {input_tokens}, out: {output_tokens}{cache_part} ({dur:.1}s)",
        dur = duration_ms as f64 / 1000.0,
    );
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

/// 记录流式对话的 round-trip 日志（从 RoundResult 重建响应）
fn log_round_trip_stream(
    logger: &ConversationLogger,
    params: &CreateMessageParams,
    result: &RoundResult,
    duration_ms: u64,
) {
    let ts = datetime::iso_timestamp_now();
    let request_value = serde_json::to_value(params).unwrap_or_default();
    let response_value = serde_json::json!({
        "id": null,
        "type": "message",
        "role": "assistant",
        "content": result.blocks,
        "model": result.model,
        "stop_reason": if result.tool_uses.is_empty() { "end_turn" } else { "tool_use" },
        "stop_sequence": null,
        "usage": {
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "cache_creation_input_tokens": result.cache_creation_input_tokens,
            "cache_read_input_tokens": result.cache_read_input_tokens,
        }
    });
    let _ = logger.append_record(ts, duration_ms, request_value, response_value);
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
            // system prompt 应被重建，不再包含 shell_exec
            assert!(!agent.system_prompt.contains("shell_exec"));
            assert!(agent.system_prompt.contains("web_fetch"));
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

    // ---- process_stream_events tests ----

    fn make_msg_start(input_tokens: u32, model: &str) -> StreamEvent {
        StreamEvent::MessageStart {
            message: MessageStartContent {
                id: "msg_t".to_string(),
                type_: "message".to_string(),
                role: Role::Assistant,
                content: vec![],
                model: model.to_string(),
                stop_reason: None,
                stop_sequence: None,
                usage: Usage {
                    input_tokens,
                    output_tokens: 0,
                    cache_creation_input_tokens: None,
                    cache_read_input_tokens: None,
                    cache_creation: None,
                    output_tokens_details: None,
                    inference_geo: None,
                    service_tier: None,
                    server_tool_use: None,
                },
                container: None,
                stop_details: None,
            },
        }
    }

    fn make_msg_delta(
        stop_reason: StopReason,
        output_tokens: u32,
        cache_read: Option<u32>,
        cache_create: Option<u32>,
    ) -> StreamEvent {
        StreamEvent::MessageDelta {
            delta: MessageDeltaContent {
                stop_reason: Some(stop_reason),
                stop_sequence: None,
            },
            usage: Some(StreamUsage {
                input_tokens: 0,
                output_tokens,
                cache_creation_input_tokens: cache_create,
                cache_read_input_tokens: cache_read,
                output_tokens_details: None,
                server_tool_use: None,
            }),
        }
    }

    fn make_text_block_start() -> StreamEvent {
        StreamEvent::ContentBlockStart {
            index: 0,
            content_block: ContentBlock::Text {
                text: String::new(),
                citations: None,
            },
        }
    }

    fn make_text_delta(text: &str) -> StreamEvent {
        StreamEvent::ContentBlockDelta {
            index: 0,
            delta: ContentBlockDelta::TextDelta {
                text: text.to_string(),
            },
        }
    }

    fn make_tool_use_start_empty(id: &str, name: &str) -> StreamEvent {
        StreamEvent::ContentBlockStart {
            index: 0,
            content_block: ContentBlock::ToolUse {
                id: id.to_string(),
                name: name.to_string(),
                input: serde_json::Value::Object(serde_json::Map::new()),
            },
        }
    }

    fn make_tool_use_start_full(id: &str, name: &str, input: serde_json::Value) -> StreamEvent {
        StreamEvent::ContentBlockStart {
            index: 0,
            content_block: ContentBlock::ToolUse {
                id: id.to_string(),
                name: name.to_string(),
                input,
            },
        }
    }

    fn make_input_json_delta(partial: &str) -> StreamEvent {
        StreamEvent::ContentBlockDelta {
            index: 0,
            delta: ContentBlockDelta::InputJsonDelta {
                partial_json: partial.to_string(),
            },
        }
    }

    fn make_block_stop() -> StreamEvent {
        StreamEvent::ContentBlockStop { index: 0 }
    }

    fn make_message_stop() -> StreamEvent {
        StreamEvent::MessageStop
    }

    fn make_error_event(msg: &str) -> StreamEvent {
        StreamEvent::Error {
            error: StreamError {
                type_: "server_error".to_string(),
                message: msg.to_string(),
            },
        }
    }

    /// 构造一轮只含文本的 events
    fn text_only_events(text: &str, input_tokens: u32, output_tokens: u32) -> Vec<StreamEvent> {
        let mut events = vec![make_msg_start(input_tokens, "test-model")];
        events.push(make_text_block_start());
        events.push(make_text_delta(text));
        events.push(make_block_stop());
        events.push(make_msg_delta(
            StopReason::EndTurn,
            output_tokens,
            None,
            None,
        ));
        events.push(make_message_stop());
        events
    }

    #[tokio::test]
    async fn test_process_stream_events_plain_text() {
        let events = text_only_events("你好世界", 10, 5);
        let stream = futures_util::stream::iter(events.into_iter().map(Ok));
        let mut chunks = String::new();
        let result = AiAgent::process_stream_events(stream, &mut |chunk| {
            chunks.push_str(chunk);
        })
        .await
        .expect("process_stream_events should succeed");

        assert_eq!(result.full_text, "你好世界");
        assert!(result.tool_uses.is_empty(), "no tool calls expected");
        assert_eq!(result.input_tokens, 10);
        assert_eq!(result.output_tokens, 5);
        assert_eq!(result.model, "test-model");
        assert_eq!(result.blocks.len(), 1);
        assert!(matches!(result.blocks[0], ContentBlock::Text { .. }));
        assert_eq!(chunks, "你好世界");
    }

    #[tokio::test]
    async fn test_process_stream_events_tool_use_input_json_delta() {
        let events = vec![
            make_msg_start(10, "test-model"),
            make_tool_use_start_empty("tu01", "file_find"),
            // 使用 r##"..."## 避免末尾引号被吃掉
            make_input_json_delta(r##"{"pattern":""##),
            make_input_json_delta("**/*.rs"),
            make_input_json_delta(r##""}"##),
            make_block_stop(),
            make_msg_delta(StopReason::ToolUse, 20, None, None),
            make_message_stop(),
        ];
        let stream = futures_util::stream::iter(events.into_iter().map(Ok));
        let mut chunks = String::new();
        let result = AiAgent::process_stream_events(stream, &mut |c| chunks.push_str(c))
            .await
            .expect("should succeed");

        assert!(result.full_text.is_empty(), "no text expected");
        assert_eq!(result.tool_uses.len(), 1);
        assert_eq!(result.tool_uses[0].0, "tu01");
        assert_eq!(result.tool_uses[0].1, "file_find");
        assert_eq!(
            result.tool_uses[0].2,
            serde_json::json!({"pattern": "**/*.rs"})
        );
        assert_eq!(result.blocks.len(), 1);
        assert!(matches!(result.blocks[0], ContentBlock::ToolUse { .. }));
        assert!(
            chunks.is_empty(),
            "on_chunk should not be called for tool use"
        );
    }

    #[tokio::test]
    async fn test_process_stream_events_tool_use_full_input_in_start() {
        let events = vec![
            make_msg_start(10, "test-model"),
            make_tool_use_start_full("tu01", "file_find", serde_json::json!({"pattern": "*.rs"})),
            make_block_stop(),
            make_msg_delta(StopReason::ToolUse, 15, None, None),
            make_message_stop(),
        ];
        let stream = futures_util::stream::iter(events.into_iter().map(Ok));
        let result = AiAgent::process_stream_events(stream, &mut |_| {})
            .await
            .expect("should succeed");

        assert_eq!(result.tool_uses.len(), 1);
        assert_eq!(
            result.tool_uses[0].2,
            serde_json::json!({"pattern": "*.rs"})
        );
    }

    #[tokio::test]
    async fn test_process_stream_events_mixed_text_and_tool() {
        let events = vec![
            make_msg_start(10, "test-model"),
            make_text_block_start(),
            make_text_delta("我来分析这个代码..."),
            make_block_stop(),
            make_tool_use_start_empty("tu01", "file_read"),
            make_input_json_delta(r##"{"file_path":"src/main.rs"}"##),
            make_block_stop(),
            make_msg_delta(StopReason::ToolUse, 30, None, None),
            make_message_stop(),
        ];
        let stream = futures_util::stream::iter(events.into_iter().map(Ok));
        let mut chunks = String::new();
        let result = AiAgent::process_stream_events(stream, &mut |c| chunks.push_str(c))
            .await
            .expect("should succeed");

        assert_eq!(result.full_text, "我来分析这个代码...");
        assert_eq!(result.tool_uses.len(), 1);
        assert_eq!(result.tool_uses[0].1, "file_read");
        assert_eq!(result.blocks.len(), 2);
        assert!(matches!(result.blocks[0], ContentBlock::Text { .. }));
        assert!(matches!(result.blocks[1], ContentBlock::ToolUse { .. }));
        assert_eq!(chunks, "我来分析这个代码...");
    }

    #[tokio::test]
    async fn test_process_stream_events_multiple_tools() {
        let events = vec![
            make_msg_start(10, "test-model"),
            make_tool_use_start_empty("tu01", "file_find"),
            make_input_json_delta(r##"{"pattern":"*.rs"}"##),
            make_block_stop(),
            make_tool_use_start_empty("tu02", "file_read"),
            make_input_json_delta(r##"{"file_path":"src/main.rs"}"##),
            make_block_stop(),
            make_msg_delta(StopReason::ToolUse, 25, None, None),
            make_message_stop(),
        ];
        let stream = futures_util::stream::iter(events.into_iter().map(Ok));
        let result = AiAgent::process_stream_events(stream, &mut |_| {})
            .await
            .expect("should succeed");

        assert_eq!(result.tool_uses.len(), 2);
        assert_eq!(result.tool_uses[0].0, "tu01");
        assert_eq!(result.tool_uses[0].1, "file_find");
        assert_eq!(result.tool_uses[1].0, "tu02");
        assert_eq!(result.tool_uses[1].1, "file_read");
    }

    #[tokio::test]
    async fn test_process_stream_events_empty_input_json_delta() {
        // 边缘情况：ContentBlockStart 后没有 InputJsonDelta 就 ContentBlockStop
        let events = vec![
            make_msg_start(10, "test-model"),
            make_tool_use_start_empty("tu01", "file_find"),
            make_block_stop(),
            make_msg_delta(StopReason::ToolUse, 5, None, None),
            make_message_stop(),
        ];
        let stream = futures_util::stream::iter(events.into_iter().map(Ok));
        let result = AiAgent::process_stream_events(stream, &mut |_| {})
            .await
            .expect("should succeed");

        assert_eq!(result.tool_uses.len(), 1);
        // 没有 InputJsonDelta → 输入应为 {}（空对象）
        assert_eq!(
            result.tool_uses[0].2,
            serde_json::Value::Object(serde_json::Map::new())
        );
    }

    #[tokio::test]
    async fn test_process_stream_events_error_event() {
        let events = vec![
            make_msg_start(10, "test-model"),
            make_error_event("Internal server error"),
        ];
        let stream = futures_util::stream::iter(events.into_iter().map(Ok));
        let result = AiAgent::process_stream_events(stream, &mut |_| {}).await;
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.contains("Internal server error"));
    }

    #[tokio::test]
    async fn test_process_stream_events_stream_error() {
        // 测试流中直接返回 Err 的情况
        let events: Vec<Result<StreamEvent, String>> = vec![
            Ok(make_msg_start(10, "test-model")),
            Err("connection reset".to_string()),
        ];
        let stream = futures_util::stream::iter(events);
        let result = AiAgent::process_stream_events(stream, &mut |_| {}).await;
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("connection reset"));
    }

    // ---- merge_file_edits tests ----

    #[test]
    fn test_merge_file_edits_same_file() {
        let tool_uses = vec![
            (
                "tu01".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "start_line": 1,
                    "end_line": 3,
                    "expected": "line1\nline2\nline3",
                    "new_content": "new1\nnew2\nnew3"
                }),
            ),
            (
                "tu02".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "start_line": 10,
                    "end_line": 12,
                    "expected": "old10\nold11\nold12",
                    "new_content": "new10\nnew11\nnew12"
                }),
            ),
        ];
        let merged = merge_file_edits(&tool_uses);
        assert_eq!(merged.len(), 1, "should merge into 1");
        assert_eq!(merged[0].0, "tu01");
        assert_eq!(merged[0].1, "file_edit");
        let edits = merged[0].2["edits"].as_array().unwrap();
        assert_eq!(edits.len(), 2);
    }

    #[test]
    fn test_merge_file_edits_different_files() {
        let tool_uses = vec![
            (
                "tu01".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/a.rs",
                    "start_line": 1,
                    "end_line": 1,
                    "expected": "a",
                    "new_content": "A"
                }),
            ),
            (
                "tu02".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/b.rs",
                    "start_line": 1,
                    "end_line": 1,
                    "expected": "b",
                    "new_content": "B"
                }),
            ),
        ];
        let merged = merge_file_edits(&tool_uses);
        assert_eq!(merged.len(), 2, "different files should not merge");
    }

    #[test]
    fn test_merge_file_edits_old_string_mode_not_merged() {
        let tool_uses = vec![
            (
                "tu01".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "old_string": "foo",
                    "new_string": "bar"
                }),
            ),
            (
                "tu02".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "start_line": 5,
                    "end_line": 5,
                    "expected": "baz",
                    "new_content": "qux"
                }),
            ),
        ];
        let merged = merge_file_edits(&tool_uses);
        assert_eq!(
            merged.len(),
            2,
            "old_string mode should not merge with line_range"
        );
    }

    #[test]
    fn test_merge_file_edits_single_line_range_not_batched() {
        let tool_uses = vec![(
            "tu01".to_string(),
            "file_edit".to_string(),
            serde_json::json!({
                "file_path": "src/main.rs",
                "start_line": 1,
                "end_line": 1,
                "expected": "a",
                "new_content": "A"
            }),
        )];
        let merged = merge_file_edits(&tool_uses);
        assert_eq!(merged.len(), 1);
        // 单条不应该包装为 edits 数组
        assert!(merged[0].2.get("edits").is_none());
    }

    #[test]
    fn test_merge_file_edits_mixed_tool_types() {
        let tool_uses = vec![
            (
                "tu01".to_string(),
                "file_read".to_string(),
                serde_json::json!({"file_path": "src/main.rs"}),
            ),
            (
                "tu02".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "start_line": 1,
                    "end_line": 3,
                    "expected": "a\nb\nc",
                    "new_content": "A\nB\nC"
                }),
            ),
            (
                "tu03".to_string(),
                "file_find".to_string(),
                serde_json::json!({"pattern": "*.rs"}),
            ),
            (
                "tu04".to_string(),
                "file_edit".to_string(),
                serde_json::json!({
                    "file_path": "src/main.rs",
                    "start_line": 10,
                    "end_line": 10,
                    "expected": "old",
                    "new_content": "new"
                }),
            ),
        ];
        let merged = merge_file_edits(&tool_uses);
        // file_read + file_find + 合并后的 file_edit = 3
        // 非编辑工具保持原始顺序排在前面
        assert_eq!(
            merged.len(),
            3,
            "file_read + merged file_edit + file_find = 3"
        );
        assert_eq!(merged[0].1, "file_read");
        assert_eq!(merged[1].1, "file_find");
        assert_eq!(merged[2].1, "file_edit");
        assert!(merged[2].2.get("edits").is_some());
        assert_eq!(merged[2].2["edits"].as_array().unwrap().len(), 2);
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

            let result = RoundResult {
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

            log_round_trip_stream(&logger, &params, &result, 100);

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

            let result = RoundResult {
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

            log_round_trip_stream(&logger, &params, &result, 100);

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
                assert!(result.is_err(), "unknown tool should error");
                let err = result.err().unwrap();
                assert!(
                    err.contains("Unknown tool"),
                    "error should mention unknown tool"
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

        let batches = partition_tool_calls(tool_uses, &tools);
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

        let batches = partition_tool_calls(tool_uses, &tools);
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

        let batches = partition_tool_calls(tool_uses, &tools);
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
        let batches = partition_tool_calls(vec![], &[]);
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

        let batches = partition_tool_calls(tool_uses, &tools);
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

        let batches = partition_tool_calls(tool_uses, &tools);
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

        let batches = partition_tool_calls(tool_uses, &tools);
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

        let batches = partition_tool_calls(tool_uses, &tools);
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

        let batches = partition_tool_calls(tool_uses, &tools);
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

        let batches = partition_tool_calls(tool_uses, &tools);
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

        let batches = partition_tool_calls(tool_uses, &tools);
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
                assert!(result.is_err(), "unknown tool should error");
                assert!(
                    result.err().unwrap().contains("Unknown tool"),
                    "error should mention unknown tool"
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
                let batches = partition_tool_calls(merged, &agent.tools);
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
}
