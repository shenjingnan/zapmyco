/**
 * Selection — 文本选择模块
 *
 * 在 Screen buffer 上实现终端文本选择系统。
 * 支持三种选择模式：字符（单击拖拽）、单词（双击）、行（三击）。
 *
 * 参考 claude-code src/ink/selection.ts
 */

import type { StylePool } from '@/cli/tui/style-pool';
import type { Screen } from './screen';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Point = { col: number; row: number };

export type SelectionState = {
  /** 鼠标按下时的锚点。null = 无选择 */
  anchor: Point | null;
  /** 当前拖拽位置。鼠标拖拽过程中更新。 */
  focus: Point | null;
  /** 是否处于拖拽中（mouse-down 和 mouse-up 之间） */
  isDragging: boolean;
  /**
   * 多击（双击/三击）锚定的范围。
   * 存在时表示当前处于单词/行扩展模式。
   * null = 字符模式。
   */
  anchorSpan: { lo: Point; hi: Point; kind: 'word' | 'line' } | null;
  /** 从视口上方滚出的选中行文本 */
  scrolledOffAbove: string[];
  /** 从视口下方滚出的选中行文本 */
  scrolledOffBelow: string[];
  /** scrolledOffAbove 对应的 soft-wrap 标记 */
  scrolledOffAboveSW: boolean[];
  /** scrolledOffBelow 对应的 soft-wrap 标记 */
  scrolledOffBelowSW: boolean[];
  /** 预钳位的锚点行（anchor 被钳位时记录真实行号，用于反向滚动恢复） */
  virtualAnchorRow: number | undefined;
  /** 预钳位的焦点行 */
  virtualFocusRow: number | undefined;
  /** 鼠标按下时是否带有 alt 修饰键 */
  lastPressHadAlt: boolean;
};

/** 键盘焦点移动方向 */
export type FocusMove = 'left' | 'right' | 'up' | 'down' | 'lineStart' | 'lineEnd';

// ---------------------------------------------------------------------------
// 创建初始状态
// ---------------------------------------------------------------------------

export function createSelectionState(): SelectionState {
  return {
    anchor: null,
    focus: null,
    isDragging: false,
    anchorSpan: null,
    scrolledOffAbove: [],
    scrolledOffBelow: [],
    scrolledOffAboveSW: [],
    scrolledOffBelowSW: [],
    virtualAnchorRow: undefined,
    virtualFocusRow: undefined,
    lastPressHadAlt: false,
  };
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

export function startSelection(s: SelectionState, col: number, row: number): void {
  s.anchor = { col, row };
  s.focus = null;
  s.isDragging = true;
  s.anchorSpan = null;
  s.scrolledOffAbove = [];
  s.scrolledOffBelow = [];
  s.scrolledOffAboveSW = [];
  s.scrolledOffBelowSW = [];
  s.virtualAnchorRow = undefined;
  s.virtualFocusRow = undefined;
  s.lastPressHadAlt = false;
}

export function updateSelection(s: SelectionState, col: number, row: number): void {
  if (!s.isDragging) return;
  // 首次移动在同一单元格是无效操作（防止单击变成 1 格选择）
  if (!s.focus && s.anchor && s.anchor.col === col && s.anchor.row === row) return;
  s.focus = { col, row };
}

export function finishSelection(s: SelectionState): void {
  s.isDragging = false;
  // 保持 anchor/focus 以便高亮继续显示
}

export function clearSelection(s: SelectionState): void {
  s.anchor = null;
  s.focus = null;
  s.isDragging = false;
  s.anchorSpan = null;
  s.scrolledOffAbove = [];
  s.scrolledOffBelow = [];
  s.scrolledOffAboveSW = [];
  s.scrolledOffBelowSW = [];
  s.virtualAnchorRow = undefined;
  s.virtualFocusRow = undefined;
  s.lastPressHadAlt = false;
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export function hasSelection(s: SelectionState): boolean {
  return s.anchor !== null && s.focus !== null;
}

/** 比较两个 Point 的阅读顺序。-1 = a < b, 0 = 相等, 1 = a > b */
function comparePoints(a: Point, b: Point): number {
  if (a.row !== b.row) return a.row < b.row ? -1 : 1;
  if (a.col !== b.col) return a.col < b.col ? -1 : 1;
  return 0;
}

/** 规范化选择边界：start 始终在 end 之前。无选择时返回 null。 */
export function selectionBounds(s: SelectionState): { start: Point; end: Point } | null {
  if (!s.anchor || !s.focus) return null;
  return comparePoints(s.anchor, s.focus) <= 0
    ? { start: s.anchor, end: s.focus }
    : { start: s.focus, end: s.anchor };
}

/** 检查单元格是否被选中 */
export function isCellSelected(s: SelectionState, col: number, row: number): boolean {
  const b = selectionBounds(s);
  if (!b) return false;
  const { start, end } = b;
  if (row < start.row || row > end.row) return false;
  if (row === start.row && col < start.col) return false;
  if (row === end.row && col > end.col) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 单词选择（双击）
// ---------------------------------------------------------------------------

// Unicode-aware word character matcher
// 匹配 includes 字母、数字、以及 iTerm2 默认视作单词部分的标点
const WORD_CHAR = /[\p{L}\p{N}_/.\-+~\\]/u;

/**
 * 字符分类用于双击选择。
 * 0 = 空白, 1 = 单词字符, 2 = 其他
 */
function charClass(c: string): 0 | 1 | 2 {
  if (c === ' ' || c === '') return 0;
  if (WORD_CHAR.test(c)) return 1;
  return 2;
}

/**
 * 找到 (col, row) 所在同类字符运行的边界。
 * 用于 selectWordAt 和 extendSelection。
 */
function wordBoundsAt(screen: Screen, col: number, row: number): { lo: number; hi: number } | null {
  if (row < 0 || row >= screen.rows) return null;
  const width = screen.cols;
  const rowOff = row * width;

  // 如果点击在宽字符的 spacer tail 上，回退一格
  let c = col;
  if (c > 0) {
    const cell = screen.getCell(c, row);
    if (cell && cell.width === 2 && cell.char === '') c -= 1;
  }
  if (c < 0 || c >= width) return null;
  // 检查是否在 noSelect 区域
  if (screen.noSelect[rowOff + c] === 1) return null;

  const startCell = screen.getCell(c, row);
  if (!startCell) return null;
  // 空单元格不应视为可选择的单词
  if (startCell.char === '') return null;
  const cls = charClass(startCell.char);

  // 向左扩展
  let lo = c;
  while (lo > 0) {
    const prev = lo - 1;
    if (screen.noSelect[rowOff + prev] === 1) break;
    const pc = screen.getCell(prev, row);
    if (!pc) break;
    if (pc.width === 2 && pc.char === '') {
      // 跳过 spacer tail 到宽字符头部
      if (prev === 0 || screen.noSelect[rowOff + prev - 1] === 1) break;
      const head = screen.getCell(prev - 1, row);
      if (!head || charClass(head.char) !== cls) break;
      lo = prev - 1;
      continue;
    }
    if (charClass(pc.char) !== cls) break;
    lo = prev;
  }

  // 向右扩展
  let hi = c;
  while (hi < width - 1) {
    const next = hi + 1;
    if (screen.noSelect[rowOff + next] === 1) break;
    const nc = screen.getCell(next, row);
    if (!nc) break;
    if (nc.width === 2 && nc.char === '') {
      hi = next;
      continue;
    }
    if (charClass(nc.char) !== cls) break;
    hi = next;
  }

  return { lo, hi };
}

/** 双击选择单词 */
export function selectWordAt(s: SelectionState, screen: Screen, col: number, row: number): void {
  const b = wordBoundsAt(screen, col, row);
  if (!b) return;
  const lo = { col: b.lo, row };
  const hi = { col: b.hi, row };
  s.anchor = lo;
  s.focus = hi;
  s.isDragging = true;
  s.anchorSpan = { lo, hi, kind: 'word' };
}

/** 三击选择整行 */
export function selectLineAt(s: SelectionState, screen: Screen, row: number): void {
  if (row < 0 || row >= screen.rows) return;
  const lo = { col: 0, row };
  const hi = { col: screen.cols - 1, row };
  s.anchor = lo;
  s.focus = hi;
  s.isDragging = true;
  s.anchorSpan = { lo, hi, kind: 'line' };
}

// ---------------------------------------------------------------------------
// 扩展选择（多击后拖拽）
// ---------------------------------------------------------------------------

/**
 * 扩展单词/行模式的选择到鼠标当前所在的单词/行。
 * 原始锚定范围保持选中，选择从该范围扩展到当前鼠标目标。
 */
export function extendSelection(s: SelectionState, screen: Screen, col: number, row: number): void {
  if (!s.isDragging || !s.anchorSpan) return;
  const span = s.anchorSpan;

  let mLo: Point;
  let mHi: Point;

  if (span.kind === 'word') {
    const b = wordBoundsAt(screen, col, row);
    mLo = { col: b ? b.lo : col, row };
    mHi = { col: b ? b.hi : col, row };
  } else {
    const r = Math.max(0, Math.min(row, screen.rows - 1));
    mLo = { col: 0, row: r };
    mHi = { col: screen.cols - 1, row: r };
  }

  if (comparePoints(mHi, span.lo) < 0) {
    // 鼠标目标在锚定范围之前：向后扩展
    s.anchor = span.hi;
    s.focus = mLo;
  } else if (comparePoints(mLo, span.hi) > 0) {
    // 鼠标目标在锚定范围之后：向前扩展
    s.anchor = span.lo;
    s.focus = mHi;
  } else {
    // 鼠标与锚定范围重叠：选中锚定范围自身
    s.anchor = span.lo;
    s.focus = span.hi;
  }
}

// ---------------------------------------------------------------------------
// 键盘移动
// ---------------------------------------------------------------------------

/** 键盘移动 focus（shift+方向键），anchor 固定。清除 anchorSpan 退化为字符模式。 */
export function moveFocus(s: SelectionState, col: number, row: number): void {
  if (!s.focus) return;
  s.anchorSpan = null;
  s.focus = { col, row };
  s.virtualFocusRow = undefined;
}

// ---------------------------------------------------------------------------
// 滚动偏移
// ---------------------------------------------------------------------------

/**
 * 键盘滚动时同时偏移 anchor 和 focus。钳位到 [minRow, maxRow]。
 * 两端同时超出同一边缘时清除选择。
 */
export function shiftSelection(
  s: SelectionState,
  dRow: number,
  minRow: number,
  maxRow: number,
  width: number
): void {
  if (!s.anchor || !s.focus) return;

  const vAnchor = (s.virtualAnchorRow ?? s.anchor.row) + dRow;
  const vFocus = (s.virtualFocusRow ?? s.focus.row) + dRow;

  if ((vAnchor < minRow && vFocus < minRow) || (vAnchor > maxRow && vFocus > maxRow)) {
    clearSelection(s);
    return;
  }

  // 管理滚出累加器
  const oldMin = Math.min(s.virtualAnchorRow ?? s.anchor.row, s.virtualFocusRow ?? s.focus.row);
  const oldMax = Math.max(s.virtualAnchorRow ?? s.anchor.row, s.virtualFocusRow ?? s.focus.row);
  const oldAboveDebt = Math.max(0, minRow - oldMin);
  const oldBelowDebt = Math.max(0, oldMax - maxRow);
  const newAboveDebt = Math.max(0, minRow - Math.min(vAnchor, vFocus));
  const newBelowDebt = Math.max(0, Math.max(vAnchor, vFocus) - maxRow);

  if (newAboveDebt < oldAboveDebt) {
    const drop = oldAboveDebt - newAboveDebt;
    s.scrolledOffAbove.length -= drop;
    s.scrolledOffAboveSW.length = s.scrolledOffAbove.length;
  }
  if (newBelowDebt < oldBelowDebt) {
    const drop = oldBelowDebt - newBelowDebt;
    s.scrolledOffBelow.splice(0, drop);
    s.scrolledOffBelowSW.splice(0, drop);
  }

  // 修剪多余累加器
  if (s.scrolledOffAbove.length > newAboveDebt) {
    s.scrolledOffAbove = newAboveDebt > 0 ? s.scrolledOffAbove.slice(-newAboveDebt) : [];
    s.scrolledOffAboveSW = newAboveDebt > 0 ? s.scrolledOffAboveSW.slice(-newAboveDebt) : [];
  }
  if (s.scrolledOffBelow.length > newBelowDebt) {
    s.scrolledOffBelow = s.scrolledOffBelow.slice(0, newBelowDebt);
    s.scrolledOffBelowSW = s.scrolledOffBelowSW.slice(0, newBelowDebt);
  }

  const shift = (p: Point, vRow: number): Point => {
    if (vRow < minRow) return { col: 0, row: minRow };
    if (vRow > maxRow) return { col: width - 1, row: maxRow };
    return { col: p.col, row: vRow };
  };

  s.anchor = shift(s.anchor, vAnchor);
  s.focus = shift(s.focus, vFocus);
  s.virtualAnchorRow = vAnchor < minRow || vAnchor > maxRow ? vAnchor : undefined;
  s.virtualFocusRow = vFocus < minRow || vFocus > maxRow ? vFocus : undefined;

  if (s.anchorSpan) {
    const sp = (p: Point): Point => {
      const r = p.row + dRow;
      if (r < minRow) return { col: 0, row: minRow };
      if (r > maxRow) return { col: width - 1, row: maxRow };
      return { col: p.col, row: r };
    };
    s.anchorSpan = {
      lo: sp(s.anchorSpan.lo),
      hi: sp(s.anchorSpan.hi),
      kind: s.anchorSpan.kind,
    };
  }
}

/**
 * 拖拽滚动时仅偏移 anchor（focus 跟随鼠标位置）。
 */
export function shiftAnchor(s: SelectionState, dRow: number, minRow: number, maxRow: number): void {
  if (!s.anchor) return;
  const raw = (s.virtualAnchorRow ?? s.anchor.row) + dRow;
  s.anchor = { col: s.anchor.col, row: Math.max(minRow, Math.min(maxRow, raw)) };
  s.virtualAnchorRow = raw < minRow || raw > maxRow ? raw : undefined;

  if (s.anchorSpan) {
    const shift = (p: Point): Point => ({
      col: p.col,
      row: Math.max(minRow, Math.min(maxRow, p.row + dRow)),
    });
    s.anchorSpan = {
      lo: shift(s.anchorSpan.lo),
      hi: shift(s.anchorSpan.hi),
      kind: s.anchorSpan.kind,
    };
  }
}

/**
 * 跟随滚动时两端同时偏移。
 * 返回 true 表示选择已被清除。
 */
export function shiftSelectionForFollow(
  s: SelectionState,
  dRow: number,
  minRow: number,
  maxRow: number
): boolean {
  if (!s.anchor) return false;
  const rawAnchor = (s.virtualAnchorRow ?? s.anchor.row) + dRow;
  const rawFocus = s.focus ? (s.virtualFocusRow ?? s.focus.row) + dRow : undefined;

  if (rawAnchor < minRow && rawFocus !== undefined && rawFocus < minRow) {
    clearSelection(s);
    return true;
  }

  s.anchor = { col: s.anchor.col, row: Math.max(minRow, Math.min(maxRow, rawAnchor)) };
  if (s.focus && rawFocus !== undefined) {
    s.focus = { col: s.focus.col, row: Math.max(minRow, Math.min(maxRow, rawFocus)) };
  }
  s.virtualAnchorRow = rawAnchor < minRow || rawAnchor > maxRow ? rawAnchor : undefined;
  s.virtualFocusRow =
    rawFocus !== undefined && (rawFocus < minRow || rawFocus > maxRow) ? rawFocus : undefined;

  if (s.anchorSpan) {
    const shift = (p: Point): Point => ({
      col: p.col,
      row: Math.max(minRow, Math.min(maxRow, p.row + dRow)),
    });
    s.anchorSpan = {
      lo: shift(s.anchorSpan.lo),
      hi: shift(s.anchorSpan.hi),
      kind: s.anchorSpan.kind,
    };
  }
  return false;
}

// ---------------------------------------------------------------------------
// 文本提取
// ---------------------------------------------------------------------------

/** 提取一行中指定范围内的文本，处理 noSelect、spacer tail、softWrap */
function extractRowText(screen: Screen, row: number, colStart: number, colEnd: number): string {
  const noSelect = screen.noSelect;
  const rowOff = row * screen.cols;
  const contentEnd: number = (row + 1 < screen.rows ? screen.softWrap[row + 1] : 0) ?? 0;
  const lastCol = contentEnd > 0 ? Math.min(colEnd, contentEnd - 1) : colEnd;
  let line = '';
  for (let col = colStart; col <= lastCol; col++) {
    if (noSelect[rowOff + col] === 1) continue;
    const cell = screen.getCell(col, row);
    if (!cell) continue;
    // 跳过 spacer tail
    if (cell.width === 2 && cell.char === '') continue;
    line += cell.char;
  }
  return contentEnd > 0 ? line : line.replace(/\s+$/, '');
}

/** 连接行，处理 softWrap 续行 */
function joinRows(lines: string[], text: string, sw: boolean | undefined): void {
  if (sw && lines.length > 0) {
    lines[lines.length - 1] += text;
  } else {
    lines.push(text);
  }
}

/**
 * 从 Screen buffer 中提取选中文本。
 * 包括滚出累加器中的文本（drag-to-scroll 时）。
 * softWrap 续行正确拼接为逻辑行。
 */
export function getSelectedText(s: SelectionState, screen: Screen): string {
  const b = selectionBounds(s);
  if (!b) return '';
  const { start, end } = b;
  const lines: string[] = [];

  // 滚出累加器（上方）
  for (let i = 0; i < s.scrolledOffAbove.length; i++) {
    joinRows(lines, s.scrolledOffAbove[i] ?? '', s.scrolledOffAboveSW[i]);
  }

  // 视口中选中的行
  for (let row = start.row; row <= end.row; row++) {
    const rowStart = row === start.row ? start.col : 0;
    const rowEnd = row === end.row ? end.col : screen.cols - 1;
    const sw = (screen.softWrap[row] ?? 0) > 0;
    joinRows(lines, extractRowText(screen, row, rowStart, rowEnd), sw);
  }

  // 滚出累加器（下方）
  for (let i = 0; i < s.scrolledOffBelow.length; i++) {
    joinRows(lines, s.scrolledOffBelow[i] ?? '', s.scrolledOffBelowSW[i]);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 滚出捕获（drag-to-scroll）
// ---------------------------------------------------------------------------

/**
 * 在行被 ScrollBox 滚出视口前捕获选中文本。
 * side='above': 拖拽向下滚动，行从顶部移出
 * side='below': 拖拽向上滚动，行从底部移出
 */
export function captureScrolledRows(
  s: SelectionState,
  screen: Screen,
  firstRow: number,
  lastRow: number,
  side: 'above' | 'below'
): void {
  const b = selectionBounds(s);
  if (!b || firstRow > lastRow) return;
  const { start, end } = b;
  const lo = Math.max(firstRow, start.row);
  const hi = Math.min(lastRow, end.row);
  if (lo > hi) return;

  const width = screen.cols;
  const captured: string[] = [];
  const capturedSW: boolean[] = [];

  for (let row = lo; row <= hi; row++) {
    const colStart = row === start.row ? start.col : 0;
    const colEnd = row === end.row ? end.col : width - 1;
    captured.push(extractRowText(screen, row, colStart, colEnd));
    capturedSW.push((screen.softWrap[row] ?? 0) > 0);
  }

  if (side === 'above') {
    s.scrolledOffAbove.push(...captured);
    s.scrolledOffAboveSW.push(...capturedSW);
    if (s.anchor && s.anchor.row === start.row && lo === start.row) {
      s.anchor = { col: 0, row: s.anchor.row };
      if (s.anchorSpan) {
        s.anchorSpan = {
          kind: s.anchorSpan.kind,
          lo: { col: 0, row: s.anchorSpan.lo.row },
          hi: { col: width - 1, row: s.anchorSpan.hi.row },
        };
      }
    }
  } else {
    s.scrolledOffBelow.unshift(...captured);
    s.scrolledOffBelowSW.unshift(...capturedSW);
    if (s.anchor && s.anchor.row === end.row && hi === end.row) {
      s.anchor = { col: width - 1, row: s.anchor.row };
      if (s.anchorSpan) {
        s.anchorSpan = {
          kind: s.anchorSpan.kind,
          lo: { col: 0, row: s.anchorSpan.lo.row },
          hi: { col: width - 1, row: s.anchorSpan.hi.row },
        };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 选择覆盖渲染
// ---------------------------------------------------------------------------

/**
 * 在 Screen buffer 上应用选择高亮覆盖。
 * 使用 StylePool.withSelectionBg() 替换每个选中单元格的背景色。
 *
 * 在 diff 之前调用，使 diff 引擎将选择变化当作普通 cell 变化处理。
 */
export function applySelectionOverlay(
  screen: Screen,
  selection: SelectionState,
  stylePool: StylePool
): void {
  const b = selectionBounds(selection);
  if (!b) return;
  const { start, end } = b;
  const width = screen.cols;
  const noSelect = screen.noSelect;

  for (let row = start.row; row <= end.row && row < screen.rows; row++) {
    const colStart = row === start.row ? start.col : 0;
    const colEnd = row === end.row ? Math.min(end.col, width - 1) : width - 1;
    const rowOff = row * width;

    for (let col = colStart; col <= colEnd; col++) {
      const idx = rowOff + col;
      if (noSelect[idx] === 1) continue;
      const cell = screen.getCell(col, row);
      if (!cell) continue;
      const newStyleId = stylePool.withSelectionBg(cell.styleId);
      screen.setCellStyleId(col, row, newStyleId);
    }
  }
}
