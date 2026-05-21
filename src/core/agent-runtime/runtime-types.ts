/**
 * Agent 运行时本地类型定义
 *
 * 提供 Agent 运行时所使用的类型定义，包括消息、模型、Usage 等。
 *
 * @module core/agent-runtime/runtime-types
 */

// ============ Usage ============

export interface Usage {
  input: number;
  output: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: {
    input: number;
    output: number;
    total: number;
  };
}

// ============ 内容块 ============

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source?: {
    type: 'base64';
    mediaType: string;
    data: string;
  };
}

/** 工具调用块（AssistantMessage.content 中的 toolCall 类型） */
export interface ToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ============ 工具 ============

export interface Tool<TParameters = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: TParameters;
}

// ============ 消息 ============

export interface AssistantMessage {
  role: 'assistant';
  content: Array<TextContent | ImageContent | ToolCallBlock>;
  usage?: Usage;
  stopReason?: string;
  model?: string;
  api?: string;
  provider?: string;
  timestamp?: number;
}

export interface ToolResultMessage {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: Array<TextContent | ImageContent>;
  isError?: boolean;
  timestamp?: number;
}

export type Message =
  | {
      role: 'user';
      content: string | Array<TextContent | ImageContent>;
    }
  | AssistantMessage
  | ToolResultMessage;

// ============ 模型 ============

export interface ModelCost {
  input: number;
  output: number;
}

export interface Model {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: string[];
  cost: ModelCost;
  contextWindow: number;
  maxTokens: number;
}

// ============ Agent 配置类型 ============

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

// biome-ignore lint/suspicious/noExplicitAny: 兼容宽松类型定义
export type ThinkingBudgets = Record<string, any>;

export type Transport = string;
