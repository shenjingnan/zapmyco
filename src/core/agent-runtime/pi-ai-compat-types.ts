/**
 * pi-ai 兼容类型定义
 *
 * 临时桥接层：在逐步移除 @earendil-works/pi-ai 依赖的过程中，
 * 提供与 pi-ai 类型结构相匹配的本地类型定义。
 *
 * 当所有 pi-ai 运行时依赖（streamSimple、getModel 等）移除后，
 * 此文件将被删除，类型将逐步迁移到 @anthropic-ai/sdk 原生类型。
 *
 * 注意：不包含 [key: string]: unknown 索引签名，
 * 以保持与 pi-ai 原始类型一致，同时避免 exactOptionalPropertyTypes 下的类型兼容性问题。
 *
 * @module core/agent-runtime/pi-ai-compat-types
 */

// ============ Usage ============

export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

// ============ 内容块 ============

export interface PiTextContent {
  type: 'text';
  text: string;
}

export interface PiImageContent {
  type: 'image';
  source?: {
    type: 'base64';
    mediaType: string;
    data: string;
  };
}

/** 工具调用块（AssistantMessage.content 中的 toolCall 类型） */
export interface PiToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ============ 工具 ============

export interface PiTool<TParameters = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: TParameters;
}

// ============ 消息 ============

export interface PiAssistantMessage {
  role: 'assistant';
  content: Array<PiTextContent | PiImageContent | PiToolCallBlock>;
  usage?: PiUsage;
  stopReason?: string;
  model?: string;
  api?: string;
  provider?: string;
  timestamp?: number;
}

export interface PiToolResultMessage {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: Array<PiTextContent | PiImageContent>;
  isError?: boolean;
  timestamp?: number;
}

export type PiMessage =
  | {
      role: 'user';
      content: string | Array<PiTextContent | PiImageContent>;
    }
  | PiAssistantMessage
  | PiToolResultMessage;

// ============ 模型 ============

export interface PiModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface PiModel {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: string[];
  cost: PiModelCost;
  contextWindow: number;
  maxTokens: number;
}

// ============ Agent 配置类型 ============

export type PiThinkingLevel = 'off' | 'low' | 'medium' | 'high';

// biome-ignore lint/suspicious/noExplicitAny: 兼容 pi-ai 的宽松类型定义
export type PiThinkingBudgets = Record<string, any>;

export type PiTransport = string;

// ============ 兼容别名（与 pi-ai 类型名一致，便于逐步替换） ============

export type {
  PiAssistantMessage as AssistantMessage,
  PiImageContent as ImageContent,
  PiMessage as Message,
  PiModel as Model,
  PiTextContent as TextContent,
  PiThinkingBudgets as ThinkingBudgets,
  PiThinkingLevel as ThinkingLevel,
  PiTool as Tool,
  PiToolResultMessage as ToolResultMessage,
  PiTransport as Transport,
  PiUsage as Usage,
};
