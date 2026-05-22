/**
 * Diff 引擎单元测试
 */
import { describe, expect, it } from 'vitest';
import { detectDecstbmScroll, diffScreens } from '@/cli/tui/diff';
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

  describe('detectDecstbmScroll', () => {
    /** 用文本填充一行的指定范围 */
    function fillRow(screen: Screen, row: number, col: number, text: string, styleId = 0): void {
      for (let i = 0; i < text.length; i++) {
        const c = col + i;
        if (c < screen.cols) {
          screen.setCell(c, row, text[i] ?? '', styleId, 1);
        }
      }
    }

    it('应该检测到 delta=1 的均匀位移', () => {
      const prev = new Screen(10, 20);
      const next = new Screen(10, 20);
      // prev: 5 行内容
      fillRow(prev, 0, 0, 'AAAAA');
      fillRow(prev, 1, 0, 'BBBBB');
      fillRow(prev, 2, 0, 'CCCCC');
      fillRow(prev, 3, 0, 'DDDDD');
      fillRow(prev, 4, 0, 'EEEEE');
      // next: 内容上移 1 行，底部有 1 行新内容
      fillRow(next, 0, 0, 'BBBBB');
      fillRow(next, 1, 0, 'CCCCC');
      fillRow(next, 2, 0, 'DDDDD');
      fillRow(next, 3, 0, 'EEEEE');
      fillRow(next, 4, 0, 'FFFFF');

      const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 20, height: 10 });
      expect(result).toBe(1);
    });

    it('应该检测到 delta=2 的均匀位移', () => {
      const prev = new Screen(10, 20);
      const next = new Screen(10, 20);
      // prev: 5 行内容
      fillRow(prev, 0, 0, 'AAAAA');
      fillRow(prev, 1, 0, 'BBBBB');
      fillRow(prev, 2, 0, 'CCCCC');
      fillRow(prev, 3, 0, 'DDDDD');
      fillRow(prev, 4, 0, 'EEEEE');
      // next: 内容上移 2 行，底部有 2 行新内容
      fillRow(next, 0, 0, 'CCCCC');
      fillRow(next, 1, 0, 'DDDDD');
      fillRow(next, 2, 0, 'EEEEE');
      fillRow(next, 3, 0, 'FFFFF');
      fillRow(next, 4, 0, 'GGGGG');

      const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 20, height: 10 });
      expect(result).toBe(2);
    });

    it('两帧相同时应返回 null', () => {
      const screen = new Screen(5, 10);
      fillRow(screen, 0, 0, 'HELLO');
      fillRow(screen, 1, 0, 'WORLD');

      const result = detectDecstbmScroll(screen, screen, { x: 0, y: 0, width: 10, height: 5 });
      expect(result).toBeNull();
    });

    it('内容完全不同的两帧应返回 null', () => {
      const prev = new Screen(5, 10);
      fillRow(prev, 0, 0, 'AAAAA');

      const next = new Screen(5, 10);
      fillRow(next, 0, 0, 'BBBBB');

      const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 10, height: 5 });
      expect(result).toBeNull();
    });

    it('高度 < 2 应返回 null', () => {
      const prev = new Screen(1, 10);
      const next = new Screen(1, 10);
      const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 10, height: 1 });
      expect(result).toBeNull();
    });

    it('部分行变化（非 uniform shift）应返回 null', () => {
      const prev = new Screen(5, 10);
      const next = new Screen(5, 10);
      // prev: 3 行内容
      fillRow(prev, 0, 0, 'AAAAA');
      fillRow(prev, 1, 0, 'BBBBB');
      fillRow(prev, 2, 0, 'CCCCC');
      // next: 第 2 行不同，不是 uniform shift
      fillRow(next, 0, 0, 'AAAAA');
      fillRow(next, 1, 0, 'XXXXX'); // 不同
      fillRow(next, 2, 0, 'CCCCC');

      const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 10, height: 5 });
      expect(result).toBeNull();
    });

    it('prev 尺寸不足时应返回 null', () => {
      const prev = new Screen(3, 10);
      const next = new Screen(5, 10);
      fillRow(prev, 0, 0, 'AAAAA');
      fillRow(next, 0, 0, 'AAAAA');

      // rect 超出 prev 范围
      const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 10, height: 5 });
      expect(result).toBeNull();
    });

    it('delta 超过 rect.height-1 时应返回 null', () => {
      const prev = new Screen(3, 10);
      const next = new Screen(3, 10);
      fillRow(prev, 0, 0, 'AAAAA');
      fillRow(prev, 1, 0, 'BBBBB');
      fillRow(next, 0, 0, 'BBBBB');
      fillRow(next, 1, 0, 'CCCCC');

      const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 10, height: 3 });
      expect(result).toBeNull();
    });

    it('仅样式不同的两帧不应检测为 uniform shift', () => {
      const prev = new Screen(5, 10);
      const next = new Screen(5, 10);
      // prev: 3 行内容（styleId=0）
      fillRow(prev, 0, 0, 'AAAAA', 0);
      fillRow(prev, 1, 0, 'BBBBB', 0);
      fillRow(prev, 2, 0, 'CCCCC', 0);
      // next: 内容上移 1 行但 styleId 不同
      fillRow(next, 0, 0, 'BBBBB', 1);
      fillRow(next, 1, 0, 'CCCCC', 1);
      fillRow(next, 2, 0, 'DDDDD', 1);

      // styleId 不同 → cell 不匹配 → null
      const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 10, height: 5 });
      expect(result).toBeNull();
    });
  });
});
