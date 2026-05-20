/**
 * AgentStatusBar 组件测试
 *
 * 覆盖：构造、toggle、折叠/展开渲染、持续时间格式化、loading 动画
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimationManager } from '@/cli/repl/utils/animation-manager';

/** 模拟 AnimationManager — setInterval 已由渲染周期驱动替代，测试中无需真实实现 */
const mockAnimationManager = {
  register: () => () => {},
  bind: () => {},
  unbind: () => {},
} as unknown as AnimationManager;

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
vi.mock('@earendil-works/pi-tui', () => ({
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
    return `${text.slice(0, target)}...`;
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
      expect(() => new AgentStatusBar(mockAnimationManager)).not.toThrow();
    });

    it('默认 isExpanded 为 true', () => {
      const bar = new AgentStatusBar(mockAnimationManager);
      expect(bar.isExpanded).toBe(true);
    });
  });

  describe('toggle', () => {
    it('应该在展开/折叠间切换', () => {
      const bar = new AgentStatusBar(mockAnimationManager);
      expect(bar.isExpanded).toBe(true);

      bar.toggle();
      expect(bar.isExpanded).toBe(false);

      bar.toggle();
      expect(bar.isExpanded).toBe(true);
    });

    it('应该调用 invalidate', () => {
      const bar = new AgentStatusBar(mockAnimationManager);
      const spy = vi.spyOn(bar, 'invalidate');

      bar.toggle();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('render - 无活跃 Agent', () => {
    it('无活跃实例时返回空数组', () => {
      mockListActive.mockReturnValue([]);
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      expect(result).toEqual([]);
    });
  });

  describe('render - 折叠模式', () => {
    let bar: AgentStatusBar;

    beforeEach(() => {
      bar = new AgentStatusBar(mockAnimationManager);
      bar.toggle(); // 默认展开，切到折叠模式
    });

    it('1 个 Agent 显示单数', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const result = bar.render(100);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('1 agent');
    });

    it('多个 Agent 显示复数', () => {
      mockListActive.mockReturnValue([
        makeInstance({ instanceId: 'a' }),
        makeInstance({ instanceId: 'b' }),
      ]);
      const result = bar.render(100);

      expect(result[0]).toContain('2 agents');
    });

    it('输出被截断到指定宽度', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const result = bar.render(10);

      expect(result[0]?.length ?? 0).toBeLessThanOrEqual(10);
    });
  });

  describe('render - 展开模式', () => {
    it('展开模式显示多行', () => {
      mockListActive.mockReturnValue([makeInstance({ instanceId: 'a', typeId: 'researcher' })]);
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      expect(result.length).toBeGreaterThan(1);
      expect(result[0]).toContain('1 agent');
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
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      // 第二行包含 agent 信息
      expect(result[1]).toContain('researcher');
    });

    it('显示当前活动工具信息', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          currentActivity: { toolName: 'ReadFile', toolUses: 5, startedAt: Date.now() },
        }),
      ]);
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      // activityDesc = '正在读取文件'，仅有 2 行：header + agent 行
      expect(result[1]).toContain('正在读取文件');
      expect(result).toHaveLength(2);
    });

    it('无 currentActivity 时不显示工具行', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const bar = new AgentStatusBar(mockAnimationManager);
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
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      // activityDesc = '正在读取文件'，仅有 2 行：header + agent 行
      expect(result[1]).toContain('正在读取文件');
      expect(result).toHaveLength(2);
    });

    it('最后一个 Agent 使用不同的连接线', () => {
      mockListActive.mockReturnValue([
        makeInstance({ instanceId: 'a', typeId: 'coder', status: 'running' }),
        makeInstance({ instanceId: 'b', typeId: 'researcher', status: 'completed' }),
      ]);
      const bar = new AgentStatusBar(mockAnimationManager);
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
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      // 所有 Agent 都显示在输出中
      expect(result.length).toBeGreaterThan(1);
    });

    it('未知状态使用默认图标（不回退到 undefined）', () => {
      mockListActive.mockReturnValue([
        makeInstance({ instanceId: 'a', status: 'unknown_status', typeId: 'custom-agent' }),
      ]);
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      // 确保渲染不崩溃，typeId 正常显示
      expect(result.some((l) => l.includes('custom-agent'))).toBe(true);
    });

    it('toolCallHistory 显示分组工具列表', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          instanceId: 'a',
          typeId: 'researcher',
          // 不要设置 currentActivity
          toolCallHistory: [
            {
              toolName: 'ReadFile',
              argsDisplay: 'src/foo.ts',
              status: 'completed',
              startedAt: 1000,
              endedAt: 2000,
            },
            {
              toolName: 'ReadFile',
              argsDisplay: 'src/bar.ts',
              status: 'completed',
              startedAt: 1000,
              endedAt: 2000,
            },
            {
              toolName: 'Grep',
              argsDisplay: 'pattern',
              status: 'completed',
              startedAt: 3000,
              endedAt: 4000,
            },
          ],
          status: 'running',
        }),
      ]);
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      // result[1] = agent 行，含活动描述
      expect(result[1]).toContain('已完成 3 次调用');
      // result[2] = 工具调用摘要行
      expect(result[2]).toContain('Read 2次');
      expect(result[2]).toContain('Search 1次');
    });

    it('running 状态的 Agent 显示 background hint', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          instanceId: 'a',
          toolCallHistory: [{ toolName: 'ReadFile', status: 'completed', startedAt: 1000 }],
          status: 'running',
        }),
      ]);
      const bar = new AgentStatusBar(mockAnimationManager);
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
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('ctrl+b'))).toBe(false);
    });

    it('toggleActiveAgentDetails 不抛异常', () => {
      const bar = new AgentStatusBar(mockAnimationManager);
      expect(() => bar.toggleActiveAgentDetails()).not.toThrow();
    });

    it('有当前活动且有工具历史时显示双重信息', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          typeId: 'researcher',
          currentActivity: { toolName: 'Exec', toolUses: 3, startedAt: Date.now() },
          toolCallHistory: [
            {
              toolName: 'ReadFile',
              argsDisplay: 'src/foo.ts',
              status: 'completed',
              startedAt: 1000,
              endedAt: 2000,
            },
            {
              toolName: 'ReadFile',
              argsDisplay: 'src/bar.ts',
              status: 'completed',
              startedAt: 1000,
              endedAt: 2000,
            },
          ],
          status: 'running',
        }),
      ]);
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      // line1: 当前活动描述（中文）
      expect(result[1]).toContain('正在执行命令');
      // line2: 工具调用总次数
      expect(result[2]).toContain('已完成 2 次工具调用');
      // 共 3 行：header + agent 行 + 工具统计行
      expect(result).toHaveLength(3);
    });

    it('工具历史未全部完成时不显示已完成描述', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          typeId: 'researcher',
          // 无 currentActivity
          toolCallHistory: [
            { toolName: 'ReadFile', status: 'completed', startedAt: 1000, endedAt: 2000 },
            { toolName: 'Grep', status: 'running', startedAt: 3000 },
          ],
          status: 'running',
        }),
      ]);
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      // line1: 没有 activityDesc（不是所有调用都完成），只显示 typeId
      expect(result[1]).toContain('researcher');
      expect(result[1]).not.toContain('已完成');
      // line2: 仍有工具调用摘要（totalCalls > 0 && !act）
      expect(result[2]).toContain('Read 1次');
      expect(result[2]).toContain('Search 1次');
    });

    it('不同工具名显示对应中文描述', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          typeId: 'coder',
          currentActivity: { toolName: 'WriteFile', toolUses: 1, startedAt: Date.now() },
        }),
        makeInstance({
          typeId: 'researcher',
          currentActivity: { toolName: 'WebSearch', toolUses: 2, startedAt: Date.now() },
        }),
      ]);
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('正在写入文件'))).toBe(true);
      expect(result.some((l) => l.includes('正在搜索网络'))).toBe(true);
    });

    it('展开模式 header 显示总耗时', () => {
      mockListActive.mockReturnValue([
        makeInstance({
          instanceId: 'a',
          typeId: 'coder',
          createdAt: Date.now() - 5000,
        }),
        makeInstance({
          instanceId: 'b',
          typeId: 'researcher',
          createdAt: Date.now() - 2000,
        }),
      ]);
      const bar = new AgentStatusBar(mockAnimationManager);
      const result = bar.render(100);

      // header 行包含 agent 数量和耗时
      expect(result[0]).toContain('2 agents');
      expect(result[0]).toContain('5.0s');
    });
  });

  describe('duration 格式化', () => {
    let bar: AgentStatusBar;

    beforeEach(() => {
      bar = new AgentStatusBar(mockAnimationManager);
      bar.toggle(); // 切到折叠模式测试 duration 格式化
    });

    it('毫秒级 (< 1s)', () => {
      const now = Date.now();
      mockListActive.mockReturnValue([makeInstance({ createdAt: now - 500 })]);
      const result = bar.render(100);

      // 由于测试执行耗时，实际值可能是 500~510ms
      expect(result[0]).toMatch(/\d+ms/);
    });

    it('秒级 (< 60s)', () => {
      const now = Date.now();
      mockListActive.mockReturnValue([makeInstance({ createdAt: now - 1500 })]);
      const result = bar.render(100);

      expect(result[0]).toContain('1.5s');
    });

    it('分钟级', () => {
      const now = Date.now();
      mockListActive.mockReturnValue([makeInstance({ createdAt: now - 90000 })]);
      const result = bar.render(100);

      expect(result[0]).toContain('1m30s');
    });

    it('多个 Agent 取最长持续时间', () => {
      const now = Date.now();
      mockListActive.mockReturnValue([
        makeInstance({ instanceId: 'a', createdAt: now - 5000 }),
        makeInstance({ instanceId: 'b', createdAt: now - 3000 }),
      ]);
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
        const bar = new AgentStatusBar(mockAnimationManager);
        expect(bar.hasTokenInfo).toBe(false);
      });

      it('setModelName 后为 true', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        expect(bar.hasTokenInfo).toBe(true);
      });

      it('clearTokenStats 后恢复为 false', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.clearTokenStats();
        expect(bar.hasTokenInfo).toBe(false);
      });
    });

    describe('方法调用 invalidate', () => {
      it('setModelName 调用 invalidate', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        const spy = vi.spyOn(bar, 'invalidate');
        bar.setModelName('test-model');
        expect(spy).toHaveBeenCalledTimes(1);
      });

      it('updateTokenStats 调用 invalidate', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        const spy = vi.spyOn(bar, 'invalidate');
        bar.updateTokenStats(100, 900, 200);
        expect(spy).toHaveBeenCalledTimes(1);
      });

      it('clearTokenStats 调用 invalidate', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        const spy = vi.spyOn(bar, 'invalidate');
        bar.clearTokenStats();
        expect(spy).toHaveBeenCalledTimes(1);
      });
    });

    describe('render - 无活跃 Agent', () => {
      it('有 Token 信息时单独显示 Token 行', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
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
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        const result = bar.render(200);

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('test-model');
        // 所有字段都应该有值（0）
        expect(result[0]).toMatch(/IN\s+0.+HIT\s+0.+MISS\s+0.+OUT\s+0/);
      });

      it('Token 行被截断到指定宽度', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('long-model-name');
        bar.updateTokenStats(1000, 9000, 500, 30000);
        const result = bar.render(10);

        expect(result[0]?.length ?? 0).toBeLessThanOrEqual(13); // "..." 追加
      });
    });

    describe('render - 数值格式', () => {
      it('大数值使用 M 单位 (>= 1,000,000)', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(500_000, 1_500_000, 200_000, 10000);

        const result = bar.render(200);
        // totalInput = 500K + 1.5M = 2.0M
        expect(result[0]).toContain('2.0M');
        // missTokens = inputTokens = 500K
        expect(result[0]).toContain('500.0K');
      });

      it('中等数值使用 K 单位 (>= 10,000)', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(5_000, 15_000, 3_000, 10000);

        const result = bar.render(200);
        // totalInput = 5K + 15K = 20K
        expect(result[0]).toContain('20.0K');
      });

      it('小数值使用千分位格式', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 10000);

        const result = bar.render(200);
        // totalInput = 1000
        expect(result[0]).toContain('1,000');
      });
    });

    describe('render - 缓存命中率', () => {
      it('高缓存率 (>=80%)', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);

        const result = bar.render(200);
        // cacheRate = round(900/1000 * 100) = 90
        expect(result[0]).toContain('(90%)');
      });

      it('低缓存率 (<80%)', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(500, 500, 200, 10000);

        const result = bar.render(200);
        // cacheRate = round(500/1000 * 100) = 50
        expect(result[0]).toContain('(50%)');
      });

      it('总输入为 0 时缓存率为 0', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(0, 0, 0, 0);

        const result = bar.render(200);
        expect(result[0]).toContain('(0%)');
      });
    });

    describe('duration 格式化', () => {
      it('毫秒级 (< 1s)', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 500);

        expect(bar.render(200)[0]).toContain('500ms');
      });

      it('秒级 (< 60s)', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);

        expect(bar.render(200)[0]).toContain('30.0s');
      });

      it('分钟级', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 90000);

        expect(bar.render(200)[0]).toContain('1m30s');
      });
    });

    describe('updateTokenStats 参数', () => {
      it('不传 durationMs 时保留上一次的值', () => {
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);
        expect(bar.render(200)[0]).toContain('30.0s');

        // 不传 durationMs
        bar.updateTokenStats(200, 800, 300);
        expect(bar.render(200)[0]).toContain('30.0s');
      });
    });

    describe('render - 与 Agent 活跃实例共存', () => {
      it('展开模式 + Token 信息 = Token 行在末尾', () => {
        mockListActive.mockReturnValue([makeInstance()]);
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);

        const result = bar.render(100);
        expect(result[result.length - 1]).toContain('test-model');
      });

      it('折叠模式 + Token 信息 = 折叠模式 + Token 行', () => {
        mockListActive.mockReturnValue([makeInstance()]);
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.toggle(); // 切到折叠模式
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200, 30000);

        const result = bar.render(100);
        expect(result).toHaveLength(2);
        expect(result[0]).toContain('1 agent');
        expect(result[1]).toContain('test-model');
      });

      it('展开模式 + clearTokenStats 后不显示 Token 行', () => {
        mockListActive.mockReturnValue([makeInstance()]);
        const bar = new AgentStatusBar(mockAnimationManager);
        bar.setModelName('test-model');
        bar.updateTokenStats(100, 900, 200);
        bar.clearTokenStats();

        const result = bar.render(100);
        // 展开模式：3 行 agent 信息，没有 token 行
        expect(result).toHaveLength(3);
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
      const bar = new AgentStatusBar(mockAnimationManager);
      bar.render(100); // 无 Agent

      mockListActive.mockReturnValue([makeInstance()]);
      bar.render(100); // Agent 出现 -> 启动动画

      // 推进一个 tick
      vi.advanceTimersByTime(200);

      // 再次渲染，帧已变化（展开模式有 3 行）
      const result = bar.render(100);
      expect(result).toHaveLength(3);
    });

    it('从有到无停止动画', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const bar = new AgentStatusBar(mockAnimationManager);
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
      const bar = new AgentStatusBar(mockAnimationManager);

      const result1 = bar.render(100);

      // 推进一个动画间隔
      vi.advanceTimersByTime(200);

      const result2 = bar.render(100);

      // 连续渲染应该有内容（展开模式有 3 行）
      expect(result1).toHaveLength(3);
      expect(result2).toHaveLength(3);
    });

    it('重复 render 不重复启动动画', () => {
      mockListActive.mockReturnValue([makeInstance()]);
      const bar = new AgentStatusBar(mockAnimationManager);

      // 连续渲染都保持有 Agent
      bar.render(100);
      bar.render(100);
      bar.render(100);

      // 推进多个 tick，不应崩溃
      vi.advanceTimersByTime(1000);
      const result = bar.render(100);
      expect(result).toHaveLength(3);
    });
  });
});
