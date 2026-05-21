/**
 * Agent 类 — 有状态的 Agent 运行时
 *
 * 包装底层 Agent 循环（agent-loop.ts）提供完整生命周期管理。
 *
 * @module core/agent-runtime/agent
 */

import type Anthropic from '@anthropic-ai/sdk';
import { logger } from '@/infra/logger';
import type { ResolvedModel } from '@/llm/provider-types';
import { runAgentLoop, runAgentLoopContinue } from './agent-loop';
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentOptions,
  AgentState,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
  StreamFn,
  ToolExecutionMode,
} from './agent-types';
import type { ImageContent, TextContent, ThinkingBudgets, ThinkingLevel } from './runtime-types';

// ============ 默认值 ============

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, total: 0 },
};

const DEFAULT_MODEL: ResolvedModel = {
  id: 'unknown',
  provider: 'unknown',
};

// ============ 默认消息转换 ============

function defaultConvertToLlm(messages: AgentMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  // 累积连续 toolResult 消息，合并为一条 user 消息
  // DeepSeek 兼容端点要求同一条 assistant 消息的所有 tool_result 在紧随其后的同一条 user 消息中
  const pendingToolResults: Anthropic.ContentBlockParam[] = [];

  function flushToolResults(): void {
    if (pendingToolResults.length > 0) {
      result.push({ role: 'user', content: [...pendingToolResults] });
      pendingToolResults.length = 0;
    }
  }

  for (const msg of messages) {
    const raw = msg as Record<string, unknown>;
    const role = raw.role as string;
    const content = raw.content;

    if (role === 'user') {
      flushToolResults();
      if (typeof content === 'string') {
        result.push({ role: 'user', content });
      } else if (Array.isArray(content)) {
        const textParts = content
          .filter((c: Record<string, unknown>) => c.type === 'text' || c.type === 'thinking')
          .map((c: Record<string, unknown>) => String(c.text ?? c.thinking ?? ''));
        result.push({ role: 'user', content: textParts.join('\n') });
      }
    } else if (role === 'assistant') {
      flushToolResults();
      const assistantContent: Anthropic.ContentBlockParam[] = [];
      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === 'text') {
            assistantContent.push({ type: 'text', text: String(block.text ?? '') });
          } else if (block.type === 'thinking') {
            assistantContent.push({
              type: 'thinking',
              thinking: String((block as Record<string, unknown>).thinking ?? ''),
              signature: String((block as Record<string, unknown>).signature ?? ''),
            });
          } else if (block.type === 'toolCall') {
            assistantContent.push({
              type: 'tool_use',
              id: String(block.id ?? ''),
              name: String(block.name ?? ''),
              input: (block.arguments as Record<string, unknown>) ?? {},
            });
          }
        }
      }
      result.push({ role: 'assistant', content: assistantContent });
    } else if (role === 'toolResult') {
      let toolBlock: Anthropic.ContentBlockParam;
      if (typeof content === 'string') {
        toolBlock = { type: 'tool_result', tool_use_id: String(raw.toolCallId ?? ''), content };
      } else if (Array.isArray(content)) {
        const textBlocks: Anthropic.TextBlockParam[] = [];
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === 'text') {
            textBlocks.push({ type: 'text', text: String(block.text ?? '') });
          }
        }
        toolBlock = {
          type: 'tool_result',
          tool_use_id: String(raw.toolCallId ?? ''),
          content: textBlocks.length > 0 ? textBlocks : '',
        };
      } else {
        toolBlock = {
          type: 'tool_result',
          tool_use_id: String(raw.toolCallId ?? ''),
          content: '',
        };
      }
      pendingToolResults.push(toolBlock);
    }
  }

  flushToolResults();
  return result;
}

// ============ 队列模式 ============

type QueueMode = 'all' | 'one-at-a-time';

// ============ 可变 AgentState ============

type MutableAgentState = Omit<AgentState, 'isStreaming' | 'pendingToolCalls'> & {
  isStreaming: boolean;
  streamingMessage: AgentMessage | undefined;
  pendingToolCalls: Set<string>;
  errorMessage: string | undefined;
};

function createMutableAgentState(
  initialState?: Partial<
    Omit<AgentState, 'pendingToolCalls' | 'isStreaming' | 'streamingMessage' | 'errorMessage'>
  >
): MutableAgentState {
  let tools = initialState?.tools?.slice() ?? [];
  let messages = initialState?.messages?.slice() ?? [];

  return {
    systemPrompt: initialState?.systemPrompt ?? '',
    model: initialState?.model ?? DEFAULT_MODEL,
    thinkingLevel: initialState?.thinkingLevel ?? ('off' as ThinkingLevel),
    get tools() {
      return tools;
    },
    set tools(nextTools: AgentTool[]) {
      tools = nextTools.slice();
    },
    get messages() {
      return messages;
    },
    set messages(nextMessages: AgentMessage[]) {
      messages = nextMessages.slice();
    },
    isStreaming: false,
    streamingMessage: undefined,
    pendingToolCalls: new Set<string>(),
    errorMessage: undefined,
  };
}

// ============ PendingMessageQueue ============

class PendingMessageQueue {
  private messages: AgentMessage[] = [];

  constructor(public mode: QueueMode) {}

  enqueue(message: AgentMessage): void {
    this.messages.push(message);
  }

  hasItems(): boolean {
    return this.messages.length > 0;
  }

  drain(): AgentMessage[] {
    if (this.mode === 'all') {
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }

    const first = this.messages[0];
    if (!first) {
      return [];
    }
    this.messages = this.messages.slice(1);
    return [first];
  }

  clear(): void {
    this.messages = [];
  }
}

// ============ ActiveRun ============

type ActiveRun = {
  promise: Promise<void>;
  resolve: () => void;
  abortController: AbortController;
};

// ============ Agent 类 ============

/**
 * 有状态的 Agent 运行时
 *
 * 拥有当前对话转录、发射生命周期事件、执行工具，
 * 并暴露 steering/follow-up 消息队列 API。
 */
export class Agent {
  private _state: MutableAgentState;
  private readonly listeners = new Set<
    (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  >();
  private readonly steeringQueue: PendingMessageQueue;
  private readonly followUpQueue: PendingMessageQueue;

  public convertToLlm:
    | ((messages: AgentMessage[]) => Anthropic.MessageParam[] | Promise<Anthropic.MessageParam[]>)
    | undefined;
  public transformContext:
    | ((messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>)
    | undefined;
  public streamFn: StreamFn | undefined;
  public getApiKey:
    | ((provider: string) => Promise<string | undefined> | string | undefined)
    | undefined;
  public beforeToolCall:
    | ((
        context: BeforeToolCallContext,
        signal?: AbortSignal
      ) => Promise<BeforeToolCallResult | undefined>)
    | undefined;
  public afterToolCall:
    | ((
        context: AfterToolCallContext,
        signal?: AbortSignal
      ) => Promise<AfterToolCallResult | undefined>)
    | undefined;

  private activeRun: ActiveRun | undefined;
  public sessionId: string | undefined;
  public thinkingBudgets: ThinkingBudgets | undefined;
  public maxRetryDelayMs: number | undefined;
  public toolExecution: ToolExecutionMode | undefined;

  constructor(options: AgentOptions = {}) {
    this._state = createMutableAgentState(options.initialState);
    // 使用 as any 绕过 exactOptionalPropertyTypes 的严格限制
    // 这些属性在运行时始终正确初始化
    this.convertToLlm = (options.convertToLlm ?? defaultConvertToLlm) as never;
    this.transformContext = options.transformContext as never;
    this.streamFn = options.streamFn as StreamFn | undefined;
    this.getApiKey = options.getApiKey as never;
    this.beforeToolCall = options.beforeToolCall as never;
    this.afterToolCall = options.afterToolCall as never;
    this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? 'one-at-a-time');
    this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? 'one-at-a-time');
    this.sessionId = options.sessionId as never;
    this.thinkingBudgets = options.thinkingBudgets as never;
    this.maxRetryDelayMs = options.maxRetryDelayMs as never;
    this.toolExecution = options.toolExecution ?? 'parallel';
  }

  // ============ 订阅 ============

  /**
   * 订阅 Agent 生命周期事件
   *
   * 监听器的 Promise 按订阅顺序 await，属于当前运行的结算的一部分。
   * agent_end 是单次运行的最后一个事件。
   */
  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ============ 状态 ============

  get state(): AgentState {
    return this._state;
  }

  // ============ Steering / Follow-up ============

  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }

  get steeringMode(): QueueMode {
    return this.steeringQueue.mode;
  }

  set followUpMode(mode: QueueMode) {
    this.followUpQueue.mode = mode;
  }

  get followUpMode(): QueueMode {
    return this.followUpQueue.mode;
  }

  /** 在 assistant 完成当前轮次后注入消息 */
  steer(message: AgentMessage): void {
    this.steeringQueue.enqueue(message);
  }

  /** 在 Agent 自然停止后注入消息 */
  followUp(message: AgentMessage): void {
    this.followUpQueue.enqueue(message);
  }

  clearSteeringQueue(): void {
    this.steeringQueue.clear();
  }

  clearFollowUpQueue(): void {
    this.followUpQueue.clear();
  }

  clearAllQueues(): void {
    this.clearSteeringQueue();
    this.clearFollowUpQueue();
  }

  hasQueuedMessages(): boolean {
    return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
  }

  // ============ 控制 ============

  get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
  }

  abort(): void {
    this.activeRun?.abortController.abort();
  }

  waitForIdle(): Promise<void> {
    return this.activeRun?.promise ?? Promise.resolve();
  }

  reset(): void {
    this._state.messages = [];
    this._state.isStreaming = false;
    (this._state as Record<string, unknown>).streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    (this._state as Record<string, unknown>).errorMessage = undefined;
    this.clearFollowUpQueue();
    this.clearSteeringQueue();
  }

  // ============ Prompt ============

  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImageContent[]): Promise<void>;
  async prompt(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[]
  ): Promise<void> {
    if (this.activeRun) {
      throw new Error('Agent 已在处理 prompt。使用 steer() 或 followUp() 排队消息，或等待完成。');
    }
    const messages = this.normalizePromptInput(input, images);

    const roleSummary = messages
      .map((m) => m.role)
      .reduce<Record<string, number>>((acc, role) => {
        acc[role] = (acc[role] || 0) + 1;
        return acc;
      }, {});
    logger.info('Agent.prompt() 开始', {
      messageCount: messages.length,
      roleDistribution: roleSummary,
      contextMessagesBefore: this._state.messages.length,
    });

    const t0 = Date.now();
    await this.runPromptMessages(messages);
    logger.info('Agent.prompt() 完成', {
      duration: Date.now() - t0,
      contextMessagesAfter: this._state.messages.length,
    });
  }

  // ============ Continue ============

  async continue(): Promise<void> {
    if (this.activeRun) {
      throw new Error('Agent 正在处理中。等待完成后再继续。');
    }

    const lastMessage = this._state.messages[this._state.messages.length - 1];
    if (!lastMessage) {
      throw new Error('没有消息可继续');
    }

    if (lastMessage.role === 'assistant') {
      const queuedSteering = this.steeringQueue.drain();
      if (queuedSteering.length > 0) {
        logger.info('Agent.continue() 通过 steering 消息继续', {
          steeringCount: queuedSteering.length,
          steeringRoles: queuedSteering.map((m) => m.role).join(','),
          contextMessagesBefore: this._state.messages.length,
        });
        await this.runPromptMessages(queuedSteering, {
          skipInitialSteeringPoll: true,
        });
        return;
      }

      const queuedFollowUps = this.followUpQueue.drain();
      if (queuedFollowUps.length > 0) {
        logger.info('Agent.continue() 通过 followUp 消息继续', {
          followUpCount: queuedFollowUps.length,
          followUpRoles: queuedFollowUps.map((m) => m.role).join(','),
          contextMessagesBefore: this._state.messages.length,
        });
        await this.runPromptMessages(queuedFollowUps);
        return;
      }

      logger.warn('Agent.continue() 无法从 assistant 消息继续：无排队消息');
      throw new Error('无法从 assistant 角色消息继续');
    }

    logger.info('Agent.continue() 运行延续（toolResult 触发）', {
      contextMessagesBefore: this._state.messages.length,
      lastRole: lastMessage.role,
    });
    await this.runContinuation();
  }

  // ============ 内部方法 ============

  private normalizePromptInput(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[]
  ): AgentMessage[] {
    if (Array.isArray(input)) {
      return input;
    }

    if (typeof input !== 'string') {
      return [input];
    }

    const content: Array<TextContent | ImageContent> = [{ type: 'text', text: input }];
    if (images && images.length > 0) {
      content.push(...images);
    }
    return [{ role: 'user', content, timestamp: Date.now() }];
  }

  private async runPromptMessages(
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean } = {}
  ): Promise<void> {
    await this.runWithLifecycle(async (signal) => {
      await runAgentLoop(
        messages,
        this.createContextSnapshot(),
        this.createLoopConfig(options),
        (event) => this.processEvents(event),
        signal,
        this.streamFn
      );
    });
  }

  private async runContinuation(): Promise<void> {
    await this.runWithLifecycle(async (signal) => {
      await runAgentLoopContinue(
        this.createContextSnapshot(),
        this.createLoopConfig(),
        (event) => this.processEvents(event),
        signal,
        this.streamFn
      );
    });
  }

  private createContextSnapshot(): AgentContext {
    return {
      systemPrompt: this._state.systemPrompt,
      messages: this._state.messages.slice(),
      tools: this._state.tools.slice(),
    };
  }

  private createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): AgentLoopConfig {
    let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
    return {
      model: this._state.model,
      reasoning:
        this._state.thinkingLevel === ('off' as ThinkingLevel)
          ? undefined
          : this._state.thinkingLevel,
      convertToLlm: this.convertToLlm!,
      sessionId: this.sessionId as never,
      transformContext: this.transformContext as never,
      getApiKey: this.getApiKey as never,
      shouldStopAfterTurn: undefined as never,
      getSteeringMessages: async () => {
        if (skipInitialSteeringPoll) {
          skipInitialSteeringPoll = false;
          return [];
        }
        return this.steeringQueue.drain();
      },
      getFollowUpMessages: async () => this.followUpQueue.drain(),
      toolExecution: this.toolExecution as never,
      beforeToolCall: this.beforeToolCall as never,
      afterToolCall: this.afterToolCall as never,
      apiKey: undefined as never,
      signal: undefined as never,
      maxTokens: undefined as never,
      temperature: undefined as never,
      thinkingBudgets: this.thinkingBudgets as never,
      maxRetryDelayMs: this.maxRetryDelayMs as never,
    } as AgentLoopConfig;
  }

  private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.activeRun) {
      throw new Error('Agent 正在处理中。');
    }

    const abortController = new AbortController();
    let resolvePromise = () => {};
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    this.activeRun = {
      promise,
      resolve: resolvePromise,
      abortController,
    };

    this._state.isStreaming = true;
    (this._state as Record<string, unknown>).streamingMessage = undefined;
    (this._state as Record<string, unknown>).errorMessage = undefined;

    const lifeStart = Date.now();
    logger.debug('Agent runWithLifecycle 开始', {
      modelId: this._state.model.id,
      modelProvider: this._state.model.provider,
      contextSize: this._state.messages.length,
    });

    try {
      await executor(abortController.signal);
      logger.debug('Agent runWithLifecycle 完成', {
        duration: Date.now() - lifeStart,
        contextSizeAfter: this._state.messages.length,
      });
    } catch (error) {
      logger.debug('Agent runWithLifecycle 异常', {
        duration: Date.now() - lifeStart,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.handleRunFailure(error, abortController.signal.aborted);
    } finally {
      this.finishRun();
    }
  }

  private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      'Agent 运行失败',
      { aborted, model: this._state.model.id },
      error instanceof Error ? error : undefined
    );

    const failureMessage: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      api: this._state.model.provider,
      provider: this._state.model.provider,
      model: this._state.model.id,
      usage: EMPTY_USAGE,
      stopReason: aborted ? 'aborted' : 'error',
      errorMessage,
      timestamp: Date.now(),
    } as AgentMessage;
    this._state.messages.push(failureMessage);
    this._state.errorMessage = (failureMessage as Record<string, unknown>).errorMessage as
      | string
      | undefined;
    await this.processEvents({
      type: 'agent_end',
      messages: [failureMessage],
    });
  }

  private finishRun(): void {
    this._state.isStreaming = false;
    (this._state as Record<string, unknown>).streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    this.activeRun?.resolve();
    (this as Record<string, unknown>).activeRun = undefined;
  }

  /**
   * 根据事件更新内部状态，然后通知所有监听器。
   *
   * agent_end 只表示不再有后续循环事件。运行在
   * agent_end 监听器全部 settle 后、finishRun() 清理运行时状态后进入空闲。
   */
  private async processEvents(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case 'message_start':
        this._state.streamingMessage = event.message;
        break;

      case 'message_update':
        this._state.streamingMessage = event.message;
        break;

      case 'message_end':
        this._state.streamingMessage = undefined;
        this._state.messages.push(event.message);
        break;

      case 'tool_execution_start': {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.add(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case 'tool_execution_end': {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.delete(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case 'turn_end':
        if (
          event.message.role === 'assistant' &&
          (event.message as Record<string, unknown>).errorMessage
        ) {
          this._state.errorMessage = (event.message as Record<string, unknown>).errorMessage as
            | string
            | undefined;
        }
        break;

      case 'agent_end':
        this._state.streamingMessage = undefined;
        break;
    }

    const signal = this.activeRun?.abortController.signal;
    if (!signal) {
      throw new Error('Agent 监听器在活动运行外被调用');
    }
    for (const listener of this.listeners) {
      await listener(event, signal);
    }
  }
}
