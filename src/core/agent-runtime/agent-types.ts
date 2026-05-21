/**
 * Agent 运行时类型定义
 *
 * 本地 Agent 运行时类型系统。
 *
 * @module core/agent-runtime/agent-types
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Static, TSchema } from 'typebox';
import type { ResolvedModel } from '@/llm/provider-types';
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingBudgets,
  ThinkingLevel,
  Tool,
  ToolResultMessage,
} from './runtime-types';

// ============ 消息类型 ============

/**
 * 自定义摘要消息
 */
export interface SummaryMessage {
  role: 'summary';
  text: string;
  timestamp: number;
}

/**
 * 用户消息（简化定义）
 */
export interface UserMessage {
  role: 'user';
  content: string | Array<TextContent | ImageContent>;
  timestamp: number;
}

/**
 * AgentMessage — 会话中的消息类型联合
 *
 * 支持自定义角色（如 summary）。
 */
export type AgentMessage =
  | AssistantMessage
  | ToolResultMessage
  | UserMessage
  | SummaryMessage
  | { role: string; content?: unknown; text?: string; timestamp?: number; [key: string]: unknown };

// ============ 工具调用 ============

/** 从 assistant 消息中提取的单个工具调用 */
export type AgentToolCall = Extract<AssistantMessage['content'][number], { type: 'toolCall' }>;

// ============ 工具执行结果 ============

/** 工具执行结果 */
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
  terminate?: boolean;
}

/** 工具执行进度回调 */
export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

// ============ 工具定义 ============

/** 工具执行模式 */
export type ToolExecutionMode = 'sequential' | 'parallel';

/** Agent 工具定义 */
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = unknown>
  extends Tool<TParameters> {
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>
  ) => Promise<AgentToolResult<TDetails>>;
  executionMode?: ToolExecutionMode;
}

// ============ Agent 状态 ============

/**
 * Agent 状态
 *
 * tools 和 messages 使用存取器（accessor）实现，
 * 赋值时会复制顶层数组。
 */
export interface AgentState {
  systemPrompt: string;
  model: ResolvedModel;
  thinkingLevel: ThinkingLevel;
  set tools(tools: AgentTool[]);
  get tools(): AgentTool[];
  set messages(messages: AgentMessage[]);
  get messages(): AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage: AgentMessage | undefined;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage: string | undefined;
}

// ============ Agent 事件 ============

/**
 * Agent 生命周期事件
 */
export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: AgentMessage[] }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: 'message_start'; message: AgentMessage }
  | {
      type: 'message_update';
      message: AgentMessage;
      assistantMessageEvent: Anthropic.RawMessageStreamEvent;
    }
  | { type: 'message_end'; message: AgentMessage }
  | {
      type: 'tool_execution_start';
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: 'tool_execution_update';
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    };

// ============ Agent 上下文和配置 ============

/** Agent 上下文快照 */
export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool[];
}

/** beforeToolCall 上下文 */
export interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  context: AgentContext;
}

/** beforeToolCall 结果 */
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

/** afterToolCall 上下文 */
export interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  result: AgentToolResult<unknown>;
  isError: boolean;
  context: AgentContext;
}

/** afterToolCall 结果 */
export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}

/** shouldStopAfterTurn 上下文 */
export interface ShouldStopAfterTurnContext {
  message: AssistantMessage;
  toolResults: ToolResultMessage[];
  context: AgentContext;
  newMessages: AgentMessage[];
}

/** Agent 循环配置 */
export interface AgentLoopConfig {
  model: ResolvedModel;
  reasoning: ThinkingLevel | undefined;
  sessionId: string | undefined;
  cacheRetention?: 'none' | 'short' | 'long';
  transformContext:
    | ((messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>)
    | undefined;
  convertToLlm:
    | ((messages: AgentMessage[]) => Anthropic.MessageParam[] | Promise<Anthropic.MessageParam[]>)
    | undefined;
  getApiKey: ((provider: string) => Promise<string | undefined> | string | undefined) | undefined;
  shouldStopAfterTurn:
    | ((context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>)
    | undefined;
  getSteeringMessages: (() => Promise<AgentMessage[]>) | undefined;
  getFollowUpMessages: (() => Promise<AgentMessage[]>) | undefined;
  toolExecution: ToolExecutionMode | undefined;
  beforeToolCall:
    | ((
        context: BeforeToolCallContext,
        signal?: AbortSignal
      ) => Promise<BeforeToolCallResult | undefined>)
    | undefined;
  afterToolCall:
    | ((
        context: AfterToolCallContext,
        signal?: AbortSignal
      ) => Promise<AfterToolCallResult | undefined>)
    | undefined;
  apiKey: string | undefined;
  signal: AbortSignal | undefined;
  /** LLM 流式调用超时（毫秒） */
  timeoutMs?: number;
  maxTokens: number | undefined;
  temperature: number | undefined;
  thinkingBudgets: ThinkingBudgets | undefined;
  maxRetryDelayMs: number | undefined;
}

// ============ Agent 选项（用于 Agent 类构造函数） ============

/** Agent 构造函数选项 */
export interface AgentOptions {
  initialState?: Partial<AgentState>;
  cacheRetention?: 'none' | 'short' | 'long';
  convertToLlm?: (
    messages: AgentMessage[]
  ) => Anthropic.MessageParam[] | Promise<Anthropic.MessageParam[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  streamFn?: StreamFn;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal
  ) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal
  ) => Promise<AfterToolCallResult | undefined>;
  steeringMode?: 'all' | 'one-at-a-time';
  followUpMode?: 'all' | 'one-at-a-time';
  sessionId?: string;
  thinkingBudgets?: ThinkingBudgets;
  maxRetryDelayMs?: number;
  toolExecution?: ToolExecutionMode;
}

// ============ 流函数类型 ============

/** Agent 循环使用的流函数 */
export type StreamFn = (
  model: ResolvedModel,
  params: {
    systemPrompt?: string;
    messages: Anthropic.MessageParam[];
    tools?: Anthropic.Tool[];
    cacheRetention?: 'none' | 'short' | 'long';
  },
  options?: {
    signal?: AbortSignal;
    maxTokens?: number;
    temperature?: number;
    apiKey?: string;
    timeoutMs?: number;
  }
) =>
  | AsyncIterable<Anthropic.RawMessageStreamEvent>
  | Promise<AsyncIterable<Anthropic.RawMessageStreamEvent>>;
