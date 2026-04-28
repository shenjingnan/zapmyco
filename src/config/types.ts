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

  /** CLI 配置 */
  cli: CliConfig;
}
