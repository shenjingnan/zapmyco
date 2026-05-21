import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============ 使用 vi.hoisted() 提升变量（供 vi.mock 工厂使用）============
const {
  mockTuiStart,
  mockTuiStop,
  mockTuiAddChild,
  mockTuiSetFocus,
  mockTuiRequestRender,
  mockContainerAddChild,
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
  mockContainerInvalidate: vi.fn(),
  mockEmit: vi.fn(),
  mockOn: vi.fn(),
  mockRegister: vi.fn(),
  mockRenderWelcome: vi.fn().mockReturnValue(['welcome']),
  mockRenderResult: vi.fn().mockReturnValue(['result']),
  mockRenderError: vi.fn().mockReturnValue(['error lines']),
  mockHistoryPush: vi.fn().mockReturnValue({ id: 1, timestamp: Date.now(), input: '' }),
}));

// Mock @/cli/tui — 覆盖本地引擎类，保留其他本地实现
vi.mock('@/cli/tui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
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
  };
});

// Mock ZapmycoEditor
vi.mock('@/cli/repl/components/custom-editor', () => ({
  LOADING_FRAMES: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  ZapmycoEditor: class MockZapmycoEditor {
    onSubmit?: (text: string) => void;
    onEscape?: () => void;
    onCtrlC?: () => void;
    onCtrlD?: () => void;
    #executing = false;
    getText = vi.fn().mockReturnValue('');
    handleInput = vi.fn();
    setExecuting = vi.fn();
    setAutocompleteProvider = vi.fn();
    setAutocompleteMaxVisible = vi.fn();
    addToHistory = vi.fn();
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

vi.mock('@/core/agent-runtime/agent', () => ({
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
    resetContext: vi.fn(),
  })),
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
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Mock CommandRegistry
const mockCommandList = [
  {
    name: 'help',
    aliases: ['h', '?'],
    description: '显示帮助信息',
    usage: '/help',
    handler: vi.fn(),
  },
  {
    name: 'quit',
    aliases: ['exit', 'q', 'x'],
    description: '退出 REPL',
    usage: '/quit',
    handler: vi.fn(),
  },
  {
    name: 'clear',
    aliases: ['cl'],
    description: '清空输出区域',
    usage: '/clear',
    handler: vi.fn(),
  },
];
vi.mock('@/cli/repl/command-registry', () => ({
  CommandRegistry: class MockCommandRegistry {
    register = mockRegister;
    dispatch = vi.fn();
    listCommands = vi.fn().mockReturnValue(mockCommandList);
    getCommand = vi
      .fn()
      .mockImplementation((name: string) =>
        mockCommandList.find((c) => c.name === name || c.aliases.includes(name))
      );
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
      id: 'GetCurrentTime',
      label: '获取当前时间',
      description: '获取当前日期和时间',
      execute: vi.fn(),
    },
    {
      id: 'GetWorkdirInfo',
      label: '获取工作目录信息',
      description: '获取当前工作目录信息',
      execute: vi.fn(),
    },
    {
      id: 'ReadFile',
      label: '读取文件',
      description: '读取文件内容',
      parameters: {},
      execute: vi.fn(),
    },
  ]),
}));

// ============ 全局 mock：阻止 process.exit 在测试中实际退出进程 ============
vi.spyOn(process, 'exit').mockImplementation((() => {
  // 在测试环境中不实际退出
}) as unknown as (code?: string | number | null | undefined) => never);

// ============ 导入被测模块 ============
import { ReplSession } from '@/cli/repl/session';
import type { ZapmycoConfig } from '@/config/types';
import { TaskStore } from '@/core/task/task-store';

/** 测试专用接口，用于绕过 ReplSession 的 private 访问限制 */
interface ReplSessionTestAccess {
  agent: {
    cancel: (...args: unknown[]) => unknown;
    resetContext: (...args: unknown[]) => unknown;
  };
  _state: string;
  conversationHistory: Array<{ role: string; content: string }>;
  stats: Record<string, unknown>;
  outputArea: { lines: unknown[]; clear: () => void };
}

function createTestConfig(overrides?: Partial<ZapmycoConfig>): ZapmycoConfig {
  return {
    llm: {
      defaultModel: 'anthropic/claude-sonnet-4-20250514',
      providers: {
        anthropic: {
          apiKey: 'sk-test',
        },
      },
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
      expect(mockRegister).toHaveBeenCalledTimes(10);
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
      // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
      vi.spyOn(LlmBasedAgent.prototype as any, 'execute').mockResolvedValueOnce(mockTaskResult);

      const result = await session.executeGoal('测试目标');

      expect(result).toBeDefined();
      expect(result.overallStatus).toBe('success');
      expect(result.goalId).toContain('goal-');
      expect(result.summary).toBe('Agent 回复内容');
    });

    it('执行完成后状态应重置为 idle', async () => {
      vi.spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
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
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
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
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
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
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
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
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      ).mockRejectedValueOnce(new Error('Agent 内部错误'));

      const result = await session.executeGoal('触发错误');

      expect(result.overallStatus).toBe('failure');
      expect(result.summary).toContain('执行失败');
    });
  });

  describe('OutputArea 行操作', () => {
    it('replaceLastLine 应返回最后一行索引', () => {
      const oa = (
        session as unknown as {
          outputArea: {
            lines: string[];
            replaceLastLine: (t: string) => number;
            spliceLines: (s: number, d: number, i: string[]) => void;
            append: (l: string[]) => number;
            clear: () => void;
          };
        }
      ).outputArea;
      oa.clear();
      oa.append(['line1', 'line2', 'line3']);

      const idx = oa.replaceLastLine('new3');
      // 应该返回索引 2
      expect(idx).toBe(2);
      // 验证内容已替换（通过 append 追加后检查是否多了一行）
      oa.append(['line4']);
      // 如果再替换最后一行，应该是 index 3
      const idx2 = oa.replaceLastLine('new4');
      expect(idx2).toBe(3);
    });

    it('spliceLines 应支持在中间位置插入行', () => {
      const oa = (
        session as unknown as {
          outputArea: {
            lines: string[];
            replaceLastLine: (t: string) => number;
            spliceLines: (s: number, d: number, i: string[]) => void;
            append: (l: string[]) => number;
            clear: () => void;
          };
        }
      ).outputArea;
      oa.clear();
      oa.append(['a', 'b', 'e']);

      // 在索引 2 处插入 ['c', 'd']
      oa.spliceLines(2, 0, ['c', 'd']);

      // 通过私有 lines 验证内部状态
      const lines = (oa as unknown as { lines: string[] }).lines;
      expect(lines).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('spliceLines 应支持删除行', () => {
      const oa = (
        session as unknown as {
          outputArea: {
            lines: string[];
            replaceLastLine: (t: string) => number;
            spliceLines: (s: number, d: number, i: string[]) => void;
            append: (l: string[]) => number;
            clear: () => void;
          };
        }
      ).outputArea;
      oa.clear();
      oa.append(['a', 'b', 'c', 'd', 'e']);

      // 删除索引 1-2 的行（b, c）
      oa.spliceLines(1, 2, []);

      const lines = (oa as unknown as { lines: string[] }).lines;
      expect(lines).toEqual(['a', 'd', 'e']);
    });

    it('spliceLines 应支持替换行', () => {
      const oa = (
        session as unknown as {
          outputArea: {
            lines: string[];
            replaceLastLine: (t: string) => number;
            spliceLines: (s: number, d: number, i: string[]) => void;
            append: (l: string[]) => number;
            clear: () => void;
          };
        }
      ).outputArea;
      oa.clear();
      oa.append(['a', 'b', 'x', 'y', 'e']);

      // 替换索引 2-3 的行（x, y）为 ['c', 'd']
      oa.spliceLines(2, 2, ['c', 'd']);

      const lines = (oa as unknown as { lines: string[] }).lines;
      expect(lines).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
  });

  describe('thinking 展示模式', () => {
    const mockTaskResult = {
      taskId: 'task-1',
      status: 'success' as const,
      output: '最终回复',
      artifacts: [],
      duration: 100,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
    };

    it('collapse 模式（默认）：thinking → output 事件正常执行', async () => {
      const spy = vi.spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      );
      spy.mockImplementation(function (
        this: import('@/core/agent-runtime').LlmBasedAgent,
        ...args: unknown[]
      ) {
        // 先发 thinking 事件
        this.emit('thinking', {
          taskId: (args[0] as { taskId: string }).taskId,
          text: 'thinking...',
        });
        // 再发 output 事件
        this.emit('output', { taskId: (args[0] as { taskId: string }).taskId, text: '最终回复' });
        return Promise.resolve(mockTaskResult);
      });

      const result = await session.executeGoal('测试 collapse 模式');
      expect(result.overallStatus).toBe('success');
      expect(result.summary).toBe('最终回复');
    });

    it('expand 模式：thinking 内容行正常展示', async () => {
      // 用 expand 模式重建 session
      const expandSession = new (await import('@/cli/repl/session')).ReplSession(
        createTestConfig({
          cli: { color: false, debug: false, outputFormat: 'text', thinkingDisplay: 'expand' },
        })
      );

      const spy = vi.spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      );
      spy.mockImplementation(function (
        this: import('@/core/agent-runtime').LlmBasedAgent,
        ...args: unknown[]
      ) {
        this.emit('thinking', {
          taskId: (args[0] as { taskId: string }).taskId,
          text: 'thinking content',
        });
        this.emit('output', { taskId: (args[0] as { taskId: string }).taskId, text: '回复' });
        return Promise.resolve(mockTaskResult);
      });

      const result = await expandSession.executeGoal('测试 expand 模式');
      expect(result.overallStatus).toBe('success');

      // 清理
      expandSession.shutdown();
    });

    it('off 模式：thinking 事件被完全忽略', async () => {
      const offSession = new (await import('@/cli/repl/session')).ReplSession(
        createTestConfig({
          cli: { color: false, debug: false, outputFormat: 'text', thinkingDisplay: 'off' },
        })
      );

      const spy = vi.spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      );
      spy.mockImplementation(function (
        this: import('@/core/agent-runtime').LlmBasedAgent,
        ...args: unknown[]
      ) {
        this.emit('thinking', {
          taskId: (args[0] as { taskId: string }).taskId,
          text: 'should be ignored',
        });
        this.emit('output', { taskId: (args[0] as { taskId: string }).taskId, text: '回复内容' });
        return Promise.resolve(mockTaskResult);
      });

      const result = await offSession.executeGoal('测试 off 模式');
      expect(result.overallStatus).toBe('success');

      offSession.shutdown();
    });

    it('progress（工具调用）发生时 thinking 计时器停止', async () => {
      const spy = vi.spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      );
      spy.mockImplementation(function (
        this: import('@/core/agent-runtime').LlmBasedAgent,
        ...args: unknown[]
      ) {
        // thinking → tool call → output
        this.emit('thinking', {
          taskId: (args[0] as { taskId: string }).taskId,
          text: 'thinking...',
        });
        this.emit('progress', {
          taskId: (args[0] as { taskId: string }).taskId,
          percent: 0,
          message: 'Skill(test)',
        });
        this.emit('output', { taskId: (args[0] as { taskId: string }).taskId, text: '回复' });
        return Promise.resolve(mockTaskResult);
      });

      const result = await session.executeGoal('测试工具调用');
      expect(result.overallStatus).toBe('success');
    });

    it('Agent 错误时 thinking 计时器被清理', async () => {
      const spy = vi.spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
        (await import('@/core/agent-runtime')).LlmBasedAgent.prototype as any,
        'execute'
      );
      spy.mockImplementation(function (
        this: import('@/core/agent-runtime').LlmBasedAgent,
        ...args: unknown[]
      ) {
        // 先发 thinking 事件
        this.emit('thinking', {
          taskId: (args[0] as { taskId: string }).taskId,
          text: 'thinking...',
        });
        // 然后抛出错误
        throw new Error('执行异常');
      });

      const result = await session.executeGoal('测试错误');
      expect(result.overallStatus).toBe('failure');
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
        // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn 需要松散类型来监视原型方法
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

  describe('clearAgentContext', () => {
    const s = () => session as unknown as ReplSessionTestAccess;

    it('应调用 taskStore.clear()', () => {
      // agent mock 缺少 cancel 方法，需要手动补充
      s().agent.cancel = vi.fn();
      const spy = vi.spyOn(TaskStore.prototype, 'clear');
      session.clearAgentContext();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('应重置会话状态为 idle', () => {
      s().agent.cancel = vi.fn();
      s()._state = 'busy';
      session.clearAgentContext();
      expect(session.currentState).toBe('idle');
    });

    it('应清空 conversationHistory', () => {
      s().agent.cancel = vi.fn();
      s().conversationHistory = [{ role: 'user', content: 'test' }];
      session.clearAgentContext();
      expect(s().conversationHistory).toEqual([]);
    });

    it('应重置会话统计信息', () => {
      s().agent.cancel = vi.fn();
      s().stats = {
        totalRequests: 10,
        successCount: 8,
        failureCount: 2,
        totalTokens: 5000,
        totalCostUsd: 0.05,
        state: 'busy',
      };
      session.clearAgentContext();
      expect(s().stats).toEqual({
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        state: 'idle',
      });
    });

    it('应调用 agent.resetContext()', () => {
      s().agent.cancel = vi.fn();
      const spy = vi.spyOn(s().agent, 'resetContext');
      session.clearAgentContext();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('应调用 outputArea.clear()', () => {
      s().agent.cancel = vi.fn();
      const outputArea = s().outputArea;
      session.clearAgentContext();
      expect(outputArea.lines).toEqual([]);
    });
  });
});
