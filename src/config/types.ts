/**
 * zapmyco 配置类型定义
 */

/** LLM 提供商配置 */
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
 * 3. 用户级配置文件 (~/.zapmyco/config.*)
 * 4. 默认值（最低）
 */
export interface ZapmycoConfig {
  /** LLM 提供商配置 */
  llm: LlmProviderConfig;
  /** 调度器配置 */
  scheduler: SchedulerConfig;
  /** 已注册的 Agent 配置列表 */
  agents: AgentConfig[];
  /** CLI 配置 */
  cli: CliConfig;
}
