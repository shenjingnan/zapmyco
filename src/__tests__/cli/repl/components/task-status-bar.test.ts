/**
 * TaskStatusBar 组件测试
 *
 * 覆盖：构造、展开渲染、状态样式、阻塞标记、宽度截断
 *
 * 展开规则：
 * - 有任务时始终展开
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
// Mock AnimationManager — 只需满足接口签名，内部方法无需实现
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

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStatusBar } from '@/cli/repl/components/task-status-bar';
import { TaskStore } from '@/core/task/task-store';

describe('TaskStatusBar', () => {
  let store: TaskStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-taskbar-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    store = new TaskStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ============ 构造 ============
  describe('construction', () => {
    it('应该能正常实例化', () => {
      expect(() => new TaskStatusBar(store, mockAnimationManager)).not.toThrow();
    });

    it('无任务时 isExpanded 为 false', () => {
      const bar = new TaskStatusBar(store, mockAnimationManager);
      expect(bar.isExpanded).toBe(false);
    });

    it('有活跃任务时 isExpanded 为 true（默认展开）', () => {
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      expect(bar.isExpanded).toBe(true);
    });

    it('只有已完成任务时 isExpanded 为 true（有任务就展开）', () => {
      store.write([{ id: '1', subject: '完成', status: 'completed' }]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      expect(bar.isExpanded).toBe(true);
    });
  });

  // ============ render - 无任务 ============
  describe('render - 无任务', () => {
    it('无任务时返回空数组', () => {
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      expect(result).toEqual([]);
    });
  });

  // ============ render - 默认展开（有活跃任务）============
  describe('render - 默认展开（有活跃任务）', () => {
    it('有 pending 任务时默认展开显示任务行', () => {
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      // 展开模式：包含任务行
      expect(result.length).toBeGreaterThan(2);
      expect(result.some((l) => l.includes('#1'))).toBe(true);
    });

    it('有 in_progress 任务时默认展开', () => {
      store.write([{ id: '1', subject: '进行中', status: 'in_progress' }]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('#1'))).toBe(true);
    });

    it('in_progress 任务排在最前', () => {
      store.write([
        { id: '1', subject: '待处理', status: 'pending' },
        { id: '2', subject: '进行中', status: 'in_progress' },
      ]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      const lines = result.filter((l) => l.includes('#'));
      expect(lines[0]).toContain('#2');
    });

    it('取消的任务排在最后', () => {
      store.write([
        { id: '1', subject: '已完成', status: 'completed' },
        { id: '2', subject: '已取消', status: 'cancelled' },
        { id: '3', subject: '进行中', status: 'in_progress' },
      ]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      const lines = result.filter((l) => l.includes('#'));
      const lastLine = lines[lines.length - 1];
      expect(lastLine).toContain('#2');
    });

    it('显示底部摘要统计', () => {
      store.write([
        { id: '1', subject: '待处理', status: 'pending' },
        { id: '2', subject: '进行中', status: 'in_progress' },
        { id: '3', subject: '已完成', status: 'completed' },
      ]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      const fullText = result.join(' ');
      expect(fullText).toContain('1 in_progress');
      expect(fullText).toContain('1 pending');
      expect(fullText).toContain('1 completed');
    });
  });

  // ============ render - 仅已完成/已取消任务（有任务就展开）============
  describe('render - 全部完成', () => {
    it('只有已完成任务时也展开显示任务行', () => {
      store.write([
        { id: '1', subject: '已完成', status: 'completed' },
        { id: '2', subject: '已完成2', status: 'completed' },
      ]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      expect(result.length).toBeGreaterThan(2);
      expect(result.some((l) => l.includes('#1'))).toBe(true);
      expect(result.some((l) => l.includes('#2'))).toBe(true);
    });

    it('只有已取消任务时也展开显示任务行', () => {
      store.write([{ id: '1', subject: '已取消', status: 'cancelled' }]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      expect(result.length).toBeGreaterThan(2);
      expect(result.some((l) => l.includes('#1'))).toBe(true);
    });

    it('显示底部摘要', () => {
      store.write([{ id: '1', subject: '进行中', status: 'in_progress' }]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      // 展开模式应有底部摘要
      expect(result.some((l) => l.includes('in_progress'))).toBe(true);
    });
  });

  // ============ 阻塞标记 ============
  describe('阻塞标记', () => {
    it('有未完成依赖时显示 blocked by', () => {
      store.write([
        { id: '1', subject: '基础任务', status: 'pending' },
        { id: '2', subject: '依赖任务', status: 'pending', dependencies: ['1'] },
      ]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      // 默认展开，应有 blocked by
      expect(result.some((l) => l.includes('blocked by #1'))).toBe(true);
    });

    it('依赖已完成时不显示 blocked by', () => {
      store.write([
        { id: '1', subject: '基础任务', status: 'completed' },
        { id: '2', subject: '依赖任务', status: 'pending', dependencies: ['1'] },
      ]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('blocked by'))).toBe(false);
    });

    it('无依赖时不显示 blocked by', () => {
      store.write([{ id: '1', subject: '独立任务', status: 'pending' }]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('blocked by'))).toBe(false);
    });

    it('in_progress 任务不显示 blocked by', () => {
      store.write([
        { id: '1', subject: '基础', status: 'pending' },
        { id: '2', subject: '进行中', status: 'in_progress', dependencies: ['1'] },
      ]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('blocked by'))).toBe(false);
    });

    it('依赖不存在时显示 blocked by', () => {
      store.write([
        { id: '2', subject: '依赖不存在的任务', status: 'pending', dependencies: ['nonexistent'] },
      ]);
      const bar = new TaskStatusBar(store, mockAnimationManager);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('blocked by #nonexistent?'))).toBe(true);
    });
  });

  // ============ 状态同步 ============
  describe('状态同步', () => {
    it('写入 pending 任务后默认展开', () => {
      const bar = new TaskStatusBar(store, mockAnimationManager);

      // 初始为空
      expect(bar.render(100)).toEqual([]);

      // 写入活跃任务
      store.write([{ id: '1', subject: '新任务', status: 'pending' }]);
      const result = bar.render(100);

      // 默认展开，多行
      expect(result.length).toBeGreaterThan(2);
      expect(result.some((l) => l.includes('#1'))).toBe(true);
    });

    it('全部完成后仍展开（有任务就展开）', () => {
      store.write([{ id: '1', subject: '任务', status: 'in_progress' }]);
      const bar = new TaskStatusBar(store, mockAnimationManager);

      // 初始展开
      expect(bar.isExpanded).toBe(true);

      // 全部完成
      store.update('1', { status: 'completed' });

      // 仍有任务，保持展开
      expect(bar.isExpanded).toBe(true);
      const result = bar.render(100);
      expect(result.length).toBeGreaterThan(2);
      expect(result.some((l) => l.includes('#1'))).toBe(true);
    });

    it('有任务时始终展开', () => {
      store.write([{ id: '1', subject: '旧任务', status: 'completed' }]);
      const bar = new TaskStatusBar(store, mockAnimationManager);

      // 有任务就展开
      expect(bar.isExpanded).toBe(true);
    });

    it('TaskStore clear 后 render 应返回空', () => {
      store.write([{ id: '1', subject: '任务', status: 'pending' }]);
      const bar = new TaskStatusBar(store, mockAnimationManager);

      store.clear();
      const result = bar.render(100);

      expect(result).toEqual([]);
    });
  });
});
