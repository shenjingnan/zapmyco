/**
 * TaskStatusBar 组件测试
 *
 * 覆盖：构造、toggle、折叠/展开渲染、状态样式、阻塞标记、宽度截断
 *
 * 展开/折叠规则：
 * - 有活跃任务（pending/in_progress）时默认展开
 * - 全部完成（completed/cancelled）时折叠
 * - Ctrl+T 手动切换
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
      expect(() => new TaskStatusBar(store)).not.toThrow();
    });

    it('无任务时 isExpanded 为 false', () => {
      const bar = new TaskStatusBar(store);
      expect(bar.isExpanded).toBe(false);
    });

    it('有活跃任务时 isExpanded 为 true（默认展开）', () => {
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);
      const bar = new TaskStatusBar(store);
      expect(bar.isExpanded).toBe(true);
    });

    it('只有已完成任务时 isExpanded 为 false（默认折叠）', () => {
      store.write([{ id: '1', subject: '完成', status: 'completed' }]);
      const bar = new TaskStatusBar(store);
      expect(bar.isExpanded).toBe(false);
    });
  });

  // ============ toggle ============
  describe('toggle', () => {
    it('有任务时可以在展开/折叠间切换', () => {
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);
      const bar = new TaskStatusBar(store);

      // 默认展开
      expect(bar.isExpanded).toBe(true);

      // 手动折叠
      bar.toggle();
      expect(bar.isExpanded).toBe(false);

      // 再次展开
      bar.toggle();
      expect(bar.isExpanded).toBe(true);
    });

    it('应该调用 invalidate', () => {
      const bar = new TaskStatusBar(store);
      const spy = vi.spyOn(bar, 'invalidate');

      bar.toggle();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ============ render - 无任务 ============
  describe('render - 无任务', () => {
    it('无任务时返回空数组', () => {
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      expect(result).toEqual([]);
    });

    it('toggle 后无任务仍返回空数组', () => {
      const bar = new TaskStatusBar(store);
      bar.toggle();

      const result = bar.render(100);

      expect(result).toEqual([]);
    });
  });

  // ============ render - 默认展开（有活跃任务）============
  describe('render - 默认展开（有活跃任务）', () => {
    it('有 pending 任务时默认展开显示任务行', () => {
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      // 展开模式：包含任务行和折叠提示
      expect(result.length).toBeGreaterThan(2);
      expect(result.some((l) => l.includes('#1'))).toBe(true);
      expect(result.some((l) => l.includes('Ctrl+T collapse'))).toBe(true);
    });

    it('有 in_progress 任务时默认展开', () => {
      store.write([{ id: '1', subject: '进行中', status: 'in_progress' }]);
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('#1'))).toBe(true);
      expect(result.some((l) => l.includes('Ctrl+T collapse'))).toBe(true);
    });

    it('in_progress 任务排在最前', () => {
      store.write([
        { id: '1', subject: '待处理', status: 'pending' },
        { id: '2', subject: '进行中', status: 'in_progress' },
      ]);
      const bar = new TaskStatusBar(store);
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
      const bar = new TaskStatusBar(store);
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
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      const fullText = result.join(' ');
      expect(fullText).toContain('1 in_progress');
      expect(fullText).toContain('1 pending');
      expect(fullText).toContain('1 completed');
    });
  });

  // ============ render - 折叠模式（用户手动折叠或全部完成）============
  describe('render - 折叠模式', () => {
    it('只有已完成任务时自动折叠显示摘要', () => {
      store.write([
        { id: '1', subject: '已完成', status: 'completed' },
        { id: '2', subject: '已完成2', status: 'completed' },
      ]);
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('2 completed');
    });

    it('只有已取消任务时自动折叠显示摘要', () => {
      store.write([{ id: '1', subject: '已取消', status: 'cancelled' }]);
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      expect(result[0]).toContain('1 cancelled');
    });

    it('用户手动折叠后显示折叠摘要', () => {
      store.write([{ id: '1', subject: '任务', status: 'pending' }]);
      const bar = new TaskStatusBar(store);

      // 默认展开，手动折叠
      bar.toggle();
      const result = bar.render(100);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('1 task');
      expect(result[0]).toContain('Ctrl+T expand');
    });

    it('折叠模式输出被截断到指定宽度', () => {
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);
      const bar = new TaskStatusBar(store);
      bar.toggle(); // 强制折叠
      const result = bar.render(10);

      expect(result[0]?.length ?? 0).toBeLessThanOrEqual(10);
    });

    it('折叠模式数量为 0 的状态不显示', () => {
      store.write([{ id: '1', subject: '进行中', status: 'in_progress' }]);
      const bar = new TaskStatusBar(store);
      bar.toggle(); // 强制折叠
      const result = bar.render(100);

      // 只有 in_progress 非零，其他不显示
      expect(result[0]).toContain('in_progress');
      expect(result[0]).not.toContain('completed');
      expect(result[0]).not.toContain('pending');
      expect(result[0]).not.toContain('cancelled');
    });
  });

  // ============ 阻塞标记 ============
  describe('阻塞标记', () => {
    it('有未完成依赖时显示 blocked by', () => {
      store.write([
        { id: '1', subject: '基础任务', status: 'pending' },
        { id: '2', subject: '依赖任务', status: 'pending', dependencies: ['1'] },
      ]);
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      // 默认展开，应有 blocked by
      expect(result.some((l) => l.includes('blocked by #1'))).toBe(true);
    });

    it('依赖已完成时不显示 blocked by', () => {
      store.write([
        { id: '1', subject: '基础任务', status: 'completed' },
        { id: '2', subject: '依赖任务', status: 'pending', dependencies: ['1'] },
      ]);
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('blocked by'))).toBe(false);
    });

    it('无依赖时不显示 blocked by', () => {
      store.write([{ id: '1', subject: '独立任务', status: 'pending' }]);
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('blocked by'))).toBe(false);
    });

    it('in_progress 任务不显示 blocked by', () => {
      store.write([
        { id: '1', subject: '基础', status: 'pending' },
        { id: '2', subject: '进行中', status: 'in_progress', dependencies: ['1'] },
      ]);
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('blocked by'))).toBe(false);
    });

    it('依赖不存在时显示 blocked by', () => {
      store.write([
        { id: '2', subject: '依赖不存在的任务', status: 'pending', dependencies: ['nonexistent'] },
      ]);
      const bar = new TaskStatusBar(store);
      const result = bar.render(100);

      expect(result.some((l) => l.includes('blocked by #nonexistent?'))).toBe(true);
    });
  });

  // ============ 状态同步 ============
  describe('状态同步', () => {
    it('写入 pending 任务后默认展开', () => {
      const bar = new TaskStatusBar(store);

      // 初始为空
      expect(bar.render(100)).toEqual([]);

      // 写入活跃任务
      store.write([{ id: '1', subject: '新任务', status: 'pending' }]);
      const result = bar.render(100);

      // 默认展开，多行
      expect(result.length).toBeGreaterThan(2);
      expect(result.some((l) => l.includes('#1'))).toBe(true);
    });

    it('全部完成后自动折叠', () => {
      store.write([{ id: '1', subject: '任务', status: 'in_progress' }]);
      const bar = new TaskStatusBar(store);

      // 初始展开
      expect(bar.isExpanded).toBe(true);

      // 全部完成
      store.update('1', { status: 'completed' });

      // 自动折叠
      expect(bar.isExpanded).toBe(false);
      const result = bar.render(100);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('1 completed');
    });

    it('全部完成后新任务出现时自动展开', () => {
      store.write([{ id: '1', subject: '旧任务', status: 'completed' }]);
      const bar = new TaskStatusBar(store);

      // 全部完成，折叠
      expect(bar.isExpanded).toBe(false);

      // 新活跃任务出现（使用 merge 模式保留已完成任务）
      store.write(
        [
          { id: '1', subject: '旧任务', status: 'completed' },
          { id: '2', subject: '新任务', status: 'pending' },
        ],
        true
      );

      // 模拟 session.onChange → onTasksChanged
      bar.onTasksChanged();

      // 自动展开
      expect(bar.isExpanded).toBe(true);
    });

    it('用户手动折叠后新任务出现时自动展开', () => {
      store.write([{ id: '1', subject: '任务', status: 'pending' }]);
      const bar = new TaskStatusBar(store);

      // 用户手动折叠
      bar.toggle();
      expect(bar.isExpanded).toBe(false);

      // 新任务通过 write 写入（模拟 TaskManage write）
      store.write([
        { id: '1', subject: '任务', status: 'pending' },
        { id: '2', subject: '新任务', status: 'pending' },
      ]);

      // 模拟 session.onChange → onTasksChanged
      bar.onTasksChanged();

      // 有活跃任务，自动展开（forceCollapsed 被重置）
      expect(bar.isExpanded).toBe(true);
    });

    it('用户手动折叠后全部完成不自动展开', () => {
      store.write([
        { id: '1', subject: '进行中', status: 'in_progress' },
        { id: '2', subject: '待处理', status: 'pending' },
      ]);
      const bar = new TaskStatusBar(store);

      // 用户手动折叠
      bar.toggle();
      expect(bar.isExpanded).toBe(false);

      // 全部完成
      store.update('1', { status: 'completed' });
      store.update('2', { status: 'completed' });

      // 全部完成，保持折叠
      expect(bar.isExpanded).toBe(false);
    });

    it('TaskStore clear 后 render 应返回空', () => {
      store.write([{ id: '1', subject: '任务', status: 'pending' }]);
      const bar = new TaskStatusBar(store);

      store.clear();
      const result = bar.render(100);

      expect(result).toEqual([]);
    });
  });
});
