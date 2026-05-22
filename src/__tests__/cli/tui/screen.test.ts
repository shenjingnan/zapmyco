/**
 * Screen 缓冲区单元测试
 */
import { describe, expect, it, vi } from 'vitest';
import { Screen } from '@/cli/tui/screen';

describe('Screen', () => {
  describe('constructor', () => {
    it('应创建指定大小的空白缓冲区', () => {
      const screen = new Screen(10, 20);
      expect(screen.rows).toBe(10);
      expect(screen.cols).toBe(20);
      // 所有单元格应为空
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 20; c++) {
          const cell = screen.getCell(c, r);
          expect(cell.char).toBe('');
          expect(cell.styleId).toBe(0);
          expect(cell.width).toBe(1);
        }
      }
    });

    it('应创建 1x1 的最小缓冲区', () => {
      const screen = new Screen(1, 1);
      expect(screen.rows).toBe(1);
      expect(screen.cols).toBe(1);
      const cell = screen.getCell(0, 0);
      expect(cell.char).toBe('');
    });

    it('超大尺寸不应抛异常', () => {
      expect(() => new Screen(200, 500)).not.toThrow();
    });
  });

  describe('getCell / setCell', () => {
    it('应写入并读取单元格', () => {
      const screen = new Screen(5, 10);
      screen.setCell(3, 2, 'A', 1, 1);
      const cell = screen.getCell(3, 2);
      expect(cell.char).toBe('A');
      expect(cell.styleId).toBe(1);
      expect(cell.width).toBe(1);
    });

    it('覆盖已有单元格', () => {
      const screen = new Screen(5, 10);
      screen.setCell(0, 0, 'A', 1, 1);
      screen.setCell(0, 0, 'B', 2, 1);
      const cell = screen.getCell(0, 0);
      expect(cell.char).toBe('B');
      expect(cell.styleId).toBe(2);
    });

    it('写入宽字符应正确设置 width', () => {
      const screen = new Screen(5, 10);
      screen.setCell(0, 0, '中', 1, 2);
      const cell = screen.getCell(0, 0);
      expect(cell.char).toBe('中');
      expect(cell.width).toBe(2);
    });

    it('越界读应返回空单元格', () => {
      const screen = new Screen(5, 10);
      const cell = screen.getCell(-1, 0);
      expect(cell.char).toBe('');
      expect(cell.styleId).toBe(0);
    });

    it('越界写应静默忽略', () => {
      const screen = new Screen(5, 10);
      expect(() => screen.setCell(-1, 0, 'A', 1, 1)).not.toThrow();
      expect(() => screen.setCell(0, -1, 'A', 1, 1)).not.toThrow();
      expect(() => screen.setCell(100, 0, 'A', 1, 1)).not.toThrow();
      expect(() => screen.setCell(0, 100, 'A', 1, 1)).not.toThrow();
    });
  });

  describe('fill', () => {
    it('应全屏填充指定字符', () => {
      const screen = new Screen(3, 4);
      screen.fill('X', 2);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const cell = screen.getCell(c, r);
          expect(cell.char).toBe('X');
          expect(cell.styleId).toBe(2);
        }
      }
    });
  });

  describe('clearLine', () => {
    it('应清空指定行', () => {
      const screen = new Screen(3, 5);
      screen.fill('X', 1);
      screen.clearLine(1);
      // 第 1 行应清空
      for (let c = 0; c < 5; c++) {
        const cell = screen.getCell(c, 1);
        expect(cell.char).toBe('');
      }
      // 其他行不受影响
      expect(screen.getCell(0, 0).char).toBe('X');
      expect(screen.getCell(0, 2).char).toBe('X');
    });

    it('越界行应静默忽略', () => {
      const screen = new Screen(3, 5);
      expect(() => screen.clearLine(-1)).not.toThrow();
      expect(() => screen.clearLine(100)).not.toThrow();
    });
  });

  describe('clearRegion', () => {
    it('应清空指定矩形区域', () => {
      const screen = new Screen(5, 5);
      screen.fill('X', 1);
      screen.clearRegion(1, 1, 3, 3);
      for (let r = 1; r < 4; r++) {
        for (let c = 1; c < 4; c++) {
          expect(screen.getCell(c, r).char).toBe('');
        }
      }
      // 区域外不受影响
      expect(screen.getCell(0, 0).char).toBe('X');
      expect(screen.getCell(4, 4).char).toBe('X');
    });
  });

  describe('blitRegion', () => {
    it('应将源区域拷贝到目标位置', () => {
      const src = new Screen(10, 10);
      src.setCell(2, 2, 'A', 1, 1);
      src.setCell(3, 2, 'B', 1, 1);

      const dst = new Screen(10, 10);
      dst.blitRegion(src, 2, 2, 5, 5, 2, 1);

      expect(dst.getCell(5, 5).char).toBe('A');
      expect(dst.getCell(6, 5).char).toBe('B');
      expect(dst.getCell(4, 5).char).toBe(''); // 区域外未改变
    });

    it('源超出边界应安全处理', () => {
      const src = new Screen(5, 5);
      src.setCell(4, 4, 'X', 1, 1);
      const dst = new Screen(10, 10);
      expect(() => dst.blitRegion(src, 3, 3, 0, 0, 5, 5)).not.toThrow();
    });
  });

  describe('shiftRows', () => {
    it('向上移动行（delta > 0）', () => {
      const screen = new Screen(5, 5);
      screen.setCell(0, 2, 'A', 1, 1);
      screen.setCell(0, 3, 'B', 1, 1);
      screen.setCell(0, 4, 'C', 1, 1);

      screen.shiftRows(0, 4, 2);

      // 第 2 行内容上移了 2 行
      expect(screen.getCell(0, 0).char).toBe('A');
      expect(screen.getCell(0, 1).char).toBe('B');
      expect(screen.getCell(0, 2).char).toBe('C');
      // 底部空行
      expect(screen.getCell(0, 3).char).toBe('');
      expect(screen.getCell(0, 4).char).toBe('');
    });

    it('向下移动行（delta < 0）', () => {
      const screen = new Screen(5, 5);
      screen.setCell(0, 0, 'A', 1, 1);
      screen.setCell(0, 1, 'B', 1, 1);
      screen.setCell(0, 2, 'C', 1, 1);

      screen.shiftRows(0, 4, -2);

      expect(screen.getCell(0, 2).char).toBe('A');
      expect(screen.getCell(0, 3).char).toBe('B');
      expect(screen.getCell(0, 4).char).toBe('C');
      // 顶部空行
      expect(screen.getCell(0, 0).char).toBe('');
      expect(screen.getCell(0, 1).char).toBe('');
    });

    it('delta 为 0 不应改变内容', () => {
      const screen = new Screen(5, 5);
      screen.setCell(0, 2, 'A', 1, 1);
      screen.shiftRows(0, 4, 0);
      expect(screen.getCell(0, 2).char).toBe('A');
    });

    it('越界参数应静默忽略', () => {
      const screen = new Screen(5, 5);
      expect(() => screen.shiftRows(-1, 4, 1)).not.toThrow();
      expect(() => screen.shiftRows(0, 100, 1)).not.toThrow();
      expect(() => screen.shiftRows(4, 2, 1)).not.toThrow(); // top > bottom
    });
  });

  describe('clone', () => {
    it('应返回内容的深拷贝', () => {
      const screen = new Screen(5, 10);
      screen.setCell(3, 2, 'A', 1, 1);
      screen.setCell(7, 4, 'B', 2, 2);

      const cloned = screen.clone();
      expect(cloned.rows).toBe(5);
      expect(cloned.cols).toBe(10);
      expect(cloned.getCell(3, 2).char).toBe('A');
      expect(cloned.getCell(7, 4).char).toBe('B');

      // 修改拷贝不应影响原对象
      cloned.setCell(3, 2, 'C', 3, 1);
      expect(screen.getCell(3, 2).char).toBe('A');
    });
  });

  describe('writeString', () => {
    it('应连续写入字符串', () => {
      const screen = new Screen(5, 20);
      screen.writeString(2, 1, 'hello', 1);
      expect(screen.getCell(2, 1).char).toBe('h');
      expect(screen.getCell(3, 1).char).toBe('e');
      expect(screen.getCell(6, 1).char).toBe('o');
    });

    it('超过右边界应静默截断', () => {
      const screen = new Screen(5, 5);
      screen.writeString(3, 1, 'abcdef', 1);
      // 只应写入 'ab' (列 3, 4)
      expect(screen.getCell(3, 1).char).toBe('a');
      expect(screen.getCell(4, 1).char).toBe('b');
      expect(screen.getCell(0, 1).char).toBe(''); // 未写入
    });

    it('越界行不应写入', () => {
      const screen = new Screen(5, 10);
      screen.writeString(0, -1, 'hello', 1);
      screen.writeString(0, 100, 'hello', 1);
      // 不应抛出异常
    });

    it('空字符串应为空操作', () => {
      const screen = new Screen(5, 10);
      expect(() => screen.writeString(0, 0, '', 1)).not.toThrow();
    });
  });

  describe('forEachCell', () => {
    it('应遍历所有非空单元格', () => {
      const screen = new Screen(5, 5);
      screen.setCell(0, 0, 'A', 1, 1);
      screen.setCell(4, 4, 'B', 2, 1);

      const visited: Array<{ col: number; row: number; char: string }> = [];
      screen.forEachCell((col, row, cell) => {
        visited.push({ col, row, char: cell.char });
      });

      expect(visited).toHaveLength(2);
      expect(visited[0]).toEqual({ col: 0, row: 0, char: 'A' });
      expect(visited[1]).toEqual({ col: 4, row: 4, char: 'B' });
    });

    it('空缓冲区不应回调', () => {
      const screen = new Screen(5, 5);
      const cb = vi.fn();
      screen.forEachCell(cb);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('resize', () => {
    it('同尺寸 resize 应为空操作', () => {
      const screen = new Screen(5, 10);
      screen.setCell(3, 2, 'A', 1, 1);
      screen.resize(5, 10);
      expect(screen.getCell(3, 2).char).toBe('A');
      expect(screen.rows).toBe(5);
      expect(screen.cols).toBe(10);
    });

    it('放大应保留原内容，新增区域为空', () => {
      const screen = new Screen(2, 4);
      screen.setCell(0, 0, 'A', 1, 1);
      screen.setCell(1, 1, 'B', 1, 1);
      screen.resize(4, 8);

      expect(screen.getCell(0, 0).char).toBe('A');
      expect(screen.getCell(1, 1).char).toBe('B');
      // 新增区域为空
      expect(screen.getCell(7, 3).char).toBe('');
      expect(screen.rows).toBe(4);
      expect(screen.cols).toBe(8);
    });

    it('缩小应保留左上部分内容', () => {
      const screen = new Screen(5, 10);
      screen.setCell(8, 4, 'A', 1, 1);
      screen.setCell(0, 0, 'B', 1, 1);
      screen.resize(3, 5);

      // 保留的内容
      expect(screen.getCell(0, 0).char).toBe('B');
      // 被裁剪掉的内容
      expect(screen.getCell(8, 4).char).toBe(''); // 越界了
      expect(screen.rows).toBe(3);
      expect(screen.cols).toBe(5);
    });
  });
});
