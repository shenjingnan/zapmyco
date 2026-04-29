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
