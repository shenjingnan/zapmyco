/**
 * Screen noSelect/softWrap/extractRowText/setCellStyleId 单元测试
 */
import { describe, expect, it } from 'vitest';
import { Screen } from '@/ink/screen';

describe('Screen noSelect', () => {
  it('noSelect 应在构造函数中初始化', () => {
    const screen = new Screen(5, 10);
    expect(screen.noSelect).toBeDefined();
    expect(screen.noSelect.length).toBe(50);
    // 默认全为 0
    for (let i = 0; i < 50; i++) {
      expect(screen.noSelect[i]).toBe(0);
    }
  });

  it('markNoSelectRegion 应标记矩形区域', () => {
    const screen = new Screen(5, 10);
    screen.markNoSelectRegion(2, 1, 4, 2);
    // 区域内
    expect(screen.noSelect[1 * 10 + 2]).toBe(1);
    expect(screen.noSelect[1 * 10 + 5]).toBe(1);
    expect(screen.noSelect[2 * 10 + 3]).toBe(1);
    // 区域外
    expect(screen.noSelect[0 * 10 + 0]).toBe(0);
    expect(screen.noSelect[1 * 10 + 1]).toBe(0);
    expect(screen.noSelect[1 * 10 + 6]).toBe(0);
    expect(screen.noSelect[3 * 10 + 3]).toBe(0);
  });

  it('markNoSelectRegion 超出边界应被裁剪', () => {
    const screen = new Screen(5, 10);
    screen.markNoSelectRegion(-2, -1, 10, 10);
    // 不应抛出异常，不应溢出数组
    expect(screen.noSelect[0]).toBe(1);
    // 裁剪后最大可标记到 col 7（x=-2, w=10 → x_end=8, 裁剪到 7）
    expect(screen.noSelect[0 * 10 + 7]).toBe(1);
    expect(screen.noSelect[4 * 10 + 7]).toBe(1);
    // col 8 不应被标记
    expect(screen.noSelect[0 * 10 + 8]).toBe(0);
  });

  it('clearLine 应重置该行的 noSelect', () => {
    const screen = new Screen(5, 10);
    screen.markNoSelectRegion(0, 2, 10, 1);
    expect(screen.noSelect[2 * 10 + 0]).toBe(1);
    screen.clearLine(2);
    expect(screen.noSelect[2 * 10 + 0]).toBe(0);
  });
});

describe('Screen softWrap', () => {
  it('softWrap 应在构造函数中初始化', () => {
    const screen = new Screen(5, 10);
    expect(screen.softWrap).toBeDefined();
    expect(screen.softWrap.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(screen.softWrap[i]).toBe(0);
    }
  });

  it('clearLine 应重置该行 softWrap', () => {
    const screen = new Screen(5, 10);
    screen.softWrap[2] = 1;
    screen.clearLine(2);
    expect(screen.softWrap[2]).toBe(0);
  });
});

describe('Screen extractRowText', () => {
  it('应提取范围内文本', () => {
    const screen = new Screen(5, 20);
    screen.writeString(0, 0, 'Hello World', 1);
    const text = screen.extractRowText(0, 4, 0);
    expect(text).toBe('Hello');
  });

  it('应跳过 noSelect cell', () => {
    const screen = new Screen(5, 20);
    screen.writeString(0, 0, 'Hello World', 1);
    screen.noSelect.fill(1, 0, 6); // 标记 "Hello " 为 noSelect
    const text = screen.extractRowText(0, 10, 0);
    expect(text).toBe('World');
  });

  it('空行应返回空字符串', () => {
    const screen = new Screen(5, 20);
    expect(screen.extractRowText(0, 10, 0)).toBe('');
  });

  it('越界行应返回空字符串', () => {
    const screen = new Screen(5, 20);
    expect(screen.extractRowText(0, 10, -1)).toBe('');
    expect(screen.extractRowText(0, 10, 100)).toBe('');
  });
});

describe('Screen setCellStyleId', () => {
  it('应仅替换 styleId 不改变 char/width', () => {
    const screen = new Screen(5, 10);
    screen.setCell(3, 2, 'A', 1, 1);
    screen.setCellStyleId(3, 2, 5);
    const cell = screen.getCell(3, 2);
    expect(cell.char).toBe('A');
    expect(cell.styleId).toBe(5);
    expect(cell.width).toBe(1);
  });

  it('越界时应静默忽略', () => {
    const screen = new Screen(5, 10);
    expect(() => screen.setCellStyleId(-1, 0, 1)).not.toThrow();
    expect(() => screen.setCellStyleId(0, -1, 1)).not.toThrow();
    expect(() => screen.setCellStyleId(100, 0, 1)).not.toThrow();
  });
});

describe('Screen clone noSelect/softWrap', () => {
  it('clone 应复制 noSelect 和 softWrap', () => {
    const screen = new Screen(5, 10);
    screen.markNoSelectRegion(0, 0, 5, 3);
    screen.softWrap[2] = 1;
    const cloned = screen.clone();
    expect(cloned.noSelect[0]).toBe(1);
    expect(cloned.noSelect[2 * 10 + 4]).toBe(1);
    expect(cloned.softWrap[2]).toBe(1);
    // 修改 clone 不应影响原对象
    cloned.noSelect[0] = 0;
    expect(screen.noSelect[0]).toBe(1);
  });
});

describe('Screen resize noSelect/softWrap', () => {
  it('resize 应保留 noSelect 数据', () => {
    const screen = new Screen(5, 10);
    screen.markNoSelectRegion(0, 0, 5, 3);
    screen.resize(8, 15);
    expect(screen.noSelect[0]).toBe(1);
    expect(screen.noSelect[2 * 15 + 4]).toBe(1);
    // 新增区域应为 0
    expect(screen.noSelect[5 * 15 + 10]).toBe(0);
  });

  it('同尺寸 resize 应保留 noSelect', () => {
    const screen = new Screen(5, 10);
    screen.markNoSelectRegion(0, 0, 5, 3);
    screen.resize(5, 10);
    expect(screen.noSelect[0]).toBe(1);
  });
});

describe('Screen shiftRows noSelect/softWrap', () => {
  it('向上滚动应偏移 noSelect', () => {
    const screen = new Screen(5, 10);
    screen.markNoSelectRegion(0, 2, 10, 1); // 第 2 行标记
    screen.shiftRows(0, 4, 1); // 上移 1 行
    expect(screen.noSelect[1 * 10 + 0]).toBe(1); // 原来第 2 行内容到了第 1 行
    expect(screen.noSelect[2 * 10 + 0]).toBe(0); // 第 2 行被清空
  });

  it('向下滚动应偏移 softWrap', () => {
    const screen = new Screen(5, 10);
    screen.softWrap[2] = 1;
    screen.shiftRows(0, 4, -1); // 下移 1 行
    expect(screen.softWrap[3]).toBe(1); // 原来第 2 行到了第 3 行
    expect(screen.softWrap[2]).toBe(0); // 第 2 行被清空
  });
});
