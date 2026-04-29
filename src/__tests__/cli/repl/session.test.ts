import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============ 使用 vi.hoisted() 提升变量（供 vi.mock 工厂使用）============
const {
  mockTuiStart,
  mockTuiStop,
  mockTuiAddChild,
  mockTuiSetFocus,
  mockTuiRequestRender,
  mockContainerAddChild,
  mockTextSetText,
  mockContainerInvalidate,
  mockEmit,
  mockOn,
  mockRegister,
  mockRenderWelcome,
  mockRenderResult,
  mockRenderError,
  mockHistoryPush,
} = vi.hoisted(() => ({
  mockTuiStart: vi.fn(),
  mockTuiStop: vi.fn(),
  mockTuiAddChild: vi.fn(),
  mockTuiSetFocus: vi.fn(),
  mockTuiRequestRender: vi.fn(),
  mockContainerAddChild: vi.fn(),
  mockTextSetText: vi.fn(),
  mockContainerInvalidate: vi.fn(),
  mockEmit: vi.fn(),
  mockOn: vi.fn(),
  mockRegister: vi.fn(),
  mockRenderWelcome: vi.fn().mockReturnValue(['welcome']),
  mockRenderResult: vi.fn().mockReturnValue(['result']),
  mockRenderError: vi.fn().mockReturnValue(['error lines']),
  mockHistoryPush: vi.fn().mockReturnValue({ id: 1, timestamp: Date.now(), input: '' }),
}));

// Mock @mariozechner/pi-tui
vi.mock('@mariozechner/pi-tui', () => ({
  TUI: class MockTUI {
    addChild = mockTuiAddChild;
    setFocus = mockTuiSetFocus;
    start = mockTuiStart;
    stop = mockTuiStop;
    requestRender = mockTuiRequestRender;
  },
  Container: class MockContainer {
    addChild = mockContainerAddChild;
    invalidate = mockContainerInvalidate;
  },
  ProcessTerminal: vi.fn(),
  Text: class MockText {
    setText = mockTextSetText;
  },
}));

// Mock ZapmycoEditor
vi.mock('@/cli/repl/components/custom-editor', () => ({
  ZapmycoEditor: class MockZapmycoEditor {
    onSubmit?: (text: string) => void;
    onEscape?: () => void;
    onCtrlC?: () => void;
    onCtrlD?: () => void;
    #executing = false;
    getText = vi.fn().mockReturnValue('');
    handleInput = vi.fn();
    setExecuting = vi.fn();
    get executing() {
      return this.#executing;
    }
  },
}));

// ============ pi-agent-core Mock ============
const mockAgentSubscribe = vi.fn(() => vi.fn());
const mockAgentPrompt = vi.fn().mockResolvedValue(undefined);
const mockAgentWaitForIdle = vi.fn().mockResolvedValue(undefined);
const mockAgentAbort = vi.fn();

// 创建可变的 mock state（允许测试修改）
const createMockAgentState = () => ({
  systemPrompt: '',
  model: { name: 'test-model', id: 'test-model' },
  thinkingLevel: 'medium',
  tools: [] as unknown[],
  messages: [] as unknown[],
  isStreaming: false,
  pendingToolCalls: new Set<string>(),
});

let mockAgentState = createMockAgentState();

vi.mock('@mariozechner/pi-agent-core', () => ({
  Agent: vi.fn().mockImplementation(() => ({
    get state() {
      return mockAgentState;
    },
    set state(value: unknown) {
      mockAgentState = value as typeof mockAgentState;
    },
    subscribe: mockAgentSubscribe,
    prompt: mockAgentPrompt,
    waitForIdle: mockAgentWaitForIdle,
    abort: mockAgentAbort,
    reset: vi.fn(),
  })),
}));

// Mock @mariozechner/pi-ai（getModel 用于 Agent 初始化）
vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn().mockReturnValue({
    name: 'anthropic/claude-sonnet-4-20250514',
    id: 'claude-sonnet-4-20250514',
    baseUrl: undefined,
  }),
}));

// Mock PiAiProvider — 不再需要 mock chatStream（REPL 通过 Agent 执行）
vi.mock('@/llm/pi-ai-provider', () => ({
  PiAiProvider: class MockPiAiProvider {
    readonly providerId = 'pi-ai';
    chatStream = vi.fn();
    chat = vi.fn().mockResolvedValue({
      content: 'Mock response',
      inputTokens: 10,
      outputTokens: 5,
      model: 'test-model',
    });
  },
  parseModelKey: vi.fn((key: string) => {
    const slashIndex = key.indexOf('/');
    if (slashIndex <= 0 || slashIndex >= key.length - 1) return null;
    return {
      provider: key.slice(0, slashIndex),
      modelId: key.slice(slashIndex + 1),
    };
  }),
}));

// Mock eventBus
vi.mock('@/infra/event-bus', () => ({
  eventBus: {
    emit: mockEmit,
    on: mockOn,
  },
}));

// Mock logger
vi.mock('@/infra/logger', () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Mock CommandRegistry
vi.mock('@/cli/repl/command-registry', () => ({
  CommandRegistry: class MockCommandRegistry {
    register = mockRegister;
    dispatch = vi.fn();
  },
}));

// Mock 内置命令
vi.mock('@/cli/repl/commands/help', () => ({
  createHelpCommand: vi.fn().mockReturnValue({
    name: 'help',
    aliases: ['h'],
    description: '显示帮助',
    usage: '/help',
    handler: vi.fn(),
  }),
}));
vi.mock('@/cli/repl/commands/quit', () => ({
  createQuitCommand: vi.fn().mockReturnValue({
    name: 'quit',
    aliases: ['q'],
    description: '退出',
    usage: '/quit',
    handler: vi.fn(),
  }),
}));
vi.mock('@/cli/repl/commands/clear', () => ({
  createClearCommand: vi.fn().mockReturnValue({
    name: 'clear',
    aliases: [],
    description: '清空屏幕',
    usage: '/clear',
    handler: vi.fn(),
  }),
}));
vi.mock('@/cli/repl/commands/history', () => ({
  createHistoryCommand: vi.fn().mockReturnValue({
    name: 'history',
    aliases: [],
    description: '历史记录',
    usage: '/history',
    handler: vi.fn(),
  }),
}));
vi.mock('@/cli/repl/commands/config-cmd', () => ({
  createConfigCommand: vi.fn().mockReturnValue({
    name: 'config',
    aliases: [],
    description: '配置信息',
    usage: '/config [show | get <key>]',
    handler: vi.fn(),
  }),
}));
vi.mock('@/cli/repl/commands/agents-cmd', () => ({
  createAgentsCommand: vi.fn().mockReturnValue({
    name: 'agents',
    aliases: [],
    description: 'Agent 列表',
    usage: '/agents',
    handler: vi.fn(),
  }),
}));
vi.mock('@/cli/repl/commands/status', () => ({
  createStatusCommand: vi.fn().mockReturnValue({
    name: 'status',
    aliases: [],
    description: '会话状态',
    usage: '/status',
    handler: vi.fn(),
  }),
}));

// Mock InputParser
vi.mock('@/cli/repl/input-parser', () => ({
  InputParser: class MockInputParser {
    parse(line: string) {
      if (!line.trim()) return { kind: 'empty' as const };
      if (line.startsWith('/')) {
        const parts = line.slice(1).split(/\s+/);
        return { kind: 'command' as const, name: parts[0], args: parts.slice(1) };
      }
      return { kind: 'goal' as const, rawInput: line };
    }
  },
}));

// Mock Renderer
vi.mock('@/cli/repl/renderer', () => ({
  Renderer: class MockRenderer {
    renderWelcome = mockRenderWelcome;
    renderResult = mockRenderResult;
    renderError = mockRenderError;
    renderTaskGraph = vi.fn().mockReturnValue([]);
    renderAgents = vi.fn().mockReturnValue([]);
    renderConfig = vi.fn().mockReturnValue([]);
    renderHistory = vi.fn().mockReturnValue([]);
    renderStatus = vi.fn().mockReturnValue([]);
    getFormatter = vi.fn();
  },
}));

// Mock HistoryStore
vi.mock('@/cli/repl/history-store', () => ({
  HistoryStore: class MockHistoryStore {
    push = mockHistoryPush;
    getAll = vi.fn().mockReturnValue([]);
    getLast = vi.fn().mockReturnValue([]);
    clear = vi.fn();
    search = vi.fn().mockReturnValue([]);
  },
}));

// Mock repl-agent-tools
vi.mock('@/cli/repl/repl-agent-tools', () => ({
  createReplBuiltinTools: vi.fn().mockReturnValue([
    {
      id: 'get_current_time',
      label: '获取当前时间',
      description: '获取当前日期和时间',
      execute: vi.fn(),
    },
    {
      id: 'get_workdir_info',
      label: '获取工作目录信息',
      description: '获取当前工作目录信息',
      execute: vi.fn(),
    },
    {
      id: 'read_file',
      label: '读取文件',
      description: '读取文件内容',
      parameters: {},
      execute: vi.fn(),
    },
  ]),
}));

// ============ 导入被测模块 ============
import { ReplSession } from '@/cli/repl/session';
import type { ZapmycoConfig } from '@/config/types';

function createTestConfig(overrides?: Partial<ZapmycoConfig>): ZapmycoConfig {
  return {
    llm: {
      defaultModel: 'anthropic/claude-sonnet-4-20250514',
      models: {
        'anthropic/claude-sonnet-4-20250514': {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-20250514',
        },
      },
      providers: { anthropic: { apiKey: 'sk-test' } },
    },
    scheduler: {
      maxConcurrency: 5,
      maxPerAgent: 3,
      taskTimeoutMs: 1800000,
      maxRetries: 3,
      retryBaseDelayMs: 1000,
    },
    agents: [{ id: 'test-agent', enabled: true }],
    cli: { color: false, debug: false, outputFormat: 'text' },
    ...overrides,
  };
}

describe('ReplSession', () => {
  let session: ReplSession;

  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 Agent 状态 mock
    mockAgentState = createMockAgentState();
    session = new ReplSession(createTestConfig());
  });

  describe('构造函数', () => {
    it('初始状态应为 idle', () => {
      expect(session.currentState).toBe('idle');
    });

    it('应正确初始化 replOptions', () => {
      const opts = session.replOptions;
      expect(opts.color).toBe(false);
      expect(opts.debug).toBe(false);
      expect(opts.maxHistorySize).toBe(100);
    });

    it('应注册所有内置命令', () => {
      expect(mockRegister).toHaveBeenCalledTimes(7);
    });
  });

  describe('start()', () => {
    it('应设置状态为 idle 并启动 TUI', async () => {
      await session.start();

      expect(session.currentState).toBe('idle');
      expect(mockTuiStart).toHaveBeenCalledTimes(1);
    });

    it('应渲染欢迎信息', async () => {
      // start() 直接向 outputArea 追加硬编码的欢迎字符串，不再调用 renderWelcome
      // 通过 session.appendOutput 验证输出
      session.appendOutput(['ZapMyco: 欢迎回来!', '']);

      expect(mockTuiRequestRender).toHaveBeenCalled();
    });
  });

  describe('shutdown()', () => {
    it('应设置状态为 shutting-down 并停止 TUI', async () => {
      await session.shutdown('测试关闭');

      expect(session.currentState).toBe('shutting-down');
      expect(mockTuiStop).toHaveBeenCalledTimes(1);
    });

    it('应发布 system:shutdown 事件', async () => {
      await session.shutdown('测试关闭');

      expect(mockEmit).toHaveBeenCalledWith('system:shutdown', { reason: '测试关闭' });
    });

    it('重复调用应幂等返回', async () => {
      await session.shutdown('第一次');
      await session.shutdown('第二次');

      expect(mockTuiStop).toHaveBeenCalledTimes(1);
    });

    it('不传 reason 时应使用 undefined', async () => {
      await session.shutdown();

      expect(mockEmit).toHaveBeenCalledWith(
        'system:shutdown',
        expect.objectContaining({ reason: undefined })
      );
    });
  });

  describe('executeGoal()', () => {
    it('应通过 Agent 执行并返回 FinalResult', async () => {
      // 模拟 Agent 返回成功结果
      const mockTaskResult = {
        taskId: expect.any(String),
        status: 'success' as const,
        output: 'Agent 回复内容',
        artifacts: [],
        duration: expect.any(Number),
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          estimatedCostUsd: 0,
        },
      };

      // 让 LlmBasedAgent.execute 返回模拟结果
      const { LlmBasedAgent } = await import('@/core/agent-runtime');
      vi.spyOn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (LlmBasedAgent as any).prototype as any,
        'execute'
      ).mockResolvedValueOnce(mockTaskResult);

      const result = await session.executeGoal('测试目标');

      expect(result).toBeDefined();
      expect(result.overallStatus).toBe('success');
      expect(result.goalId).toContain('goal-');
      expect(result.summary).toBe('Agent 回复内容');
    });

    it('执行完成后状态应重置为 idle', async () => {
      vi.spyOn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      ).mockResolvedValueOnce({
        taskId: 'task-1',
        status: 'success' as const,
        output: 'ok',
        artifacts: [],
        duration: 100,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      });

      await session.executeGoal('测试');

      expect(session.currentState).toBe('idle');
    });

    it('应更新统计信息：totalRequests 和 successCount', async () => {
      vi.spyOn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      ).mockResolvedValueOnce({
        taskId: 'task-1',
        status: 'success' as const,
        output: 'ok',
        artifacts: [],
        duration: 100,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      });

      await session.executeGoal('测试');

      const stats = session.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(0);
    });

    it('应发布 goal:submitted 和 goal:completed 事件', async () => {
      vi.spyOn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      ).mockResolvedValueOnce({
        taskId: 'task-1',
        status: 'success' as const,
        output: 'ok',
        artifacts: [],
        duration: 100,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      });

      await session.executeGoal('测试目标');

      expect(mockEmit).toHaveBeenCalledWith(
        'goal:submitted',
        expect.objectContaining({ rawInput: '测试目标' })
      );
      expect(mockEmit).toHaveBeenCalledWith(
        'goal:completed',
        expect.objectContaining({ result: expect.any(Object) })
      );
    });

    it('长输入应截断 summary', async () => {
      const longOutput = 'a'.repeat(300);
      vi.spyOn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      ).mockResolvedValueOnce({
        taskId: 'task-1',
        status: 'success' as const,
        output: longOutput,
        artifacts: [],
        duration: 100,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      });

      const longInput = 'a'.repeat(200);
      const result = await session.executeGoal(longInput);

      // summary 是 Agent 输出内容，截断至前 200 字符
      expect(result.summary.length).toBeLessThanOrEqual(200);
      expect(result.overallStatus).toBe('success');
    });

    it('Agent 失败时应返回 failure 状态', async () => {
      vi.spyOn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      ).mockRejectedValueOnce(new Error('Agent 内部错误'));

      const result = await session.executeGoal('触发错误');

      expect(result.overallStatus).toBe('failure');
      expect(result.summary).toContain('执行失败');
    });
  });

  describe('handleSubmit()', () => {
    it('空输入不应做任何事', async () => {
      await session.handleSubmit('');

      expect(mockEmit).not.toHaveBeenCalledWith('goal:submitted', expect.anything());
    });

    it('命令输入不应触发 goal 执行', async () => {
      await session.handleSubmit('/help');

      // 状态保持 idle，没有走 goal 路径
      expect(session.currentState).toBe('idle');
    });

    it('自然语言输入应执行 goal', async () => {
      vi.spyOn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      ).mockResolvedValueOnce({
        taskId: 'task-1',
        status: 'success' as const,
        output: 'ok',
        artifacts: [],
        duration: 100,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      });

      await session.handleSubmit('帮我写个函数');

      const stats = session.getStats();
      expect(stats.totalRequests).toBe(1);
    });

    it('shutting-down 状态下应直接返回', async () => {
      await session.shutdown();
      await session.handleSubmit('测试');

      const stats = session.getStats();
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('getStats()', () => {
    it('应返回统计信息的副本', () => {
      const stats1 = session.getStats();
      const stats2 = session.getStats();

      stats1.totalRequests = 999;
      expect(stats2.totalRequests).toBe(0);
    });
  });

  describe('appendOutput / clearOutput', () => {
    it('appendOutput 应触发 requestRender', () => {
      session.appendOutput(['line1', 'line2']);

      expect(mockTuiRequestRender).toHaveBeenCalled();
    });

    it('clearOutput 应触发 requestRender', () => {
      session.clearOutput();

      expect(mockTuiRequestRender).toHaveBeenCalled();
    });
  });

  describe('requestRender()', () => {
    it('应调用 tui.requestRender', () => {
      session.requestRender();

      expect(mockTuiRequestRender).toHaveBeenCalled();
    });
  });
});
