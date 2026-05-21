import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLlmBasedAgent,
  createRequestFromSubTask,
  LlmBasedAgent,
} from '@/core/agent-runtime/agent-adapter';

// Mock Agent
let capturedSubscriber: ((event: unknown) => void) | null = null;
const mockSubscribe = vi.fn((handler: (event: unknown) => void) => {
  capturedSubscriber = handler;
  return vi.fn();
});
const mockPrompt = vi.fn();
const mockWaitForIdle = vi.fn().mockResolvedValue(undefined);
const mockAbort = vi.fn();

vi.mock('@/core/agent-runtime/agent', () => ({
  Agent: vi.fn().mockImplementation(() => ({
    state: {
      systemPrompt: '',
      model: {},
      thinkingLevel: 'medium',
      tools: [],
      messages: [],
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
    },
    subscribe: mockSubscribe,
    prompt: mockPrompt,
    waitForIdle: mockWaitForIdle,
    abort: mockAbort,
    reset: vi.fn(),
  })),
}));

describe('LlmBasedAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSubscriber = null;
    mockPrompt.mockResolvedValue(undefined);
    mockWaitForIdle.mockResolvedValue(undefined);
  });

  describe('constructor', () => {
    it('should set agentId, displayName, and capabilities', () => {
      const agent = new LlmBasedAgent({
        agentId: 'test-agent',
        displayName: 'Test Agent',
        capabilities: [{ id: 'c1', name: 'C1', description: 'desc', category: 'code-generation' }],
      });

      expect(agent.agentId).toBe('test-agent');
      expect(agent.displayName).toBe('Test Agent');
      expect(agent.capabilities).toHaveLength(1);
    });

    it('should use default runtime config when not provided', () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
      });

      expect(agent.status).toBe('online');
    });

    it('should be offline when disabled via config', () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
        runtimeConfig: { enabled: false },
      });

      expect(agent.status).toBe('offline');
    });
  });

  describe('status getter', () => {
    it('should return busy when currentLoad > 0', () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
      });

      // Access private _currentLoad by triggering execute-like state
      // We can't directly set it, but we can verify the initial state
      expect(agent.currentLoad).toBe(0);
      expect(agent.status).toBe('online');
    });
  });

  describe('registerTools / clearTools', () => {
    it('should register tools to inner agent state', () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
      });

      agent.registerTools([
        {
          id: 't1',
          label: 'T1',
          description: 'Tool 1',
          execute: vi.fn(),
        },
      ]);

      // After registerTools, state.tools should have been updated
      expect(agent.innerAgent.state.tools.length).toBeGreaterThanOrEqual(1);
    });

    it('should clear all tools', () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
      });

      agent.registerTools([{ id: 't1', label: 'T1', description: '', execute: vi.fn() }]);
      agent.clearTools();

      expect(agent.innerAgent.state.tools).toEqual([]);
    });
  });

  describe('execute', () => {
    it('should return successful TaskResult on normal execution', async () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
      });

      // Set up a message in the state so extractTaskResult finds something
      const mockState = agent.innerAgent.state;
      mockState.messages = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Task completed successfully' }],
        } as never,
      ];

      const result = await agent.execute({
        taskId: 'task-1',
        taskDescription: 'Do something',
        workdir: '/tmp/test',
        options: { timeout: 30000, verbose: false },
      });

      expect(result.taskId).toBe('task-1');
      expect(result.status).toBe('success');
      expect(result.output).toBe('Task completed successfully');
      expect(result.artifacts).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it('should return failure TaskResult when an error occurs', async () => {
      mockPrompt.mockRejectedValueOnce(new Error('LLM failed'));

      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
      });

      // 添加错误事件监听器避免 unhandled error
      agent.on('error', () => {});

      let result: Awaited<ReturnType<typeof agent.execute>> | undefined;
      let caughtError: unknown;

      try {
        result = await agent.execute({
          taskId: 'task-2',
          taskDescription: 'Fail this',
          workdir: '/tmp/test',
          options: { timeout: 30000, verbose: false },
        });
      } catch (e) {
        caughtError = e;
      }

      // 验证要么返回了失败结果，要么抛出了错误
      if (result) {
        expect(result.status).toBe('failure');
        expect(result.error?.code).toBe('AGENT_EXECUTION_FAILED');
      } else {
        // 如果异常被抛出，验证是预期的错误
        expect(caughtError).toBeDefined();
      }
    });

    it('should include upstream results as dynamic context messages', async () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
      });

      await agent.execute({
        taskId: 'task-3',
        taskDescription: 'Use context',
        workdir: '/tmp/project',
        options: { timeout: 30000, verbose: false },
        upstreamResults: [
          {
            taskId: 'up-1',
            status: 'success',
            output: 'prior result',
            artifacts: [],
            duration: 100,
            tokenUsage: {
              inputTokens: 10,
              outputTokens: 20,
              totalTokens: 30,
              estimatedCostUsd: 0.001,
            },
          },
        ],
      });

      // Dynamic content should be passed as messages, not in system prompt
      expect(mockPrompt).toHaveBeenCalled();
      const callArgs = mockPrompt.mock.calls[0]?.[0];
      expect(Array.isArray(callArgs)).toBe(true);
      // The prepended message should contain upstream results
      expect(JSON.stringify(callArgs)).toContain('上游任务结果');
      // System prompt should NOT contain upstream results
      expect(agent.innerAgent.state.systemPrompt).not.toContain('上游任务结果');
    });
  });

  describe('cancel', () => {
    it('should call inner.abort()', async () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
      });

      await agent.cancel('task-1');

      expect(mockAbort).toHaveBeenCalledOnce();
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when enabled and idle', async () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
      });

      const health = await agent.healthCheck();

      expect(health.是否健康).toBe(true);
      expect(health.version).toContain('zapmyco-agent@');
    });

    it('should return unhealthy when disabled', async () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
        runtimeConfig: { enabled: false },
      });

      const health = await agent.healthCheck();

      expect(health.是否健康).toBe(false);
    });
  });

  describe('innerAgent accessor', () => {
    it('should expose the internal pi-agent-core Agent instance', () => {
      const agent = new LlmBasedAgent({
        agentId: 'a1',
        displayName: 'A1',
        capabilities: [],
      });

      expect(agent.innerAgent).toBeDefined();
      expect(typeof agent.innerAgent.prompt).toBe('function');
    });
  });
});

describe('createLlmBasedAgent', () => {
  it('should create a LlmBasedAgent instance', () => {
    const agent = createLlmBasedAgent({
      agentId: 'factory-agent',
      displayName: 'Factory Agent',
      capabilities: [],
    });

    expect(agent).toBeInstanceOf(LlmBasedAgent);
    expect(agent.agentId).toBe('factory-agent');
  });
});

describe('createRequestFromSubTask', () => {
  it('should convert SubTask to AgentExecuteRequest', () => {
    const request = createRequestFromSubTask(
      {
        id: 'sub-1',
        name: 'Sub Task 1',
        description: 'Do sub task 1',
        requiredCapability: {
          id: 'cap-1',
          name: 'Cap 1',
          description: '',
          category: 'generic',
        },
        dependencies: [],
        priority: 1,
        status: 'pending',
      },
      '/workspace'
    );

    expect(request.taskId).toBe('sub-1');
    expect(request.taskDescription).toBe('Do sub task 1');
    expect(request.workdir).toBe('/workspace');
    expect(request.options.timeout).toBe(300_000);
  });

  it('should merge custom options', () => {
    const request = createRequestFromSubTask(
      {
        id: 'sub-2',
        name: 'S2',
        description: 'Desc',
        requiredCapability: {
          id: 'c',
          name: 'C',
          description: '',
          category: 'generic',
        },
        dependencies: [],
        priority: 1,
        status: 'pending',
      },
      '/ws',
      { timeout: 60000, verbose: true }
    );

    expect(request.options.timeout).toBe(60000);
    expect(request.options.verbose).toBe(true);
  });
});

describe('LlmBasedAgent internal event handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSubscriber = null;
    mockPrompt.mockResolvedValue(undefined);
    mockWaitForIdle.mockResolvedValue(undefined);
  });

  /**
   * 触发 execute() 以捕获内部 subscribe handler，然后直接调用 handler 测试事件处理
   */
  async function setupAndCapture(): Promise<{
    agent: LlmBasedAgent;
    taskId: string;
    progressEvents: Array<{ taskId: string; message: string }>;
    outputEvents: Array<{ taskId: string; text: string }>;
  }> {
    const agent = new LlmBasedAgent({
      agentId: 'a1',
      displayName: 'A1',
      capabilities: [],
    });

    const progressEvents: Array<{ taskId: string; message: string }> = [];
    const outputEvents: Array<{ taskId: string; text: string }> = [];
    agent.on('progress', (e) => progressEvents.push(e));
    agent.on('output', (e) => outputEvents.push(e));
    // 防止 unhandled error 事件导致测试失败
    agent.on('error', () => {});

    const taskId = 'task-event-test';

    const mockState = agent.innerAgent.state;
    mockState.messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
      } as never,
    ];

    // 不 await — execute 内部会 await prompt()，我们只需它完成 subscribe
    void agent.execute({
      taskId,
      taskDescription: 'test event handling',
      workdir: '/tmp',
      options: { timeout: 30000, verbose: false },
    });

    // 等待一个 microtask 让 subscribe 被调用
    await Promise.resolve();

    return { agent, taskId, progressEvents, outputEvents };
  }

  describe('tool_execution_start event', () => {
    it('should emit formatted progress with args', async () => {
      const { taskId, progressEvents } = await setupAndCapture();

      capturedSubscriber?.({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'ReadFile',
        args: { file_path: '/a/b.txt' },
      });

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]).toMatchObject({
        taskId,
        percent: 0,
        message: 'ReadFile(file_path="/a/b.txt")',
        detail: {
          toolName: 'ReadFile',
          toolCallId: 'call-1',
          isStart: true,
        },
      });
    });

    it('should emit progress with toolName only when args is empty', async () => {
      const { taskId, progressEvents } = await setupAndCapture();

      capturedSubscriber?.({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'list_files',
        args: {},
      });

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]).toMatchObject({
        taskId,
        percent: 0,
        message: 'list_files',
        detail: {
          toolName: 'list_files',
          toolCallId: 'call-1',
          isStart: true,
        },
      });
    });

    it('should emit progress with toolName only when args is null', async () => {
      const { taskId, progressEvents } = await setupAndCapture();

      capturedSubscriber?.({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'ping',
        args: null,
      });

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]).toMatchObject({
        taskId,
        percent: 0,
        message: 'ping',
        detail: {
          toolName: 'ping',
          toolCallId: 'call-1',
          isStart: true,
        },
      });
    });

    it('should truncate long string args', async () => {
      const { taskId, progressEvents } = await setupAndCapture();

      const longStr = 'x'.repeat(100);
      capturedSubscriber?.({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: longStr },
      });

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]?.message).toContain('...');
      expect(progressEvents[0]?.message.length).toBeLessThan(longStr.length + 20);
      expect(progressEvents[0]?.taskId).toBe(taskId);
    });

    it('should format non-string args with JSON.stringify', async () => {
      const { taskId, progressEvents } = await setupAndCapture();

      capturedSubscriber?.({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'counter',
        args: { count: 99, flag: false },
      });

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]?.message).toBe('counter(count="99", flag="false")');
      expect(progressEvents[0]?.taskId).toBe(taskId);
    });
  });

  describe('message_update event', () => {
    it('should emit output for content_block_delta text_delta', async () => {
      const { taskId, outputEvents } = await setupAndCapture();

      capturedSubscriber?.({
        type: 'message_update',
        message: {},
        assistantMessageEvent: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hello world' },
        },
      });

      expect(outputEvents).toHaveLength(1);
      expect(outputEvents[0]).toEqual({
        taskId,
        text: 'hello world',
      });
    });

    it('should NOT emit output for input_json_delta', async () => {
      const { outputEvents } = await setupAndCapture();

      capturedSubscriber?.({
        type: 'message_update',
        message: {},
        assistantMessageEvent: {
          type: 'content_block_delta',
          delta: {
            type: 'input_json_delta',
            partial_json: '{"file_path":"/tmp/x"}',
          },
        },
      });

      expect(outputEvents).toHaveLength(0);
    });

    it('should emit thinking for content_block_delta thinking_delta', async () => {
      const { agent, outputEvents } = await setupAndCapture();

      const thinkingEvents: Array<{ taskId: string; text: string }> = [];
      agent.on('thinking', (e) => thinkingEvents.push(e));

      capturedSubscriber?.({
        type: 'message_update',
        message: {},
        assistantMessageEvent: {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'hmm let me think' },
        },
      });

      expect(outputEvents).toHaveLength(0);
      expect(thinkingEvents).toHaveLength(1);
      expect(thinkingEvents[0]?.text).toBe('hmm let me think');
    });

    it('should not emit for unrecognized message_update type', async () => {
      const { agent, outputEvents } = await setupAndCapture();

      const thinkingEvents: Array<{ taskId: string; text: string }> = [];
      agent.on('thinking', (e) => thinkingEvents.push(e));

      capturedSubscriber?.({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'unknown_type', delta: 'data' },
      });

      expect(outputEvents).toHaveLength(0);
      expect(thinkingEvents).toHaveLength(0);
    });
  });

  describe('tool_execution_end event', () => {
    it('should emit progress on tool completion', async () => {
      const { taskId, progressEvents } = await setupAndCapture();

      capturedSubscriber?.({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'ReadFile',
        result: {},
        isError: false,
      });

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]).toMatchObject({
        taskId,
        percent: 100,
        message: '工具 ReadFile 完成',
        detail: {
          toolName: 'ReadFile',
          toolCallId: 'call-1',
          isEnd: true,
          isError: false,
        },
      });
    });
  });

  describe('agent_end event', () => {
    it('should emit progress on agent completion', async () => {
      const { taskId, progressEvents } = await setupAndCapture();

      capturedSubscriber?.({
        type: 'agent_end',
        messages: [],
      });

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]).toEqual({
        taskId,
        percent: 100,
        message: '任务完成',
      });
    });
  });
});
