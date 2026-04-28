/**
 * LLM 抽象层类型定义
 */

/** 聊天消息角色 */
export type ChatRole = 'system' | 'user' | 'assistant';

/** 聊天消息内容 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** 结构化输出模式 */
export interface StructuredOutputSchema<T = unknown> {
  name: string;
  schema: T; // JSON Schema 对象
  strict?: boolean;
}

/** LLM 响应 */
export interface LlmResponse<T = string> {
  /** 响应内容（文本或结构化对象） */
  content: T;
  /** 输入 Token 数 */
  inputTokens: number;
  /** 输出 Token 数 */
  outputTokens: number;
  /** 模型名称 */
  model: string;
  /** 响应 ID（用于追踪） */
  id?: string;
  /** 是否被截断 */
  truncated?: boolean;
}

/** Token 使用量统计 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 估算成本（美元） */
  estimatedCostUsd: number;
}

/** LLM 调用选项 */
export interface LlmCallOptions {
  /** 要使用的模型（覆盖默认模型） */
  model?: string;
  /** 最大生成 token 数 */
  maxTokens?: number;
  /** 温度参数（0-1） */
  temperature?: number;
  /** 结构化输出配置 */
  structuredOutput?: StructuredOutputSchema;
  /** 是否启用流式输出 */
  stream?: boolean;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 取消信号（用于中断流式请求） */
  signal?: AbortSignal;
}
