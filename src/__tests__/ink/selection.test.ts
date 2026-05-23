/**
 * Selection 模块单元测试
 */
import { describe, expect, it } from 'vitest';
import { StylePool } from '@/cli/tui/style-pool';
import { Screen } from '@/ink/screen';
import {
  applySelectionOverlay,
  captureScrolledRows,
  clearSelection,
  createSelectionState,
  extendSelection,
  finishSelection,
  getSelectedText,
  hasSelection,
  isCellSelected,
  moveFocus,
  selectionBounds,
  selectLineAt,
  selectWordAt,
  shiftAnchor,
  shiftSelection,
  startSelection,
  updateSelection,
} from '@/ink/selection';

function createTestScreen(): Screen {
  const screen = new Screen(10, 20);
  // 填充测试文本
  screen.writeString(0, 0, 'Hello World', 1);
  screen.writeString(0, 1, 'This is line two', 1);
  screen.writeString(0, 2, '第三行中文测试', 1);
  screen.writeString(0, 3, 'Word select test here', 1);
  return screen;
}

describe('SelectionState', () => {
  it('createSelectionState 应返回初始状态', () => {
    const s = createSelectionState();
    expect(s.anchor).toBeNull();
    expect(s.focus).toBeNull();
    expect(s.isDragging).toBe(false);
    expect(s.anchorSpan).toBeNull();
    expect(s.scrolledOffAbove).toEqual([]);
    expect(s.scrolledOffBelow).toEqual([]);
  });

  it('startSelection 应设置 anchor 并重置累加器', () => {
    const s = createSelectionState();
    s.scrolledOffAbove = ['old'];
    startSelection(s, 3, 5);
    expect(s.anchor).toEqual({ col: 3, row: 5 });
    expect(s.focus).toBeNull();
    expect(s.isDragging).toBe(true);
    expect(s.scrolledOffAbove).toEqual([]);
  });

  it('updateSelection 应设置 focus', () => {
    const s = createSelectionState();
    startSelection(s, 0, 0);
    updateSelection(s, 5, 2);
    expect(s.focus).toEqual({ col: 5, row: 2 });
  });

  it('updateSelection 在同一位置不应设置 focus（防误触）', () => {
    const s = createSelectionState();
    startSelection(s, 3, 3);
    updateSelection(s, 3, 3);
    expect(s.focus).toBeNull();
  });

  it('updateSelection 在非拖拽状态应为空操作', () => {
    const s = createSelectionState();
    updateSelection(s, 5, 5);
    expect(s.focus).toBeNull();
  });

  it('finishSelection 应设置 isDragging = false', () => {
    const s = createSelectionState();
    startSelection(s, 0, 0);
    updateSelection(s, 5, 2);
    finishSelection(s);
    expect(s.isDragging).toBe(false);
    expect(s.anchor).not.toBeNull();
    expect(s.focus).not.toBeNull();
  });

  it('clearSelection 应重置所有状态', () => {
    const s = createSelectionState();
    startSelection(s, 0, 0);
    updateSelection(s, 5, 2);
    finishSelection(s);
    clearSelection(s);
    expect(s.anchor).toBeNull();
    expect(s.focus).toBeNull();
    expect(s.isDragging).toBe(false);
  });
});

describe('hasSelection / selectionBounds', () => {
  it('无选择时应返回 false/null', () => {
    const s = createSelectionState();
    expect(hasSelection(s)).toBe(false);
    expect(selectionBounds(s)).toBeNull();
  });

  it('仅有 anchor 无 focus 时应返回 false', () => {
    const s = createSelectionState();
    s.anchor = { col: 0, row: 0 };
    expect(hasSelection(s)).toBe(false);
  });

  it('anchor 在 focus 之前应返回正确顺序', () => {
    const s = createSelectionState();
    s.anchor = { col: 0, row: 0 };
    s.focus = { col: 10, row: 5 };
    const bounds = selectionBounds(s);
    expect(bounds).not.toBeNull();
    expect(bounds?.start).toEqual({ col: 0, row: 0 });
    expect(bounds?.end).toEqual({ col: 10, row: 5 });
  });

  it('anchor 在 focus 之后应交换顺序', () => {
    const s = createSelectionState();
    s.anchor = { col: 10, row: 5 };
    s.focus = { col: 0, row: 0 };
    const bounds = selectionBounds(s);
    expect(bounds?.start).toEqual({ col: 0, row: 0 });
    expect(bounds?.end).toEqual({ col: 10, row: 5 });
  });
});

describe('isCellSelected', () => {
  it('选中范围内的单元格应返回 true', () => {
    const s = createSelectionState();
    s.anchor = { col: 2, row: 1 };
    s.focus = { col: 8, row: 3 };
    expect(isCellSelected(s, 5, 2)).toBe(true);
  });

  it('选中范围外的单元格应返回 false', () => {
    const s = createSelectionState();
    s.anchor = { col: 2, row: 1 };
    s.focus = { col: 8, row: 3 };
    expect(isCellSelected(s, 0, 0)).toBe(false);
    expect(isCellSelected(s, 9, 3)).toBe(false);
    expect(isCellSelected(s, 5, 4)).toBe(false);
  });

  it('行边界应正确检测', () => {
    const s = createSelectionState();
    s.anchor = { col: 2, row: 1 };
    s.focus = { col: 8, row: 3 };
    expect(isCellSelected(s, 1, 1)).toBe(false);
    expect(isCellSelected(s, 2, 1)).toBe(true);
    expect(isCellSelected(s, 8, 3)).toBe(true);
    expect(isCellSelected(s, 9, 3)).toBe(false);
  });

  it('无选择时应返回 false', () => {
    const s = createSelectionState();
    expect(isCellSelected(s, 0, 0)).toBe(false);
  });
});

describe('selectWordAt', () => {
  it('应选择英文单词', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    selectWordAt(s, screen, 6, 0); // 'World'
    expect(s.anchor).not.toBeNull();
    expect(s.focus).not.toBeNull();
    const text = getSelectedText(s, screen);
    expect(text).toBe('World');
  });

  it('空白单元格上应无操作', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    selectWordAt(s, screen, 15, 0);
    expect(s.anchor).toBeNull();
  });

  it('noSelect 区域应不选择', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    screen.markNoSelectRegion(0, 0, 5, 1);
    selectWordAt(s, screen, 1, 0);
    expect(s.anchor).toBeNull();
  });

  it('应选择中文文本', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    selectWordAt(s, screen, 0, 2); // '第三行中文测试'
    expect(s.anchor).not.toBeNull();
    expect(s.focus).not.toBeNull();
  });
});

describe('selectLineAt', () => {
  it('应选择整行', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    selectLineAt(s, screen, 0);
    expect(s.anchor).toEqual({ col: 0, row: 0 });
    expect(s.focus).toEqual({ col: 19, row: 0 });
  });

  it('越界行应无操作', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    selectLineAt(s, screen, -1);
    expect(s.anchor).toBeNull();
    selectLineAt(s, screen, 100);
    expect(s.anchor).toBeNull();
  });
});

describe('extendSelection', () => {
  it('单词模式应向前扩展', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    // 先在行 3 选择单词 'select'（位于 cols 5-10 的 "Word select test here" 中）
    selectWordAt(s, screen, 5, 3);
    // 向右拖拽到 'here'（位于 col 17）
    extendSelection(s, screen, 17, 3);
    const text = getSelectedText(s, screen);
    expect(text).toContain('select test');
    expect(text).toContain('her');
  });

  it('行模式应向前扩展', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    selectLineAt(s, screen, 0);
    extendSelection(s, screen, 0, 2);
    const text = getSelectedText(s, screen);
    expect(text).toContain('Hello World');
    expect(text).toContain('第三行中文测试');
  });

  it('无 anchorSpan 时不应扩展', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    startSelection(s, 0, 0);
    updateSelection(s, 5, 2);
    extendSelection(s, screen, 10, 3);
    expect(s.focus).toEqual({ col: 5, row: 2 }); // 未改变
  });
});

describe('getSelectedText', () => {
  it('应提取跨行文本', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    s.anchor = { col: 0, row: 0 };
    s.focus = { col: 7, row: 1 };
    const text = getSelectedText(s, screen);
    // "This is " 末尾空格被 softWrap trimming 移除
    expect(text).toBe('Hello World\nThis is');
  });

  it('无选择时应返回空字符串', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    expect(getSelectedText(s, screen)).toBe('');
  });

  it('仅一行选择', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    s.anchor = { col: 0, row: 0 };
    s.focus = { col: 4, row: 0 };
    const text = getSelectedText(s, screen);
    expect(text).toBe('Hello');
  });

  it('反向选择（focus 在 anchor 前）', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    s.anchor = { col: 10, row: 2 };
    s.focus = { col: 0, row: 0 };
    const text = getSelectedText(s, screen);
    expect(text).toContain('Hello World');
    expect(text).toContain('This is line two');
    // col 10 位于 "第三行中文测试" 的 "测" 字开始处
    expect(text).toContain('第三行中文测');
  });

  it('应跳过 noSelect 区域', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    screen.markNoSelectRegion(0, 0, 6, 1); // 标记 "Hello " 为 noSelect
    s.anchor = { col: 0, row: 0 };
    s.focus = { col: 10, row: 0 };
    const text = getSelectedText(s, screen);
    expect(text).toBe('World');
  });

  it('空 Screen 不应崩溃', () => {
    const s = createSelectionState();
    const empty = new Screen(5, 10);
    s.anchor = { col: 0, row: 0 };
    s.focus = { col: 3, row: 0 };
    expect(getSelectedText(s, empty)).toBe('');
  });
});

describe('moveFocus', () => {
  it('应移动 focus 位置', () => {
    const s = createSelectionState();
    startSelection(s, 0, 0);
    updateSelection(s, 10, 5);
    moveFocus(s, 3, 2);
    expect(s.focus).toEqual({ col: 3, row: 2 });
    expect(s.anchorSpan).toBeNull();
  });

  it('无 focus 时应无操作', () => {
    const s = createSelectionState();
    moveFocus(s, 3, 2);
    expect(s.focus).toBeNull();
  });
});

describe('shiftAnchor', () => {
  it('应偏移 anchor', () => {
    const s = createSelectionState();
    s.anchor = { col: 5, row: 5 };
    s.focus = { col: 10, row: 8 };
    shiftAnchor(s, 2, 0, 10);
    expect(s.anchor?.row).toBe(7);
    expect(s.focus?.row).toBe(8); // focus 不变
  });

  it('应钳位到范围', () => {
    const s = createSelectionState();
    s.anchor = { col: 5, row: 5 };
    s.focus = { col: 10, row: 8 };
    shiftAnchor(s, -10, 0, 10);
    expect(s.anchor?.row).toBe(0);
  });
});

describe('shiftSelection', () => {
  it('应偏移两端', () => {
    const s = createSelectionState();
    s.anchor = { col: 5, row: 3 };
    s.focus = { col: 10, row: 6 };
    shiftSelection(s, 2, 0, 10, 20);
    expect(s.anchor?.row).toBe(5);
    expect(s.focus?.row).toBe(8);
  });

  it('两端均超出范围应清除选择', () => {
    const s = createSelectionState();
    s.anchor = { col: 5, row: 3 };
    s.focus = { col: 10, row: 6 };
    shiftSelection(s, -10, 0, 10, 20);
    expect(s.anchor).toBeNull();
  });
});

describe('applySelectionOverlay', () => {
  it('应修改选中单元格的 styleId', () => {
    const pool = new StylePool();
    // 注册一个风格
    const baseStyle = pool.intern(['32']); // 绿色前景
    const screen = createTestScreen();
    // 将第一行全部设置为池中注册的 styleId
    for (let c = 0; c < 11; c++) {
      screen.setCell(c, 0, screen.getCell(c, 0).char, baseStyle, 1);
    }
    const originalStyle = screen.getCell(0, 0).styleId;

    const s = createSelectionState();
    s.anchor = { col: 0, row: 0 };
    s.focus = { col: 4, row: 0 };

    applySelectionOverlay(screen, s);

    // 选中单元格（col 0-4）的 styleId 应改变（添加了选择背景色）
    expect(screen.getCell(0, 0).styleId).not.toBe(originalStyle);
    // 选中范围外（col > 4）的单元格 styleId 不变
    const outsideStyle = screen.getCell(10, 0).styleId;
    expect(outsideStyle).toBe(originalStyle);
  });

  it('无选择时应无修改', () => {
    const screen = createTestScreen();
    const s = createSelectionState();
    const styleBefore = screen.getCell(0, 0).styleId;
    applySelectionOverlay(screen, s);
    expect(screen.getCell(0, 0).styleId).toBe(styleBefore);
  });

  it('noSelect 区域不应被覆盖', () => {
    const pool = new StylePool();
    // 在 StylePool 中注册一个样式，获取真实 styleId
    const baseStyle = pool.intern(['32']); // 绿色前景
    const screen = createTestScreen();
    // 用池中注册的 styleId 重写第一行
    for (let c = 0; c < 11; c++) {
      const cell = screen.getCell(c, 0);
      screen.setCell(c, 0, cell.char, baseStyle, cell.width);
    }
    screen.markNoSelectRegion(0, 0, 5, 1);

    const s = createSelectionState();
    s.anchor = { col: 0, row: 0 };
    s.focus = { col: 10, row: 0 };

    applySelectionOverlay(screen, s);

    // noSelect 区域的 styleId 不应改变
    const noSelectStyle = screen.getCell(0, 0).styleId;
    const selectedStyle = screen.getCell(6, 0).styleId;
    // 被选中的单元格 styleId 应 > noSelect 区域的 styleId
    expect(selectedStyle).toBeGreaterThan(noSelectStyle);
  });
});

describe('captureScrolledRows', () => {
  it('应捕获上方滚出的选中行', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    s.anchor = { col: 0, row: 0 };
    s.focus = { col: 11, row: 2 };
    captureScrolledRows(s, screen, 0, 1, 'above');
    expect(s.scrolledOffAbove.length).toBe(2);
    expect(s.scrolledOffAbove[0]).toBe('Hello World');
    expect(s.scrolledOffAbove[1]).toBe('This is line two');
  });

  it('无选择时应无捕获', () => {
    const s = createSelectionState();
    const screen = createTestScreen();
    captureScrolledRows(s, screen, 0, 1, 'above');
    expect(s.scrolledOffAbove.length).toBe(0);
  });
});
