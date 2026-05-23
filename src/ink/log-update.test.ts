/**
 * log-update — Screen diff 引擎单元测试
 *
 * PR6: 新增 detectDecstbmScroll 测试
 */

import { describe, expect, it } from 'vitest';
import { detectDecstbmScroll } from './log-update';
import { Screen } from './screen';

// ---------------------------------------------------------------------------
// detectDecstbmScroll
// ---------------------------------------------------------------------------

describe('detectDecstbmScroll', () => {
  it('高度不足 2 应返回 null', () => {
    const prev = new Screen(3, 5);
    const next = new Screen(3, 5);
    // 高度 1 的矩形无法滚动
    const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 5, height: 1 });
    expect(result).toBeNull();
  });

  it('内容完全相同时应返回 null', () => {
    const prev = new Screen(5, 5);
    const next = new Screen(5, 5);

    // 两帧写入相同内容
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        prev.setCell(c, r, `${r}`, 0, 1);
        next.setCell(c, r, `${r}`, 0, 1);
      }
    }

    const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 5, height: 5 });
    expect(result).toBeNull();
  });

  it('内容全部不同时应返回 null', () => {
    const prev = new Screen(5, 5);
    const next = new Screen(5, 5);

    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        prev.setCell(c, r, 'a', 0, 1);
        next.setCell(c, r, 'b', 0, 1);
      }
    }

    const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 5, height: 5 });
    expect(result).toBeNull();
  });

  it('均匀向下位移 1 行时应返回 delta=1', () => {
    const prev = new Screen(5, 5);
    const next = new Screen(5, 5);

    // prev: row0=a, row1=b, row2=c, row3=d, row4=e
    const rows = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee'];
    for (let r = 0; r < 5; r++) {
      const text = rows[r] ?? '';
      for (let c = 0; c < 5; c++) {
        prev.setCell(c, r, text[c] ?? '', 0, 1);
      }
    }

    // next: row0=b, row1=c, row2=d, row3=e, row4=NEW
    // 旧内容下移 1 行
    const nextRows = ['bbbbb', 'ccccc', 'ddddd', 'eeeee', 'xxxxx'];
    for (let r = 0; r < 5; r++) {
      const text = nextRows[r] ?? '';
      for (let c = 0; c < 5; c++) {
        next.setCell(c, r, text[c] ?? '', 0, 1);
      }
    }

    // 在 0..5 区域检测，应发现 delta=1
    const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 5, height: 5 });
    expect(result).toBe(1);
  });

  it('均匀向下位移 2 行时应返回 delta=2', () => {
    const prev = new Screen(6, 3);
    const next = new Screen(6, 3);

    // prev: row0=a, row1=b, row2=c, row3=d, row4=e, row5=f
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 3; c++) {
        prev.setCell(c, r, String.fromCharCode(97 + r), 0, 1);
      }
    }

    // next: row0=c, row1=d, row2=e, row3=f, row4=NEW, row5=NEW
    for (let r = 0; r < 6; r++) {
      const ch = r < 4 ? String.fromCharCode(99 + r) : 'x';
      for (let c = 0; c < 3; c++) {
        next.setCell(c, r, ch, 0, 1);
      }
    }

    const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 3, height: 6 });
    expect(result).toBe(2);
  });

  it('部分行匹配但非均匀位移时应返回 null', () => {
    const prev = new Screen(4, 4);
    const next = new Screen(4, 4);

    // prev
    for (let c = 0; c < 4; c++) {
      prev.setCell(c, 0, 'a', 0, 1);
      prev.setCell(c, 1, 'b', 0, 1);
      prev.setCell(c, 2, 'c', 0, 1);
      prev.setCell(c, 3, 'd', 0, 1);
    }

    // next: row1 不同，破坏 uniform shift
    for (let c = 0; c < 4; c++) {
      next.setCell(c, 0, 'b', 0, 1);
      next.setCell(c, 1, 'z', 0, 1); // 不是 'c'
      next.setCell(c, 2, 'd', 0, 1);
      next.setCell(c, 3, 'x', 0, 1);
    }

    const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 4, height: 4 });
    expect(result).toBeNull();
  });

  it('指定矩形区域外变化不影响检测', () => {
    const prev = new Screen(6, 4);
    const next = new Screen(6, 4);

    // 区域内 uniform shift
    for (let c = 0; c < 4; c++) {
      prev.setCell(c, 1, 'a', 0, 1);
      prev.setCell(c, 2, 'b', 0, 1);
      prev.setCell(c, 3, 'c', 0, 1);
      next.setCell(c, 1, 'b', 0, 1); // shifted
      next.setCell(c, 2, 'c', 0, 1);
      next.setCell(c, 3, 'x', 0, 1);
    }

    // 区域外不同（不应影响）
    prev.setCell(0, 0, 'o', 0, 1);
    next.setCell(0, 0, 'z', 0, 1);

    const result = detectDecstbmScroll(prev, next, { x: 0, y: 1, width: 4, height: 3 });
    expect(result).toBe(1);
  });

  it('两帧行数不足时返回 null', () => {
    const prev = new Screen(3, 3);
    const next = new Screen(3, 3);

    // prev rows check: 检测区域超过帧本身
    const result = detectDecstbmScroll(prev, next, { x: 0, y: 0, width: 3, height: 5 });
    expect(result).toBeNull();
  });
});
