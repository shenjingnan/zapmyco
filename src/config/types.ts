/**
 * zapmyco 配置类型定义
 */

import type { KnownProvider } from '@mariozechner/pi-ai';

/** 单个模型配置 */
export interface ModelConfig {
  /** 提供商标识（对应 pi-ai 的 Provider，决定 API 格式） */
  provider: KnownProvider | string;
  /** 模型 ID（发送给 API 的模型名称） */
  modelId: string;
  /** 模型描述 */
  description?: string;
  /**
   * 自定义 API 基础 URL
   *
   * 设置后覆盖 pi-ai 默认的 baseUrl。
   * 典型用法：使用 Anthropic 消息格式连接兼容端点（如 Deepseek）
   *
   * @example "https://api.deepseek.com/anthropic"
   */
  baseUrl?: string;
}

/** LLM 提供商认证配置 */
export interface LlmProviderAuthConfig {
  /** API Key（支持 ${ENV_VAR} 环境变量引用） */
  apiKey?: string;
  /** API 基础 URL（自定义提供商时使用） */
  baseUrl?: string;
}

/** LLM 全局默认参数 */
export interface LlmDefaultsConfig {
  /** 最大生成 token 数 */
  maxTokens?: number;
  /** 温度参数（0-1） */
  temperature?: number;
}

/** LLM 配置（基于 pi-ai 多模型架构） */
export interface LlmConfig {
  /** 默认使用的模型标识（格式：provider/modelId，如 anthropic/claude-sonnet-4-20250514） */
  defaultModel: string;

  /** 所有可用模型配置（key 为 "provider/modelId" 格式） */
  models: Record<string, ModelConfig>;

  /** 各提供商的认证信息 */
  providers: Partial<Record<KnownProvider | string, LlmProviderAuthConfig>>;

  /** 全局 LLM 调用默认参数 */
  defaults?: LlmDefaultsConfig;
}

/**
 * @deprecated 使用 LlmConfig 替代
 * 保留向后兼容，内部会自动转换
 */
export interface LlmProviderConfig {
  /** 提供商类型 */
  provider: 'anthropic' | 'openai' | 'custom';
  /** API Key（也可通过环境变量 ANTHROPIC_API_KEY 等设置） */
  apiKey?: string;
  /** API 基础 URL（自定义提供商时使用） */
  baseUrl?: string;
  /** 默认模型（不设置则使用提供商默认模型） */
  model?: string | undefined;
}

/** 调度器配置 */
export interface SchedulerConfig {
  /** 最大并行任务数 */
  maxConcurrency: number;
  /** 单个 Agent 最大同时执行数 */
  maxPerAgent: number;
  /** 默认任务超时时间（毫秒） */
  taskTimeoutMs: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试基础延迟（毫秒） */
  retryBaseDelayMs: number;
}

/** Agent 运行时配置（基于 pi-agent-core） */
export interface AgentRuntimeConfig {
  /** 是否启用 Agent 运行时 */
  enabled: boolean;
  /** 工具执行策略：顺序或并行 */
  toolExecution?: 'sequential' | 'parallel';
  /** agentLoop 最大轮次（防止无限循环） */
  maxTurns?: number;
  /** 推理级别 */
  thinkingLevel?: string;
}

/** Agent 配置 */
export interface AgentConfig {
  /** Agent ID */
  id: string;
  /** 是否启用 */
  enabled: boolean;
  /** 自定义端点（覆盖默认） */
  endpoint?: string;
  /** 自定义配置参数 */
  params?: Record<string, unknown>;
}

/** 单个 MCP Server 配置 */
export interface McpServerConfig {
  /** Server 逻辑名称（用于工具命名：mcp__{name}__{tool}） */
  name: string;
  /** 传输类型（默认 'stdio'） */
  transport?: 'stdio';
  /** 启动命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 注入 server 进程的环境变量 */
  env?: Record<string, string>;
  /** server 进程工作目录 */
  cwd?: string;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 连接超时（毫秒，默认 15000） */
  connectTimeoutMs?: number;
}

/**
 * MCP 客户端配置（兼容两种格式）
 *
 * 格式 A — 标准 key-value（推荐，与 Claude Code 兼容）：
 * ```json
 * { "mcp": { "server-a": { "command": "npx", "args": [...] } } }
 * ```
 *
 * 格式 B — 显式 servers 数组：
 * ```json
 * { "mcp": { "servers": [{ "name": "server-a", "command": "npx", "args": [...] }] } }
 * ```
 */
export interface McpConfig {
  /** MCP Server 列表（格式 B）或 key-value 映射（格式 A） */
  servers?: McpServerConfig[];
  /** key-value 格式：key 为 server name，value 为配置 */
  [serverName: string]: McpServerConfig | McpServerConfig[] | undefined;
}

/**
 * 将用户配置的 MCP 格式标准化为 McpServerConfig 数组
 *
 * 支持两种输入格式自动检测：
 * - `{ servers: [...] }` → 直接返回数组
 * - `{ "server-a": {...}, "server-b": {...} }` → 以 key 作为 name 转换为数组
 */
export function normalizeMcpConfig(raw: McpConfig): McpServerConfig[] {
  // 格式 B：显式 servers 数组
  if (raw.servers && Array.isArray(raw.servers) && raw.servers.length > 0) {
    return raw.servers;
  }

  // 格式 A：key-value，key 为 server name
  const servers: McpServerConfig[] = [];
  for (const [key, value] of Object.entries(raw)) {
    // 跳过保留字段
    if (key === 'servers') continue;
    if (value === null || value === undefined || typeof value !== 'object') continue;
    // 跳过数组（不是 server 配置）
    if (Array.isArray(value)) continue;
    const config = value as unknown as Record<string, unknown>;
    if (typeof config.command !== 'string') continue;

    const server: McpServerConfig = {
      name: key,
      transport: 'stdio',
      command: config.command as string,
    };
    if (Array.isArray(config.args)) server.args = config.args as string[];
    if (config.env && typeof config.env === 'object')
      server.env = config.env as Record<string, string>;
    if (typeof config.cwd === 'string') server.cwd = config.cwd;
    if (typeof config.enabled === 'boolean') server.enabled = config.enabled;
    if (typeof config.connectTimeoutMs === 'number')
      server.connectTimeoutMs = config.connectTimeoutMs;
    servers.push(server);
  }
  return servers;
}

/** Skill 系统配置 */
export interface SkillConfig {
  /** 是否启用（默认 true） */
  enabled: boolean;
  /** 额外加载目录 */
  loadDirs?: string[];
  /** 系统提示中最大技能数（默认 50） */
  maxSkillsInPrompt?: number;
  /** SKILL.md 文件最大大小（字节，默认 256KB） */
  maxSkillFileBytes?: number;
  /** 每技能配置 */
  entries?: Record<string, { enabled?: boolean }>;
}

/** Sub-Agent 系统配置 */
export interface SubAgentConfig {
  /** 是否启用 spawn_subagents 工具（默认 true） */
  enabled: boolean;
  /** 最大并行子 Agent 数（默认 5） */
  maxConcurrent: number;
  /** 单个子 Agent 超时时间（毫秒，默认 300000 = 5 分钟） */
  taskTimeoutMs: number;
  /** 子 Agent 输出最大字符数（防止上下文爆炸，默认 5000） */
  maxOutputChars: number;
  /** 子 Agent 最大对话轮次（防止无限循环，默认 30） */
  maxTurns: number;
  /** 是否允许子 Agent 递归创建孙 Agent（默认 false） */
  allowRecursiveSpawn: boolean;
}

/** CLI 配置 */
export interface CliConfig {
  /** 是否启用颜色输出 */
  color: boolean;
  /** 是否启用调试模式 */
  debug: boolean;
  /** 输出格式 */
  outputFormat: 'text' | 'json';
}

/**
 * zapmyco 完整配置
 *
 * 配置加载优先级：
 * 1. 命令行参数（最高）
 * 2. 项目级配置文件 (zapmyco.config.*)
 * 3. 用户家目录配置 (~/.zapmyco/zapmyco.json)
 * 4. 默认值（最低）
 */
export interface ZapmycoConfig {
  /** LLM 配置（新格式，基于 pi-ai 多模型） */
  llm: LlmConfig;

  /** @deprecated 向后兼容字段，优先使用 llm */
  _legacyLlm?: LlmProviderConfig;

  /** 调度器配置 */
  scheduler: SchedulerConfig;

  /** 已注册的 Agent 配置列表 */
  agents: AgentConfig[];

  /** Agent 运行时配置（pi-agent-core 集成） */
  agentRuntime?: AgentRuntimeConfig;

  /** CLI 配置 */
  cli: CliConfig;

  /** Web 工具配置 */
  web?: WebConfig;

  /** MCP 客户端配置 */
  mcp?: McpConfig;

  /** Skill 系统配置 */
  skill?: SkillConfig;

  /** Sub-Agent 系统配置 */
  subAgent?: SubAgentConfig;
}

/** Web 工具配置 */
export interface WebConfig {
  /** 是否启用 web_fetch 和 web_search 工具 */
  enabled: boolean;

  /** web_fetch 子配置 */
  fetch?: {
    /** 单次请求超时时间（毫秒） */
    timeoutMs?: number;
    /** 最大响应体大小（字节） */
    maxResponseBytes?: number;
    /** 提取内容的最大字符数 */
    maxChars?: number;
    /** 是否启用正文提取（提取 <main>/<article> 内容） */
    extractMainContent?: boolean;
    /** 自定义 User-Agent */
    userAgent?: string;
    /** 最大重定向次数 */
    maxRedirects?: number;
    /** 缓存 TTL（分钟，默认 15） */
    cacheTtlMinutes?: number;
  };

  /** web_search 子配置 */
  search?: {
    /**
     * 搜索引擎 provider 名称
     *
     * 内置选项:
     * - tavily: Tavily 搜索 API（需 API Key，默认）
     * - serpAPI: SerpAPI（需 API Key）
     * - duckduckgo: DuckDuckGo HTML 抓取（免费，无需 Key）
     * - custom: 用户自建端点
     */
    provider?: 'tavily' | 'serpapi' | 'duckduckgo' | 'custom';
    /** API Key（支持 ${ENV_VAR} 引用，duckduckgo 不需要） */
    apiKey?: string;
    /** 自定义搜索端点（provider=custom 时使用） */
    endpointUrl?: string;
    /** 每次搜索返回的最大结果数（1-20，默认 8） */
    maxResults?: number;
    /** 搜索语言偏好 */
    language?: string;
    /** 缓存 TTL（分钟，默认 15） */
    cacheTtlMinutes?: number;
  };

  /** SSRF 防护配置 */
  ssrf?: {
    /** 是否允许访问私有 IP 地址 */
    allowPrivateNetwork?: boolean;
    /** 允许访问的域名白名单（支持 *.example.com 通配符） */
    allowedDomains?: string[];
    /** 禁止访问的域名黑名单 */
    blockedDomains?: string[];
  };
}
