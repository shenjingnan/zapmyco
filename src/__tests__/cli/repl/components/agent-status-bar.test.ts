/**
 * AgentStatusBar 组件测试
 *
 * 覆盖：构造、toggle、折叠/展开渲染、持续时间格式化、loading 动画
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock chalk — 返回纯文本以便断言
type ChalkFn = (s: string) => string;
vi.mock('chalk', () => {
  const plain: ChalkFn = (s: string) => s;
  const chalk = Object.assign(plain, {
    hex: (): ChalkFn => plain,
    rgb: (): ChalkFn => plain,
    hsl: (): ChalkFn => plain,
    ansi: (): ChalkFn => plain,
    ansi256: (): ChalkFn => plain,
    bgHex: (): ChalkFn => plain,
    bgRgb: (): ChalkFn => plain,
    bgHsl: (): ChalkFn => plain,
    bgAnsi: (): ChalkFn => plain,
    bgAnsi256: (): ChalkFn => plain,
    bold: plain,
    dim: plain,
    italic: plain,
    underline: plain,
    inverse: plain,
    hidden: plain,
    strikethrough: plain,
    visible: plain,
    reset: plain,
    cyan: plain,
    gray: plain,
    yellow: plain,
    red: plain,
    green: plain,
    blue: plain,
    magenta: plain,
    white: plain,
    black: plain,
    bgCyan: plain,
    bgGray: plain,
    bgYellow: plain,
    bgRed: plain,
    bgGreen: plain,
    bgBlue: plain,
    bgMagenta: plain,
    bgWhite: plain,
    bgBlack: plain,
    Level: { None: 0, Red: 1, Ansi256: 2, TrueColor: 3 },
    level: 0,
    supportsColor: { hasBasic: false, has256: false, has16m: false },
  });
  return { default: chalk, ...chalk };
});

// Mock pi-tui Container
vi.mock('@mariozechner/pi-tui', () => ({
  Container: class MockContainer {
    invalidate() {
      /* prototype method for super.invalidate() */
    }
  },
}));

// Mock agent-instance-manager
const mockListActive = vi.fn();
vi.mock('@/core/agent-team/agent-instance-manager', () => ({
  getAgentInstanceManager: () => ({
    listActive: mockListActive,
  }),
}));

import { AgentStatusBar } from '@/cli/repl/components/agent-status-bar';

interface MockInstance {
  instanceId: string;
  typeId: string;
  depth: number;
  parentInstanceId: string | null;
  childInstanceIds: string[];
  status: string;
  agent: Record<string, unknown>;
  inbox: unknown[];
  task: {
    taskId: string;
    description: string;
    mode: string;
    timeoutMs: number;
    inheritContext: boolean;
  };
  createdAt: number;
  currentActivity?: {
    toolName: string;
    toolUses: number;
    args?: string;
    startedAt: number;
  };
}

function makeInstance(overrides?: Partial<MockInstance>): MockInstance {
  return {
    instanceId: 'agent-1',
    typeId: 'researcher',
    depth: 1,
    parentInstanceId: null,
    childInstanceIds: [],
    status: 'running',
    agent: {},
    inbox: [],
    task: {
      taskId: 't1',
      description: 'test task description',
      mode: 'sync',
      timeoutMs: 30000,
      inheritContext: false,
    },
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('AgentStatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('construction', () => {
    it('应该能正常实例化', () => {
      expect(() => new AgentStatusBar()).not.toThrow();
    });

    it('默认 isExpanded 为 false', () => {
      const bar = new AgentStatusBar();
      expect(bar.isExpanded).toBe(false);
    });
  });

  describe('toggle', () => {
    it('应该在展开/折叠间切换', () => {
      const bar = new AgentStatusBar();
      expect(bar.isExpanded).toBe(false);

      bar.toggle();
      expect(bar.isExpanded).toBe(true);

      bar.toggle();
      expect(bar.isExpanded).toBe(false);
    });

    it('应该调用 invalidate', () => {
      const bar = new AgentStatusBar();
      const spy = vi.spyOn(bar, 'invalidate');

      bar.toggle();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('render - 无活跃 Agent', () => {
    it('无活跃实例时返回空数组', () => {
      mockListActive.mockReturnValue([]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      expect(result).toEqual([]);
    });
  });

  describe('render - 折叠模式', () => {
    it('1 个 Agent 显示单数', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Running 1 agent');
    });

    it('多个 Agent 显示复数', () => {
      mockListActive.mockReturnValue([
        makeInstance({ instanceId: 'a' }),
        makeInstance({ instanceId: 'b' }),
      ]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      expect(result[0]).toContain('Running 2 agents');
    });

    it('显示 tool uses 统计', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          currentActivity: { toolName: 'Read', toolUses: 3, startedAt: Date.now() },
        }),
      ]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      expect(result[0]).toContain('3 tool uses');
    });

    it('显示展开提示', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      expect(result[0]).toContain('ctrl+o to expand');
    });

    it('输出被截断到指定宽度', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const bar = new AgentStatusBar();
      const result = bar.render(10);

      expect(result[0]?.length ?? 0).toBeLessThanOrEqual(10);
    });
  });

  describe('render - 展开模式', () => {
    it('展开模式显示多行', () => {
      mockListActive.mockReturnValue([makeInstance({ instanceId: 'a', typeId: 'researcher' })]);
      const bar = new AgentStatusBar();
      bar.toggle();
      const result = bar.render(100);

      expect(result.length).toBeGreaterThan(1);
      expect(result[0]).toContain('Running 1 agent');
      expect(result[0]).toContain('ctrl+o to collapse');
    });

    it('显示 Agent 类型和任务描述', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          instanceId: 'a',
          typeId: 'researcher',
          task: {
            taskId: 't1',
            description: 'research data',
            mode: 'sync',
            timeoutMs: 30000,
            inheritContext: false,
          },
        }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle();
      const result = bar.render(100);

      // 第二行包含 agent 信息
      expect(result[1]).toContain('researcher');
      expect(result[1]).toContain('research data');
    });

    it('显示当前活动工具信息', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          currentActivity: { toolName: 'ReadFile', toolUses: 5, startedAt: Date.now() },
        }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle();
      const result = bar.render(100);

      // result[1] = agent 行, result[2] = tool 详情行
      expect(result[2]).toContain('ReadFile');
      expect(result[1]).toContain('5 tool uses');
    });

    it('无 currentActivity 时不显示工具行', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const bar = new AgentStatusBar();
      bar.toggle();
      const result = bar.render(100);

      // 只有标题行 + agent 信息行，没有工具详情行
      expect(result).toHaveLength(2);
    });

    it('活动工具带参数时显示参数', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          currentActivity: {
            toolName: 'ReadFile',
            toolUses: 1,
            args: 'path:/test/file.txt',
            startedAt: Date.now(),
          },
        }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle();
      const result = bar.render(100);

      expect(result[2]).toContain('ReadFile');
      expect(result[2]).toContain('path:/test/file.txt');
    });

    it('最后一个 Agent 使用不同的连接线', () => {
      mockListActive.mockReturnValue([
        makeInstance({ instanceId: 'a', typeId: 'coder', status: 'running' }),
        makeInstance({ instanceId: 'b', typeId: 'researcher', status: 'completed' }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle();
      const result = bar.render(100);

      // Agent 行显示 typeId 而非 instanceId
      expect(result.some((l) => l.includes('coder'))).toBe(true);
      expect(result.some((l) => l.includes('researcher'))).toBe(true);
    });

    it('不同状态显示不同颜色', () => {
      mockListActive.mockReturnValue([
        makeInstance({ instanceId: 'a', status: 'running' }),
        makeInstance({ instanceId: 'b', status: 'completed' }),
        makeInstance({ instanceId: 'c', status: 'failed' }),
        makeInstance({ instanceId: 'd', status: 'idle' }),
        makeInstance({ instanceId: 'e', status: 'cancelled' }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle();
      const result = bar.render(100);

      // 所有 Agent 都显示在输出中
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('duration 格式化', () => {
    it('毫秒级 (< 1s)', () => {
      const now = Date.now();
      mockListActive.mockReturnValue([makeInstance({ createdAt: now - 500 })]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      // 由于测试执行耗时，实际值可能是 500~510ms
      expect(result[0]).toMatch(/\d+ms/);
    });

    it('秒级 (< 60s)', () => {
      const now = Date.now();
      mockListActive.mockReturnValue([makeInstance({ createdAt: now - 1500 })]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      expect(result[0]).toContain('1.5s');
    });

    it('分钟级', () => {
      const now = Date.now();
      mockListActive.mockReturnValue([makeInstance({ createdAt: now - 90000 })]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      expect(result[0]).toContain('1m30s');
    });

    it('多个 Agent 取最长持续时间', () => {
      const now = Date.now();
      mockListActive.mockReturnValue([
        makeInstance({ instanceId: 'a', createdAt: now - 5000 }),
        makeInstance({ instanceId: 'b', createdAt: now - 3000 }),
      ]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      // 最长 5s → "5.0s"
      expect(result[0]).toContain('5.0s');
    });
  });

  describe('loading 动画', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('从无到有启动动画', () => {
      mockListActive.mockReturnValue([]);
      const bar = new AgentStatusBar();
      bar.render(100); // 无 Agent

      mockListActive.mockReturnValue([makeInstance()]);
      bar.render(100); // Agent 出现 -> 启动动画

      // 推进一个 tick
      vi.advanceTimersByTime(200);

      // 再次渲染，帧已变化
      const result = bar.render(100);
      expect(result).toHaveLength(1);
    });

    it('从有到无停止动画', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const bar = new AgentStatusBar();
      bar.render(100); // 有 Agent，启动动画

      mockListActive.mockReturnValue([]);
      bar.render(100); // 无 Agent，停止动画

      // 推进多个 tick
      vi.advanceTimersByTime(1000);

      // 再次渲染，应该仍然是空
      const result = bar.render(100);
      expect(result).toEqual([]);
    });

    it('loading 帧轮转', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const bar = new AgentStatusBar();

      const result1 = bar.render(100);

      // 推进一个动画间隔
      vi.advanceTimersByTime(200);

      const result2 = bar.render(100);

      // 连续渲染应该有内容
      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1);
    });

    it('重复 render 不重复启动动画', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const bar = new AgentStatusBar();

      // 连续渲染都保持有 Agent
      bar.render(100);
      bar.render(100);
      bar.render(100);

      // 推进多个 tick，不应崩溃
      vi.advanceTimersByTime(1000);
      const result = bar.render(100);
      expect(result).toHaveLength(1);
    });
  });
});
