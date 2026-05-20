/**
 * Agent Loop 测试
 *
 * 测试 agent-loop.ts 的核心循环逻辑。
 * 使用 mock streamFn 模拟 LLM 响应，不依赖真实 API。
 */

import type Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgentLoop, runAgentLoopContinue } from '@/core/agent-runtime/agent-loop';
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
} from '@/core/agent-runtime/agent-types';
import type { AssistantMessage } from '@/core/agent-runtime/pi-ai-compat-types';

// ============ Mock EventStream (Anthropic SDK 格式) ============

class MockEventStream {
  private events: Anthropic.RawMessageStreamEvent[];

  constructor(events: Anthropic.RawMessageStreamEvent[]) {
    this.events = events;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Anthropic.RawMessageStreamEvent> {
    for (const event of this.events) {
      yield event;
    }
  }
}

/**
 * 创建一个 streamFn，首次返回指定的 assistant message，
 * 之后返回纯文本消息。防止多轮交互陷入无限循环。
 */
function createMultiTurnStreamFn(firstResponse: AssistantMessage, fallbackText = 'done') {
  let callCount = 0;
  return vi.fn().mockImplementation(async () => {
    callCount++;
    const msg = callCount <= 1 ? firstResponse : makeTextResponse(fallbackText);
    return new MockEventStream(makeStreamEvents(msg));
  });
}

// ============ 工厂函数 ============

function makeTextResponse(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'test',
    provider: 'test',
    model: 'test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  } as AssistantMessage;
}

function makeToolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
  id = 'call-1'
): AssistantMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Using tool...' },
      { type: 'toolCall', id, name: toolName, arguments: args },
    ],
    api: 'test',
    provider: 'test',
    model: 'test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  } as AssistantMessage;
}

/**
 * 将 AssistantMessage 转换为 Anthropic SDK 流式事件序列
 *
 * 生成: message_start → content_block_start(text) → content_block_delta(text_delta)
 *       → content_block_stop → message_delta → message_stop
 */
function makeStreamEvents(response: AssistantMessage): Anthropic.RawMessageStreamEvent[] {
  const text = response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');

  const hasToolCalls = response.content.some(
    (c): c is { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> } =>
      c.type === 'toolCall'
  );

  const events: Anthropic.RawMessageStreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg-test-1',
        type: 'message',
        role: 'assistant',
        content: [],
        model: response.model ?? 'test',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: response.usage?.input ?? 0, output_tokens: 0 },
      },
    } as unknown as Anthropic.MessageStartEvent,
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as unknown as Anthropic.ContentBlockStartEvent,
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    } as unknown as Anthropic.ContentBlockDeltaEvent,
    {
      type: 'content_block_stop',
      index: 0,
    } as unknown as Anthropic.ContentBlockStopEvent,
  ];

  // 如果有工具调用，添加 tool_use 内容块（递增索引）
  if (hasToolCalls) {
    let toolIndex = 1; // index 0 是 text 块
    for (const block of response.content) {
      if (block.type === 'toolCall') {
        events.push(
          {
            type: 'content_block_start',
            index: toolIndex,
            content_block: {
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: {},
            },
          } as unknown as Anthropic.ContentBlockStartEvent,
          {
            type: 'content_block_delta',
            index: toolIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: JSON.stringify(block.arguments),
            },
          } as unknown as Anthropic.ContentBlockDeltaEvent,
          {
            type: 'content_block_stop',
            index: toolIndex,
          } as unknown as Anthropic.ContentBlockStopEvent
        );
        toolIndex++;
      }
    }
  }

  events.push(
    {
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
      },
      usage: { output_tokens: response.usage?.output ?? 0 },
    } as unknown as Anthropic.MessageDeltaEvent,
    {
      type: 'message_stop',
    } as unknown as Anthropic.MessageStopEvent
  );

  return events;
}

/**
 * 创建一个模拟错误的流：在迭代时抛出异常
 */
function makeErrorStream(errorMsg: string): {
  streamFn: ReturnType<typeof vi.fn>;
} {
  const streamFn = vi.fn().mockImplementation(async () => ({
    async *[Symbol.asyncIterator](): AsyncIterator<Anthropic.RawMessageStreamEvent> {
      throw new Error(errorMsg);
    },
  }));
  return { streamFn };
}

function createMockStreamFn(responseText?: string) {
  const msg = makeTextResponse(responseText ?? 'ok');
  return createMultiTurnStreamFn(msg);
}

function createMockToolStreamFn(toolName: string, args: Record<string, unknown> = {}) {
  const msg = makeToolCallResponse(toolName, args);
  return createMultiTurnStreamFn(msg);
}

function createMockStreamFnFrom(finalMessage: AssistantMessage) {
  return createMultiTurnStreamFn(finalMessage);
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: AgentLoopConfig = {
  model: {
    id: 'test',
    provider: 'test',
  },
  reasoning: undefined,
  sessionId: undefined,
  transformContext: undefined,
  convertToLlm: (messages: AgentMessage[]) =>
    messages
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult')
      .map((m) => {
        const raw = m as Record<string, unknown>;
        const role = raw.role as string;
        const content = raw.content;
        if (role === 'user') {
          return {
            role: 'user',
            content: typeof content === 'string' ? content : '',
          } as Anthropic.MessageParam;
        }
        if (role === 'assistant') {
          return {
            role: 'assistant',
            content: [{ type: 'text', text: '' }],
          } as Anthropic.MessageParam;
        }
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: (raw.toolCallId as string) ?? '',
              content: 'ok',
            },
          ],
        } as Anthropic.MessageParam;
      }),
  getApiKey: undefined,
  shouldStopAfterTurn: undefined,
  getSteeringMessages: undefined,
  getFollowUpMessages: undefined,
  toolExecution: 'parallel',
  beforeToolCall: undefined,
  afterToolCall: undefined,
  apiKey: undefined,
  signal: undefined,
  maxTokens: undefined,
  temperature: undefined,
  thinkingBudgets: undefined,
  maxRetryDelayMs: undefined,
};

function makeAgentContext(context?: Partial<AgentContext>): AgentContext {
  return {
    systemPrompt: context?.systemPrompt ?? '',
    messages: context?.messages ?? [],
    tools: context?.tools ?? [],
  };
}

// ============ 测试 ============

describe('agent-loop', () => {
  let emittedEvents: AgentEvent[] = [];

  beforeEach(() => {
    emittedEvents = [];
  });

  function collectEmit(event: AgentEvent) {
    emittedEvents.push(event);
  }

  describe('runAgentLoop', () => {
    it('should emit lifecycle events for a simple text response', async () => {
      const streamFn = createMockStreamFn('Hello world');
      const result = await runAgentLoop(
        [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
        makeAgentContext(),
        DEFAULT_CONFIG,
        collectEmit,
        undefined,
        streamFn
      );

      // 返回 prompt 消息
      expect(result).toHaveLength(2); // prompt + assistant
      expect(result[0]?.role).toBe('user');
      expect(result[1]?.role).toBe('assistant');

      // 事件序列
      const types = emittedEvents.map((e) => e.type);
      expect(types.includes('agent_start')).toBe(true);
      expect(types.includes('turn_start')).toBe(true);
      expect(types.includes('message_start')).toBe(true);
      expect(types.includes('message_end')).toBe(true);
      expect(types.includes('agent_end')).toBe(true);
    });

    it('should handle tool calls and execute them', async () => {
      const toolExecFn = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'tool result' }],
        details: {},
      });

      const tool = {
        name: 'test_tool',
        description: 'Test tool',
        label: 'Test Tool',
        parameters: { type: 'object', properties: {} },
        execute: toolExecFn,
      };

      const streamFn = createMockToolStreamFn('test_tool', { arg1: 'val1' });
      const config = { ...DEFAULT_CONFIG };

      await runAgentLoop(
        [{ role: 'user', content: 'Use tool', timestamp: Date.now() }],
        makeAgentContext({ tools: [tool] }),
        config,
        collectEmit,
        undefined,
        streamFn
      );

      // 应该有 tool_execution_start / end 事件
      const toolStarts = emittedEvents.filter((e) => e.type === 'tool_execution_start');
      const toolEnds = emittedEvents.filter((e) => e.type === 'tool_execution_end');
      expect(toolStarts.length).toBeGreaterThanOrEqual(1);
      expect(toolEnds.length).toBeGreaterThanOrEqual(1);

      // 工具应被执行
      expect(toolExecFn).toHaveBeenCalledOnce();
    });

    it('should return error message when tool is not found', async () => {
      const streamFn = createMockToolStreamFn('nonexistent_tool');
      await runAgentLoop(
        [{ role: 'user', content: 'Call tool', timestamp: Date.now() }],
        makeAgentContext({ tools: [] }), // 没有注册工具
        DEFAULT_CONFIG,
        collectEmit,
        undefined,
        streamFn
      );

      const toolStarts = emittedEvents.filter((e) => e.type === 'tool_execution_start');
      const toolEnds = emittedEvents.filter((e) => e.type === 'tool_execution_end');
      expect(toolStarts.length).toBeGreaterThanOrEqual(1);
      expect(toolEnds.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle sequential tool execution mode', async () => {
      const toolExecFn = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        details: {},
      });

      const tool = {
        name: 'seq_tool',
        description: 'Sequential tool',
        label: 'Seq Tool',
        parameters: { type: 'object', properties: {} },
        execute: toolExecFn,
      };

      const streamFn = createMockToolStreamFn('seq_tool');
      const config = { ...DEFAULT_CONFIG, toolExecution: 'sequential' as const };

      await runAgentLoop(
        [{ role: 'user', content: 'Do sequential', timestamp: Date.now() }],
        makeAgentContext({ tools: [tool] }),
        config,
        collectEmit,
        undefined,
        streamFn
      );

      expect(toolExecFn).toHaveBeenCalledOnce();
    });

    it('should call beforeToolCall and block execution', async () => {
      const toolExecFn = vi.fn();
      const tool = {
        name: 'blocked_tool',
        description: 'Blocked',
        label: 'Blocked',
        parameters: { type: 'object', properties: {} },
        execute: toolExecFn,
      };

      const streamFn = createMockToolStreamFn('blocked_tool');
      const config = {
        ...DEFAULT_CONFIG,
        beforeToolCall: vi.fn().mockResolvedValue({ block: true, reason: 'Not allowed' }),
      };

      await runAgentLoop(
        [{ role: 'user', content: 'Blocked', timestamp: Date.now() }],
        makeAgentContext({ tools: [tool] }),
        config,
        collectEmit,
        undefined,
        streamFn
      );

      // 工具不应被执行（被阻止）
      expect(toolExecFn).not.toHaveBeenCalled();
    });

    it('should call afterToolCall hook', async () => {
      const afterHook = vi.fn().mockResolvedValue({ terminate: true });
      const toolExecFn = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        details: {},
      });

      const tool = {
        name: 'after_tool',
        description: 'After test',
        label: 'After',
        parameters: { type: 'object', properties: {} },
        execute: toolExecFn,
      };

      const streamFn = createMockToolStreamFn('after_tool');
      const config = {
        ...DEFAULT_CONFIG,
        afterToolCall: afterHook,
      };

      await runAgentLoop(
        [{ role: 'user', content: 'After test', timestamp: Date.now() }],
        makeAgentContext({ tools: [tool] }),
        config,
        collectEmit,
        undefined,
        streamFn
      );

      expect(afterHook).toHaveBeenCalledOnce();
    });

    it('should stop when tool has terminate=true', async () => {
      const toolExecFn = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'final' }],
        details: {},
        terminate: true,
      });

      const tool = {
        name: 'final_tool',
        description: 'Final',
        label: 'Final',
        parameters: { type: 'object', properties: {} },
        execute: toolExecFn,
      };

      // 这个 streamFn 会先产生一个 tool call 回复，
      // 但由于 terminate=true，循环不应继续
      const streamFn = createMockToolStreamFn('final_tool');

      await runAgentLoop(
        [{ role: 'user', content: 'Done', timestamp: Date.now() }],
        makeAgentContext({ tools: [tool] }),
        DEFAULT_CONFIG,
        collectEmit,
        undefined,
        streamFn
      );

      // 应该有 agent_end
      const ends = emittedEvents.filter((e) => e.type === 'agent_end');
      expect(ends).toHaveLength(1);
    });

    it('should call shouldStopAfterTurn and exit early', async () => {
      const stopFn = vi.fn().mockResolvedValue(true);
      const streamFn = createMockStreamFn('early stop');

      const config = { ...DEFAULT_CONFIG, shouldStopAfterTurn: stopFn };

      await runAgentLoop(
        [{ role: 'user', content: 'Stop', timestamp: Date.now() }],
        makeAgentContext(),
        config,
        collectEmit,
        undefined,
        streamFn
      );

      expect(stopFn).toHaveBeenCalledOnce();
    });

    it('should abort and emit agent_end on error stream', async () => {
      const { streamFn } = makeErrorStream('API error');

      await runAgentLoop(
        [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
        makeAgentContext(),
        DEFAULT_CONFIG,
        collectEmit,
        undefined,
        streamFn
      );

      const ends = emittedEvents.filter((e) => e.type === 'agent_end');
      expect(ends).toHaveLength(1);
    });

    it('should handle steering messages', async () => {
      const streamFn = createMockStreamFn('first response');

      let steeringCalled = false;
      const config = {
        ...DEFAULT_CONFIG,
        getSteeringMessages: vi.fn().mockImplementation(async () => {
          if (!steeringCalled) {
            steeringCalled = true;
            return [{ role: 'user', content: 'steering message', timestamp: Date.now() }];
          }
          return [];
        }),
      };

      await runAgentLoop(
        [{ role: 'user', content: 'Start', timestamp: Date.now() }],
        makeAgentContext(),
        config,
        collectEmit,
        undefined,
        streamFn
      );

      expect(config.getSteeringMessages).toHaveBeenCalled();
    });

    it('should handle follow-up messages', async () => {
      const streamFn = createMockStreamFn('main response');

      let followUpCalled = false;
      const config = {
        ...DEFAULT_CONFIG,
        getFollowUpMessages: vi.fn().mockImplementation(async () => {
          if (!followUpCalled) {
            followUpCalled = true;
            return [{ role: 'user', content: 'follow-up', timestamp: Date.now() }];
          }
          return [];
        }),
        // steering 返回空，确保进入 follow-up
        getSteeringMessages: vi.fn().mockResolvedValue([]),
      };

      await runAgentLoop(
        [{ role: 'user', content: 'Start', timestamp: Date.now() }],
        makeAgentContext(),
        config,
        collectEmit,
        undefined,
        streamFn
      );

      expect(config.getFollowUpMessages).toHaveBeenCalled();
    });

    it('should call transformContext before LLM call', async () => {
      const transformFn = vi.fn().mockImplementation(async (msgs: AgentMessage[]) => msgs);
      const streamFn = createMockStreamFn('transformed');
      const config = { ...DEFAULT_CONFIG, transformContext: transformFn };

      await runAgentLoop(
        [{ role: 'user', content: 'Transform', timestamp: Date.now() }],
        makeAgentContext(),
        config,
        collectEmit,
        undefined,
        streamFn
      );

      expect(transformFn).toHaveBeenCalledOnce();
    });
  });

  describe('runAgentLoopContinue', () => {
    it('should throw when context is empty', async () => {
      await expect(
        runAgentLoopContinue(makeAgentContext({ messages: [] }), DEFAULT_CONFIG, collectEmit)
      ).rejects.toThrow('无法继续');
    });

    it('should throw when last message is assistant', async () => {
      await expect(
        runAgentLoopContinue(
          makeAgentContext({ messages: [{ role: 'assistant', content: 'Hi' } as AgentMessage] }),
          DEFAULT_CONFIG,
          collectEmit
        )
      ).rejects.toThrow('无法从 assistant 角色消息继续');
    });

    it('should continue from user message', async () => {
      const streamFn = createMockStreamFn('continuation response');
      const result = await runAgentLoopContinue(
        makeAgentContext({
          messages: [{ role: 'user', content: 'Continue', timestamp: Date.now() } as AgentMessage],
        }),
        DEFAULT_CONFIG,
        collectEmit,
        undefined,
        streamFn
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe('assistant');
    });

    it('should continue from toolResult message', async () => {
      const streamFn = createMockStreamFn('tool result response');
      const result = await runAgentLoopContinue(
        makeAgentContext({
          messages: [
            {
              role: 'toolResult' as const,
              toolCallId: 'call-1',
              toolName: 'test',
              content: [{ type: 'text', text: 'result' }],
              isError: false,
              timestamp: Date.now(),
            } as AgentMessage,
          ],
        }),
        DEFAULT_CONFIG,
        collectEmit,
        undefined,
        streamFn
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe('assistant');
    });
  });

  describe('tool execution error handling', () => {
    it('should handle tool execution failure', async () => {
      const toolExecFn = vi.fn().mockRejectedValue(new Error('Tool crashed'));
      const tool = {
        name: 'crash_tool',
        description: 'Crash',
        label: 'Crash',
        parameters: { type: 'object', properties: {} },
        execute: toolExecFn,
      };

      const streamFn = createMockToolStreamFn('crash_tool');

      await runAgentLoop(
        [{ role: 'user', content: 'Crash', timestamp: Date.now() }],
        makeAgentContext({ tools: [tool] }),
        DEFAULT_CONFIG,
        collectEmit,
        undefined,
        streamFn
      );

      const toolEnds = emittedEvents.filter((e) => e.type === 'tool_execution_end' && e.isError);
      expect(toolEnds.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle tool with prepareArguments', async () => {
      const toolExecFn = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'prepared' }],
        details: {},
      });

      const tool = {
        name: 'prep_tool',
        description: 'Prep',
        label: 'Prep',
        parameters: { type: 'object', properties: {} },
        prepareArguments: vi.fn((args: unknown) => args),
        execute: toolExecFn,
      };

      const streamFn = createMockToolStreamFn('prep_tool');

      await runAgentLoop(
        [{ role: 'user', content: 'Prepare', timestamp: Date.now() }],
        makeAgentContext({ tools: [tool] }),
        DEFAULT_CONFIG,
        collectEmit,
        undefined,
        streamFn
      );

      expect(tool.prepareArguments).toHaveBeenCalled();
      expect(toolExecFn).toHaveBeenCalledOnce();
    });

    it('should handle afterToolCall throwing an error', async () => {
      const toolExecFn = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        details: {},
      });

      const tool = {
        name: 'after_err',
        description: 'After error',
        label: 'AfterErr',
        parameters: { type: 'object', properties: {} },
        execute: toolExecFn,
      };

      const config = {
        ...DEFAULT_CONFIG,
        afterToolCall: vi.fn().mockRejectedValue(new Error('after hook failed')),
      };

      const streamFn = createMockToolStreamFn('after_err');

      await runAgentLoop(
        [{ role: 'user', content: 'Test', timestamp: Date.now() }],
        makeAgentContext({ tools: [tool] }),
        config,
        collectEmit,
        undefined,
        streamFn
      );

      // 即使 afterToolCall 失败，工具已执行，循环应正常完成
      const ends = emittedEvents.filter((e) => e.type === 'agent_end');
      expect(ends).toHaveLength(1);
    });
  });

  describe('parallel tool execution', () => {
    it('should execute multiple tool calls in parallel', async () => {
      const execResults = new Map<string, number>();
      const toolExecFn = vi.fn().mockImplementation(async (_id: string, _params: unknown) => {
        const elapsed = execResults.size;
        execResults.set(_id, elapsed);
        return { content: [{ type: 'text', text: `result-${_id}` }], details: {} };
      });

      const tool = {
        name: 'p_tool',
        description: 'Parallel tool',
        label: 'P Tool',
        parameters: { type: 'object', properties: {} },
        execute: toolExecFn,
      };

      // 创建包含多个 tool call 的 assistant 消息
      const finalMessage = makeTextResponse('');
      finalMessage.content = [
        { type: 'text', text: 'Multiple calls' },
        { type: 'toolCall', id: 'call-1', name: 'p_tool', arguments: {} },
        { type: 'toolCall', id: 'call-2', name: 'p_tool', arguments: {} },
      ];

      const streamFn = createMockStreamFnFrom(finalMessage);

      await runAgentLoop(
        [{ role: 'user', content: 'Parallel', timestamp: Date.now() }],
        makeAgentContext({ tools: [tool] }),
        DEFAULT_CONFIG,
        collectEmit,
        undefined,
        streamFn
      );

      // 工具应被调用 2 次
      expect(toolExecFn).toHaveBeenCalledTimes(2);
    });
  });
});
