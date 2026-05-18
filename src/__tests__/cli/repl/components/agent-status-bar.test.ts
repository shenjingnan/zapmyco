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
  truncateToWidth: (text: string, maxWidth: number) => {
    if (maxWidth <= 0) return '';
    if (text.length <= maxWidth) return text;
    const target = maxWidth - 3;
    if (target <= 0) return '.'.repeat(maxWidth);
    return text.slice(0, target) + '...';
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
  toolCallHistory: Array<{
    toolName: string;
    toolCallId?: string;
    argsDisplay?: string;
    status: string;
    startedAt: number;
    endedAt?: number;
  }>;
  toolCallGroups: Array<{
    category: string;
    label: string;
    calls: Array<Record<string, unknown>>;
    count: number;
    startTime: number;
    endTime?: number;
  }>;
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
    toolCallHistory: [],
    toolCallGroups: [],
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

    it('显示 tool uses 统计（复数）', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          currentActivity: { toolName: 'Read', toolUses: 3, startedAt: Date.now() },
        }),
      ]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      expect(result[0]).toContain('3 tool uses');
    });

    it('显示 tool use 统计（单数）', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          currentActivity: { toolName: 'Read', toolUses: 1, startedAt: Date.now() },
        }),
      ]);
      const bar = new AgentStatusBar();
      const result = bar.render(100);

      expect(result[0]).toContain('1 tool use');
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

      // 标题行 + agent 信息行 + 后台提示行（running 状态自动显示）
      expect(result).toHaveLength(3);
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

    it('未知状态使用默认图标（不回退到 undefined）', () => {
      mockListActive.mockReturnValue([
        makeInstance({ instanceId: 'a', status: 'unknown_status', typeId: 'custom-agent' }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle();
      const result = bar.render(100);

      // 确保渲染不崩溃，typeId 正常显示
      expect(result.some((l) => l.includes('custom-agent'))).toBe(true);
    });

    it('toolCallHistory 展开后显示分组工具列表', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          instanceId: 'a',
          typeId: 'researcher',
          toolCallHistory: [
            {
              toolName: 'ReadFile',
              argsDisplay: 'src/foo.ts',
              status: 'completed',
              startedAt: 1000,
            },
            {
              toolName: 'ReadFile',
              argsDisplay: 'src/bar.ts',
              status: 'completed',
              startedAt: 2000,
            },
            { toolName: 'Grep', argsDisplay: 'pattern', status: 'completed', startedAt: 3000 },
          ],
          status: 'running',
        }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle(); // 展开状态栏
      bar.toggle('a'); // 展开 agent-a 的工具详情
      const result = bar.render(100);

      // 应包含分组标题行 ⎿  Read 2 items ...
      expect(result.some((l) => l.includes('Read 2 items'))).toBe(true);
      // 单个 Grep 保持独立
      expect(result.some((l) => l.includes('Grep: pattern'))).toBe(true);
    });

    it('隐藏工具计数显示 "+N more tool uses"', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          instanceId: 'a',
          toolCallHistory: [
            { toolName: 'ReadFile', status: 'completed', startedAt: 1 },
            { toolName: 'ReadFile', status: 'completed', startedAt: 2 },
            { toolName: 'ReadFile', status: 'completed', startedAt: 3 },
            { toolName: 'ReadFile', status: 'completed', startedAt: 4 },
            { toolName: 'ReadFile', status: 'completed', startedAt: 5 },
            { toolName: 'ReadFile', status: 'completed', startedAt: 6 },
          ],
          status: 'running',
        }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle(); // 展开状态栏
      // 不调用 toggle('a')，所以 collapsed 状态下应显示 "+N more"
      const result = bar.render(100);

      // collapsed 模式下显示最近 1 条 + "+N more" 提示
      expect(result.some((l) => l.includes('+5 more tool uses'))).toBe(true);
    });

    it('running 状态的 Agent 显示 background hint', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          instanceId: 'a',
          toolCallHistory: [{ toolName: 'ReadFile', status: 'completed', startedAt: 1000 }],
          status: 'running',
        }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle();
      const result = bar.render(100);

      expect(result.some((l) => l.includes('ctrl+b'))).toBe(true);
    });

    it('非 running 状态的 Agent 不显示 background hint', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          instanceId: 'a',
          toolCallHistory: [],
          status: 'completed',
        }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle();
      const result = bar.render(100);

      expect(result.some((l) => l.includes('ctrl+b'))).toBe(false);
    });

    it('toggle(instanceId) 可单独展开/折叠 Agent 工具详情', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          instanceId: 'a',
          toolCallHistory: [
            { toolName: 'ReadFile', status: 'completed', startedAt: 1000 },
            { toolName: 'Grep', status: 'completed', startedAt: 2000 },
          ],
          status: 'running',
        }),
      ]);
      const bar = new AgentStatusBar();
      bar.toggle(); // 展开状态栏

      // 先折叠状态（默认）— 只有 ⎿ 最近工具行
      const collapsedResult = bar.render(100);

      // 展开 agent-a 详情
      bar.toggle('a');
      const expandedResult = bar.render(100);
      // 展开后应能看到更多内容
      expect(expandedResult.length).toBeGreaterThanOrEqual(collapsedResult.length);
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

  describe('token info', () => {
    beforeEach(() => {
      mockListActive.mockReturnValue([]);
    });

    describe('hasTokenInfo', () => {
      it('初始为 false', () => {
        const bar = new AgentStatusBar();
        expect(bar.hasTokenInfo).toBe(false);
      });

      it('setModelName 后为 true', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        expect(bar.hasTokenInfo).toBe(true);
      });

      it('clearTokenStats 后恢复为 false', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.clearTokenStats();
        expect(bar.hasTokenInfo).toBe(false);
      });
    });

    describe('方法调用 invalidate', () => {
      it('setModelName 调用 invalidate', () => {
        const bar = new AgentStatusBar();
        const spy = vi.spyOn(bar, 'invalidate');
        bar.setModelName('test-model');
        expect(spy).toHaveBeenCalledTimes(1);
      });

      it('updateTokenStats 调用 invalidate', () => {
        const bar = new AgentStatusBar();
        const spy = vi.spyOn(bar, 'invalidate');
        bar.updateTokenStats(100, 900, 200);
        expect(spy).toHaveBeenCalledTimes(1);
      });

      it('clearTokenStats 调用 invalidate', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        const spy = vi.spyOn(bar, 'invalidate');
        bar.clearTokenStats();
        expect(spy).toHaveBeenCalledTimes(1);
      });
    });

    describe('render - 无活跃 Agent', () => {
      it('有 Token 信息时单独显示 Token 行', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);
        const result = bar.render(200);

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('test-model');
        expect(result[0]).toContain('IN');
        expect(result[0]).toContain('HIT');
        expect(result[0]).toContain('MISS');
        expect(result[0]).toContain('OUT');
      });

      it('只设置 modelName 未设置统计值时显示默认 0', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        const result = bar.render(200);

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('test-model');
        // 所有字段都应该有值（0）
        expect(result[0]).toMatch(/IN\s+0.+HIT\s+0.+MISS\s+0.+OUT\s+0/);
      });

      it('Token 行被截断到指定宽度', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('long-model-name');
        bar.updateTokenStats(1000, 9000, 500, 30000);
        const result = bar.render(10);

        expect(result[0]?.length ?? 0).toBeLessThanOrEqual(13); // "..." 追加
      });
    });

    describe('render - 数值格式', () => {
      it('大数值使用 M 单位 (>= 1,000,000)', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(500_000, 1_500_000, 200_000, 10000);

        const result = bar.render(200);
        // totalInput = 500K + 1.5M = 2.0M
        expect(result[0]).toContain('2.0M');
        // missTokens = inputTokens = 500K
        expect(result[0]).toContain('500.0K');
      });

      it('中等数值使用 K 单位 (>= 10,000)', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(5_000, 15_000, 3_000, 10000);

        const result = bar.render(200);
        // totalInput = 5K + 15K = 20K
        expect(result[0]).toContain('20.0K');
      });

      it('小数值使用千分位格式', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 10000);

        const result = bar.render(200);
        // totalInput = 1000
        expect(result[0]).toContain('1,000');
      });
    });

    describe('render - 缓存命中率', () => {
      it('高缓存率 (>=80%)', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);

        const result = bar.render(200);
        // cacheRate = round(900/1000 * 100) = 90
        expect(result[0]).toContain('(90%)');
      });

      it('低缓存率 (<80%)', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(500, 500, 200, 10000);

        const result = bar.render(200);
        // cacheRate = round(500/1000 * 100) = 50
        expect(result[0]).toContain('(50%)');
      });

      it('总输入为 0 时缓存率为 0', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(0, 0, 0, 0);

        const result = bar.render(200);
        expect(result[0]).toContain('(0%)');
      });
    });

    describe('duration 格式化', () => {
      it('毫秒级 (< 1s)', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 500);

        expect(bar.render(200)[0]).toContain('500ms');
      });

      it('秒级 (< 60s)', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);

        expect(bar.render(200)[0]).toContain('30.0s');
      });

      it('分钟级', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 90000);

        expect(bar.render(200)[0]).toContain('1m30s');
      });
    });

    describe('updateTokenStats 参数', () => {
      it('不传 durationMs 时保留上一次的值', () => {
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);
        expect(bar.render(200)[0]).toContain('30.0s');

        // 不传 durationMs
        bar.updateTokenStats(200, 800, 300);
        expect(bar.render(200)[0]).toContain('30.0s');
      });
    });

    describe('render - 与 Agent 活跃实例共存', () => {
      it('折叠模式 + Token 信息 = 显示两行', () => {
        mockListActive.mockReturnValue([makeInstance()]);
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);

        const result = bar.render(100);
        expect(result).toHaveLength(2);
        expect(result[0]).toContain('Running');
        expect(result[1]).toContain('test-model');
      });

      it('展开模式 + Token 信息 = Token 行在末尾', () => {
        mockListActive.mockReturnValue([makeInstance()]);
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);
        bar.toggle();

        const result = bar.render(100);
        expect(result[result.length - 1]).toContain('test-model');
      });

      it('clearTokenStats 后不显示 Token 行', () => {
        mockListActive.mockReturnValue([makeInstance()]);
        const bar = new AgentStatusBar();
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200);
        bar.clearTokenStats();

        const result = bar.render(100);
        // 只有 agent 行，没有 token 行
        expect(result).toHaveLength(1);
        expect(result[0]).not.toContain('IN');
        expect(result[0]).not.toContain('HIT');
      });
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
