/**
 * Diff 引擎单元测试
 */
import { describe, expect, it } from 'vitest';
import { diffScreens } from '@/cli/tui/diff';
import { Screen } from '@/cli/tui/screen';
import { StylePool } from '@/cli/tui/style-pool';

function createScreen(rows: number, cols: number): Screen {
  return new Screen(rows, cols);
}

/** 在屏幕上写入文本（方便测试） */
function writeText(screen: Screen, row: number, col: number, text: string, styleId = 0): void {
  for (let i = 0; i < text.length; i++) {
    const c = col + i;
    if (c < screen.cols) {
      screen.setCell(c, row, text[i] ?? '', styleId, 1);
    }
  }
}

describe('diffScreens', () => {
  describe('首次渲染（prev = null）', () => {
    it('应生成首帧全量补丁', () => {
      const screen = createScreen(5, 10);
      writeText(screen, 0, 0, 'hello');
      writeText(screen, 2, 0, 'world');

      const result = diffScreens(null, screen, new StylePool());

      expect(result.patches.length).toBeGreaterThan(0);
      expect(result.stats.changedCells).toBeGreaterThan(0);
      expect(result.stats.totalCells).toBe(50); // 5*10
      // 首次渲染应有 move + write + clearLine 组合
      const types = result.patches.map((p) => p.type);
      expect(types).toContain('move');
      expect(types).toContain('write');
      expect(types).toContain('clearLine');
    });

    it('空屏幕应跳过空行', () => {
      const screen = createScreen(5, 10);
      const result = diffScreens(null, screen, new StylePool());
      // 空行应被跳过，patches 可能为 0
      // （根据实现，可能没有 write 补丁）
      const writePatches = result.patches.filter((p) => p.type === 'write');
      expect(writePatches).toHaveLength(0);
    });

    it('仅部分行有内容的屏幕', () => {
      const screen = createScreen(10, 20);
      writeText(screen, 0, 0, 'first line');
      writeText(screen, 9, 0, 'last line');

      const result = diffScreens(null, screen, new StylePool());
      // 只有 2 行有内容
      expect(result.stats.changedCells).toBeGreaterThan(0);
    });
  });

  describe('增量更新（prev 非 null）', () => {
    it('无变化应生成空补丁', () => {
      const screen = createScreen(3, 10);
      writeText(screen, 0, 0, 'hello');

      const result = diffScreens(screen, screen, new StylePool());
      // 相同引用的比较，应无变化
      const writePatches = result.patches.filter((p) => p.type === 'write');
      expect(writePatches).toHaveLength(0);
    });

    it('前后相同的帧应生成最小补丁', () => {
      const prev = createScreen(3, 10);
      writeText(prev, 0, 0, 'hello');
      writeText(prev, 1, 0, 'world');

      const next = createScreen(3, 10);
      writeText(next, 0, 0, 'hello');
      writeText(next, 1, 0, 'world');

      const result = diffScreens(prev, next, new StylePool());
      const writePatches = result.patches.filter((p) => p.type === 'write');
      expect(writePatches).toHaveLength(0);
    });

    it('单个字符变化应被检测', () => {
      const prev = createScreen(3, 10);
      writeText(prev, 0, 0, 'hello');

      const next = createScreen(3, 10);
      // cspell:disable-next-line
      writeText(next, 0, 0, 'hxllo'); // e → x

      const result = diffScreens(prev, next, new StylePool());
      const writePatches = result.patches.filter((p) => p.type === 'write');
      // 应检测到变化
      expect(writePatches.length).toBeGreaterThanOrEqual(1);
      const allText = writePatches.map((p) => p.text).join('');
      expect(allText).toContain('x');
    });

    it('全部不同的行应检测为变化', () => {
      const prev = createScreen(3, 10);
      writeText(prev, 0, 0, 'hello');

      const next = createScreen(3, 10);
      writeText(next, 0, 0, 'ABCDE'); // 全部不同

      const result = diffScreens(prev, next, new StylePool());
      const writePatches = result.patches.filter((p) => p.type === 'write');
      const allText = writePatches.map((p) => p.text).join('');
      expect(allText).toContain('ABCDE');
    });

    it('行缩短应生成 clearLine', () => {
      const prev = createScreen(3, 10);
      writeText(prev, 0, 0, 'hello');

      const next = createScreen(3, 10);
      writeText(next, 0, 0, 'hi'); // 缩短

      const result = diffScreens(prev, next, new StylePool());
      const clearPatches = result.patches.filter((p) => p.type === 'clearLine');
      expect(clearPatches.length).toBeGreaterThanOrEqual(1);
    });

    it('多行同时变化', () => {
      const prev = createScreen(5, 10);
      writeText(prev, 0, 0, 'line1');
      writeText(prev, 2, 0, 'line3');

      const next = createScreen(5, 10);
      writeText(next, 0, 0, 'LINE1');
      writeText(next, 2, 0, 'LINE3');

      const result = diffScreens(prev, next, new StylePool());
      // 两行都有单元格变化
      expect(result.stats.changedCells).toBeGreaterThan(0);
    });
  });

  describe('样式变化', () => {
    it('样式变化应生成 style 补丁', () => {
      const prev = createScreen(3, 10);
      writeText(prev, 0, 0, 'hello', 0);

      const next = createScreen(3, 10);
      writeText(next, 0, 0, 'hello', 1);

      const result = diffScreens(prev, next, new StylePool());
      // 应有 style 补丁或者 write 补丁（取决于 diff 策略）
      const hasStyleOrWrite = result.patches.some((p) => p.type === 'style' || p.type === 'write');
      expect(hasStyleOrWrite).toBe(true);
    });
  });

  describe('行数变化', () => {
    it('next 比 prev 多行（内容增长）', () => {
      const prev = createScreen(2, 10);
      writeText(prev, 0, 0, 'line1');

      const next = createScreen(4, 10);
      writeText(next, 0, 0, 'line1');
      writeText(next, 1, 0, 'line2');
      writeText(next, 2, 0, 'line3');

      const result = diffScreens(prev, next, new StylePool());
      expect(result.stats.changedCells).toBeGreaterThan(0);
    });

    it('next 比 prev 少行（内容缩小）', () => {
      const prev = createScreen(5, 10);
      writeText(prev, 0, 0, 'line1');
      writeText(prev, 1, 0, 'line2');
      writeText(prev, 2, 0, 'line3');

      const next = createScreen(2, 10);
      writeText(next, 0, 0, 'line1');

      const result = diffScreens(prev, next, new StylePool());
      // 缩小应生成 clearLine 补丁
      expect(result.patches.some((p) => p.type === 'clearLine')).toBe(true);
    });
  });

  describe('空/边界场景', () => {
    it('1x1 屏幕变化', () => {
      const prev = createScreen(1, 1);
      const next = createScreen(1, 1);
      next.setCell(0, 0, 'X', 0, 1);

      const result = diffScreens(prev, next, new StylePool());
      expect(result.stats.changedCells).toBe(1);
    });

    it('prev 为空屏幕，next 有内容', () => {
      const prev = new Screen(3, 10);
      const next = createScreen(3, 10);
      writeText(next, 0, 0, 'test');

      const result = diffScreens(prev, next, new StylePool());
      expect(result.stats.changedCells).toBeGreaterThan(0);
    });

    it('差分统计信息正确', () => {
      const prev = createScreen(3, 5);
      writeText(prev, 0, 0, 'abcde');

      const next = createScreen(3, 5);
      writeText(next, 0, 0, 'abcde');

      const result = diffScreens(prev, next, new StylePool());
      expect(result.stats.changedCells).toBe(0);
      expect(result.stats.changedRows).toBe(0);
      expect(result.stats.totalCells).toBe(15); // 3*5
    });
  });
});
