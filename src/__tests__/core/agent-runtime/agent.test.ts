/**
 * Agent 类测试
 *
 * 直接测试 Agent 类（不 mock），使用 mock streamFn 控制 LLM 响应。
 */

import type Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@/core/agent-runtime/agent';
import type { AgentMessage } from '@/core/agent-runtime/agent-types';
import type { AssistantMessage } from '@/core/agent-runtime/runtime-types';

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

function makeTextResponse(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'test',
    provider: 'test',
    model: 'test',
    usage: {
      input: 10,
      output: 20,
      totalTokens: 30,
      cost: { input: 0, output: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  } as AssistantMessage;
}

/**
 * 将 AssistantMessage 转换为 Anthropic SDK 流式事件序列
 *
 * 生成: message_start → content_block_start(text) → content_block_delta(text_delta)
 *       → content_block_stop → [tool_use blocks] → message_delta → message_stop
 */
function makeStreamEvents(response: AssistantMessage): Anthropic.RawMessageStreamEvent[] {
  const text = response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');

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
  let toolIndex = 1;
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

  events.push(
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' as const, stop_sequence: null },
      usage: { output_tokens: response.usage?.output ?? 0 },
    } as unknown as Anthropic.MessageDeltaEvent,
    {
      type: 'message_stop',
    } as unknown as Anthropic.MessageStopEvent
  );

  return events;
}

/**
 * 创建多轮安全的 streamFn：首次返回请求的消息，之后返回纯文本。
 * 防止工具调用导致的多轮交互陷入无限循环。
 */
function createMultiTurnStreamFn(firstMessage: AssistantMessage, fallbackText = 'done') {
  let callCount = 0;
  return vi.fn().mockImplementation(async () => {
    callCount++;
    const msg = callCount <= 1 ? firstMessage : makeTextResponse(fallbackText);
    return new MockEventStream(makeStreamEvents(msg));
  });
}

function createMockStreamFn(responseText?: string) {
  const msg = makeTextResponse(responseText ?? 'ok');
  return createMultiTurnStreamFn(msg);
}

function createMockStreamForToolCall() {
  const msg: AssistantMessage = {
    role: 'assistant',
    content: [
      { type: 'text', text: 'calling' },
      { type: 'toolCall', id: 'c1', name: 'test_tool', arguments: {} },
    ],
    usage: {
      input: 10,
      output: 20,
      totalTokens: 30,
      cost: { input: 0, output: 0, total: 0 },
    } as any,
    stopReason: 'stop',
    timestamp: Date.now(),
  } as AssistantMessage;
  return createMultiTurnStreamFn(msg);
}

// ============ 测试 ============

describe('Agent', () => {
  let agent: Agent;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new Agent();
  });

  describe('constructor', () => {
    it('should create agent with default state', () => {
      expect(agent.state.systemPrompt).toBe('');
      expect(agent.state.messages).toEqual([]);
      expect(agent.state.tools).toEqual([]);
      expect(agent.state.isStreaming).toBe(false);
      expect(agent.state.pendingToolCalls).toEqual(new Set());
      expect(agent.state.streamingMessage).toBeUndefined();
      expect(agent.state.errorMessage).toBeUndefined();
    });

    it('should accept initial state', () => {
      const tool = {
        name: 't1',
        description: 'd',
        label: 'l',
        parameters: { type: 'object' as const, properties: {} },
        execute: vi.fn(),
      };
      const customAgent = new Agent({
        initialState: {
          systemPrompt: 'You are a test agent',
          tools: [tool],
          messages: [{ role: 'user' as const, content: 'Hi', timestamp: Date.now() }],
          model: {
            id: 'test',
            provider: 'test',
          },
          thinkingLevel: 'medium' as const,
        },
      });

      expect(customAgent.state.systemPrompt).toBe('You are a test agent');
      expect(customAgent.state.tools).toHaveLength(1);
      expect(customAgent.state.messages).toHaveLength(1);
    });

    it('should set toolExecution default to parallel', () => {
      expect(agent.toolExecution).toBe('parallel');
    });

    it('should accept toolExecution option', () => {
      const seqAgent = new Agent({ toolExecution: 'sequential' });
      expect(seqAgent.toolExecution).toBe('sequential');
    });
  });

  describe('state getter', () => {
    it('should copy arrays on assignment', () => {
      const tools: any[] = [];
      agent.state.tools = tools;
      tools.push({ name: 'leaked' });
      expect(agent.state.tools).toHaveLength(0);
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('should add and remove listeners', () => {
      const listener = vi.fn();
      const unsubscribe = agent.subscribe(listener);
      expect(unsubscribe).toBeTypeOf('function');

      // 触发 prompt，验证 listener 被调用
      const streamFn = createMockStreamFn('subscribed');
      agent.streamFn = streamFn;

      // 不 await，验证订阅
      agent.prompt('test').catch(() => {});
      expect(agent.state.isStreaming).toBe(true);

      // 取消订阅
      unsubscribe();
    });
  });

  describe('steer / followUp', () => {
    it('should enqueue steering messages', () => {
      const msg: AgentMessage = { role: 'user', content: 'steer', timestamp: Date.now() };
      agent.steer(msg);
      expect(agent.hasQueuedMessages()).toBe(true);
    });

    it('should enqueue follow-up messages', () => {
      const msg: AgentMessage = { role: 'user', content: 'follow', timestamp: Date.now() };
      agent.followUp(msg);
      expect(agent.hasQueuedMessages()).toBe(true);
    });

    it('should clear steering queue', () => {
      agent.steer({ role: 'user', content: 's', timestamp: Date.now() });
      agent.clearSteeringQueue();
      expect(agent.hasQueuedMessages()).toBe(false);
    });

    it('should clear follow-up queue', () => {
      agent.followUp({ role: 'user', content: 'f', timestamp: Date.now() });
      agent.clearFollowUpQueue();
      expect(agent.hasQueuedMessages()).toBe(false);
    });

    it('should clear all queues', () => {
      agent.steer({ role: 'user', content: 's', timestamp: Date.now() });
      agent.followUp({ role: 'user', content: 'f', timestamp: Date.now() });
      agent.clearAllQueues();
      expect(agent.hasQueuedMessages()).toBe(false);
    });

    it('should set and get steering/followUp mode', () => {
      agent.steeringMode = 'all';
      expect(agent.steeringMode).toBe('all');
      agent.followUpMode = 'all';
      expect(agent.followUpMode).toBe('all');
    });
  });

  describe('prompt', () => {
    it('should accept string input', async () => {
      const streamFn = createMockStreamFn('response');
      agent.streamFn = streamFn;

      await agent.prompt('Hello');

      expect(agent.state.messages.length).toBeGreaterThan(0);
      const lastMsg = agent.state.messages[agent.state.messages.length - 1]!;
      expect(lastMsg.role).toBe('assistant');
    });

    it('should accept AgentMessage input', async () => {
      const streamFn = createMockStreamFn('response');
      agent.streamFn = streamFn;

      await agent.prompt({ role: 'user', content: 'Hi', timestamp: Date.now() });

      expect(agent.state.messages.length).toBeGreaterThan(0);
    });

    it('should accept array of messages', async () => {
      const streamFn = createMockStreamFn('response');
      agent.streamFn = streamFn;

      await agent.prompt([
        { role: 'user', content: 'First', timestamp: Date.now() },
        { role: 'user', content: 'Second', timestamp: Date.now() },
      ]);
    });

    it('should reject concurrent prompt calls', async () => {
      // 创建一个永远不 resolve 的 stream 来模拟长时间运行
      const deferredPromise = new Promise(() => {}); // 永不为 resolve
      const delayedStreamFn = vi.fn().mockReturnValue(deferredPromise);
      agent.streamFn = delayedStreamFn;

      // 启动第一个 prompt（不会完成）
      agent.prompt('first');

      // 等待 activeRun 被设置（在 runWithLifecycle 中同步设置）
      await new Promise((r) => setTimeout(r, 0));

      // 第二个 prompt 应被拒绝
      await expect(agent.prompt('second')).rejects.toThrow('Agent 已在处理');

      // 清理：中止第一个 prompt 防止 leak，并让 deferred 解析
      agent.abort();
    });

    it('should handle prompt with images', async () => {
      const streamFn = createMockStreamFn('analyzed');
      agent.streamFn = streamFn;

      await agent.prompt('Describe', [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'abc' },
        } as never,
      ]);
    });

    it('should become idle after prompt completes', async () => {
      const streamFn = createMockStreamFn('done');
      agent.streamFn = streamFn;

      expect(agent.state.isStreaming).toBe(false);
      await agent.prompt('Go');
      expect(agent.state.isStreaming).toBe(false);
    });
  });

  describe('abort', () => {
    it('should set signal and not throw when idle', () => {
      expect(agent.signal).toBeUndefined();
      agent.abort(); // should not throw when idle
    });
  });

  describe('waitForIdle', () => {
    it('should resolve immediately when no active run', async () => {
      await expect(agent.waitForIdle()).resolves.toBeUndefined();
    });

    it('should resolve after run completes', async () => {
      const streamFn = createMockStreamFn('idle');
      agent.streamFn = streamFn;

      const promptPromise = agent.prompt('test');
      const idlePromise = agent.waitForIdle();

      await promptPromise;
      await expect(idlePromise).resolves.toBeUndefined();
    });
  });

  describe('reset', () => {
    it('should clear state and queues', () => {
      agent.state.messages = [{ role: 'user', content: 'test', timestamp: Date.now() }];
      agent.steer({ role: 'user', content: 's', timestamp: Date.now() });
      agent.followUp({ role: 'user', content: 'f', timestamp: Date.now() });

      agent.reset();

      expect(agent.state.messages).toEqual([]);
      expect(agent.state.isStreaming).toBe(false);
      expect(agent.hasQueuedMessages()).toBe(false);
    });
  });

  describe('continue', () => {
    it('should throw when no messages', async () => {
      await expect(agent.continue()).rejects.toThrow('没有消息可继续');
    });

    it('should continue from last user message', async () => {
      const streamFn = createMockStreamFn('continue response');
      agent.streamFn = streamFn;

      // 先发一条 user 消息
      agent.state.messages = [{ role: 'user', content: 'Start', timestamp: Date.now() }];

      await agent.continue();

      expect(agent.state.messages.length).toBeGreaterThanOrEqual(2);
    });

    it('should throw when last message is assistant and no queues', async () => {
      agent.state.messages = [{ role: 'assistant', content: 'Done' } as AgentMessage];
      await expect(agent.continue()).rejects.toThrow('无法从 assistant 角色消息继续');
    });

    it('should drain steering queue when last message is assistant', async () => {
      const streamFn = createMockStreamFn('steer response');
      agent.streamFn = streamFn;
      agent.state.messages = [{ role: 'assistant', content: 'Done' } as AgentMessage];
      agent.steer({ role: 'user', content: 'steer msg', timestamp: Date.now() });

      await agent.continue();
      // 应处理 steering 消息
    });

    it('should drain followUp queue when last message is assistant with no steering', async () => {
      const streamFn = createMockStreamFn('follow response');
      agent.streamFn = streamFn;
      agent.state.messages = [{ role: 'assistant', content: 'Done' } as AgentMessage];
      agent.followUp({ role: 'user', content: 'follow msg', timestamp: Date.now() });

      await agent.continue();
      // 应处理 follow-up 消息
    });
  });

  describe('events', () => {
    it('should emit events via subscribe', async () => {
      const events: string[] = [];
      agent.subscribe((event) => {
        events.push(event.type);
      });

      const streamFn = createMockStreamFn('eventful');
      agent.streamFn = streamFn;

      await agent.prompt('test');

      expect(events).toContain('agent_start');
      expect(events).toContain('turn_start');
      expect(events).toContain('message_start');
      expect(events).toContain('message_end');
      expect(events).toContain('agent_end');
    });

    it('should emit message_update events during streaming', async () => {
      const updateEvents: string[] = [];
      agent.subscribe((event) => {
        if (event.type === 'message_update') {
          updateEvents.push('update');
        }
      });

      const streamFn = createMockStreamFn('streaming');
      agent.streamFn = streamFn;

      await agent.prompt('testing');

      expect(updateEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('state accessors', () => {
    it('should return state with correct shape', () => {
      const state = agent.state;
      expect(state).toHaveProperty('systemPrompt');
      expect(state).toHaveProperty('messages');
      expect(state).toHaveProperty('tools');
      expect(state).toHaveProperty('isStreaming');
    });
  });

  describe('agent with hooks', () => {
    it('should call beforeToolCall hook', async () => {
      const beforeHook = vi.fn().mockResolvedValue({ block: false });
      const execFn = vi
        .fn()
        .mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], details: {} });

      const customAgent = new Agent({
        beforeToolCall: beforeHook,
      });
      customAgent.streamFn = createMockStreamForToolCall();
      customAgent.state.tools = [
        {
          name: 'test_tool',
          description: 'd',
          label: 'l',
          parameters: { type: 'object', properties: {} },
          execute: execFn,
        },
      ];

      await customAgent.prompt('call tool');

      expect(beforeHook).toHaveBeenCalledOnce();
    });
  });

  describe('handleRunFailure', () => {
    it('should handle errors during prompt', async () => {
      // streamFn 返回一个会抛出错误的 stream
      agent.streamFn = vi.fn().mockImplementation(async () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_stop' } as unknown as Anthropic.MessageStopEvent;
          throw new Error('API error');
        },
      }));

      await agent.prompt('hi');

      expect(agent.state.isStreaming).toBe(false);
    });

    it('should handle streamFn throwing', async () => {
      agent.streamFn = vi.fn().mockRejectedValue(new Error('Network error'));

      await agent.prompt('hi');

      expect(agent.state.isStreaming).toBe(false);
    });
  });
});
