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
    constructor(_text: string, _height: number, _width: number) {}
  },
}));

// Mock ZapmycoEditor
vi.mock('../../../cli/repl/components/custom-editor.js', () => ({
  ZapmycoEditor: class MockZapmycoEditor {
    onSubmit?: (text: string) => void;
    onEscape?: () => void;
    onCtrlC?: () => void;
    onCtrlD?: () => void;
    getText = vi.fn().mockReturnValue('');
    handleInput = vi.fn();
    constructor(_tui: unknown, _theme: unknown) {}
  },
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
vi.mock('../../../cli/repl/command-registry.js', () => ({
  CommandRegistry: class MockCommandRegistry {
    register = mockRegister;
    dispatch = vi.fn();
  },
}));

// Mock 内置命令
vi.mock('../../../cli/repl/commands/help.js', () => ({
  createHelpCommand: vi.fn().mockReturnValue({
    name: 'help',
    aliases: ['h'],
    description: '显示帮助',
    usage: '/help',
    handler: vi.fn(),
  }),
}));
vi.mock('../../../cli/repl/commands/quit.js', () => ({
  createQuitCommand: vi.fn().mockReturnValue({
    name: 'quit',
    aliases: ['q'],
    description: '退出',
    usage: '/quit',
    handler: vi.fn(),
  }),
}));
vi.mock('../../../cli/repl/commands/clear.js', () => ({
  createClearCommand: vi.fn().mockReturnValue({
    name: 'clear',
    aliases: [],
    description: '清空屏幕',
    usage: '/clear',
    handler: vi.fn(),
  }),
}));
vi.mock('../../../cli/repl/commands/history.js', () => ({
  createHistoryCommand: vi.fn().mockReturnValue({
    name: 'history',
    aliases: [],
    description: '历史记录',
    usage: '/history',
    handler: vi.fn(),
  }),
}));
vi.mock('../../../cli/repl/commands/config-cmd.js', () => ({
  createConfigCommand: vi.fn().mockReturnValue({
    name: 'config',
    aliases: [],
    description: '配置信息',
    usage: '/config',
    handler: vi.fn(),
  }),
}));
vi.mock('../../../cli/repl/commands/agents-cmd.js', () => ({
  createAgentsCommand: vi.fn().mockReturnValue({
    name: 'agents',
    aliases: [],
    description: 'Agent 列表',
    usage: '/agents',
    handler: vi.fn(),
  }),
}));
vi.mock('../../../cli/repl/commands/status.js', () => ({
  createStatusCommand: vi.fn().mockReturnValue({
    name: 'status',
    aliases: [],
    description: '会话状态',
    usage: '/status',
    handler: vi.fn(),
  }),
}));

// Mock InputParser
vi.mock('../../../cli/repl/input-parser.js', () => ({
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
vi.mock('../../../cli/repl/renderer.js', () => ({
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
vi.mock('../../../cli/repl/history-store.js', () => ({
  HistoryStore: class MockHistoryStore {
    push = mockHistoryPush;
    getAll = vi.fn().mockReturnValue([]);
    getLast = vi.fn().mockReturnValue([]);
    clear = vi.fn();
    search = vi.fn().mockReturnValue([]);
    constructor(_maxSize: number) {}
  },
}));

import type { ZapmycoConfig } from '@/config/types';
// ============ 导入被测模块 ============
import { ReplSession } from '../../../cli/repl/session.js';

function createTestConfig(overrides?: Partial<ZapmycoConfig>): ZapmycoConfig {
  return {
    llm: { provider: 'anthropic', apiKey: 'sk-test' },
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
      await session.start();

      expect(mockRenderWelcome).toHaveBeenCalled();
    });
  });

  describe('shutdown()', () => {
    it('应设置状态为 shutting-down 并停止 TUI', async () => {
      await session.shutdown('测试关闭');

      expect(session.currentState).toBe('shutting-down');
      expect(mockTuiStop).toHaveBeenCalledTimes(1);
    });

    it('应发布 system:shutdown 事件', async () => {
      await session.shutdown('用户退出');

      expect(mockEmit).toHaveBeenCalledWith('system:shutdown', { reason: '用户退出' });
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
    it('应返回模拟 FinalResult', async () => {
      const result = await session.executeGoal('测试目标');

      expect(result).toBeDefined();
      expect(result.overallStatus).toBe('success');
      expect(result.goalId).toContain('goal-');
      expect(result.summary).toContain('测试目标');
    });

    it('执行完成后状态应重置为 idle', async () => {
      await session.executeGoal('测试');

      expect(session.currentState).toBe('idle');
    });

    it('应更新统计信息：totalRequests 和 successCount', async () => {
      await session.executeGoal('测试');

      const stats = session.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(0);
    });

    it('应发布 goal:submitted 和 goal:completed 事件', async () => {
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
      const longInput = 'a'.repeat(200);
      const result = await session.executeGoal(longInput);

      // summary 格式: [模拟] 已接收目标: {rawInput.slice(0,80)}...
      // 前缀长度约 12 字符 + 80 + "..." = 95
      expect(result.summary).toContain('...');
      expect(result.summary.length).toBeLessThanOrEqual(95);
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
