/**
 * diff — Screen 差异引擎
 *
 * 比较前后两个 Screen 缓冲区，生成为最小终端补丁序列。
 *
 * 核心算法：
 * 1. 逐行扫描两帧的每个单元格
 * 2. 跳过完全相同的行
 * 3. 对变化行找出连续变化区间，生成 move + style + write 补丁
 * 4. 合并相邻的相同类型补丁，最小化输出长度
 *
 * 参考 claude-code 的 log-update.ts diffEach 算法，简化实现。
 */

import type { Screen } from './screen';
import type { StylePool } from './style-pool';
import type { Rect } from './types';

// ---------------------------------------------------------------------------
// 补丁类型
// ---------------------------------------------------------------------------

export type Patch =
  /** 移动光标到 (x, y)，0-based */
  | { type: 'move'; x: number; y: number }
  /** 写入文本 */
  | { type: 'write'; text: string }
  /** 清空一行（count > 1 表示多行） */
  | { type: 'clearLine'; y: number; count?: number }
  /** 应用样式转换序列 */
  | { type: 'style'; style: string };

export interface DiffResult {
  patches: Patch[];
  stats: {
    changedCells: number;
    totalCells: number;
    changedRows: number;
  };
}

// ---------------------------------------------------------------------------
// 差异算法
// ---------------------------------------------------------------------------

/**
 * 比较 prev 和 next 两个 Screen，生成差异补丁。
 *
 * @param prev  上一帧（null 表示首次渲染）
 * @param next  当前帧
 * @param stylePool 样式池（用于 style transition 缓存）
 * @returns 补丁序列
 */
export function diffScreens(prev: Screen | null, next: Screen, stylePool: StylePool): DiffResult {
  const patches: Patch[] = [];
  const rows = next.rows;
  const cols = next.cols;
  let changedCells = 0;
  let changedRows = 0;

  if (prev === null) {
    // 首次渲染：每个非空行生成完整补丁
    for (let r = 0; r < rows; r++) {
      const lineText = buildLineText(next, r, cols);
      if (lineText === null) continue; // 空行

      patches.push({ type: 'move', x: 0, y: r });
      // 先 reset style，再逐行渲染
      patches.push({ type: 'style', style: stylePool.transition(0, 0) });
      patches.push({ type: 'write', text: lineText });
      patches.push({ type: 'clearLine', y: r });
      changedCells += countNonEmptyCells(next, r, cols);
      changedRows++;
    }
    return { patches, stats: { changedCells, totalCells: rows * cols, changedRows } };
  }

  // 非首帧：逐行比较
  for (let r = 0; r < rows; r++) {
    if (r >= prev.rows) {
      // 新行：直接写入
      const lineText = buildLineText(next, r, cols);
      if (lineText === null) continue;

      patches.push({ type: 'move', x: 0, y: r });
      patches.push({ type: 'style', style: stylePool.transition(0, 0) });
      patches.push({ type: 'write', text: lineText });
      continue;
    }

    // 检查整行是否变化
    const changed = findChangedRanges(prev, next, r, cols);

    if (changed === null) {
      // 行无变化：跳过上一行的尾部 clear（如果 prev 行更长）
      continue;
    }

    if (changed.fullLine) {
      // 整行变化：直接 write 整行
      const lineText = buildLineText(next, r, cols);
      if (lineText === null) {
        // 行为空 → clearLine
        patches.push({ type: 'clearLine', y: r });
      } else {
        patches.push({ type: 'move', x: 0, y: r });
        patches.push({ type: 'style', style: stylePool.transition(0, 0) });
        patches.push({ type: 'write', text: lineText });
        patches.push({ type: 'clearLine', y: r });
      }
      changedRows++;
      changedCells += countNonEmptyCells(next, r, cols);
      continue;
    }

    // 部分变化：分段写入
    // 先清行尾（如果 prev 比 next 长或行尾有残余）
    let lineCleared = false;

    for (const range of changed.ranges) {
      if (range.colStart >= cols) break;

      changedCells += range.changedCount;

      // 移动光标到变化区间起点
      patches.push({ type: 'move', x: range.colStart, y: r });

      // 写入变化区间的文本，并跟踪 style 变化
      const segments = buildSegmentText(next, r, range.colStart, range.colEnd, stylePool);
      for (const seg of segments) {
        if (seg.styleTransition) {
          patches.push({ type: 'style', style: seg.styleTransition });
        }
        if (seg.text) {
          patches.push({ type: 'write', text: seg.text });
        }
      }

      // 如果变化区间延伸到行尾，不需要 clearLine
      if (range.colEnd >= cols) {
        lineCleared = true;
        patches.push({ type: 'clearLine', y: r });
      }
    }

    // 如果 prev 行比 next 行长且未清除过 → 清行尾
    const prevLineLen = countNonEmptyCells(prev, r, cols);
    const nextLineLen = countNonEmptyCells(next, r, cols);
    if (prevLineLen > nextLineLen && !lineCleared && nextLineLen > 0) {
      patches.push({ type: 'move', x: nextLineLen, y: r });
      patches.push({ type: 'clearLine', y: r });
    }
  }

  // 如果 prev 比 next 行数多，清空剩余行
  if (prev && prev.rows > rows) {
    const emptyLines = prev.rows - rows;
    patches.push({ type: 'clearLine', y: rows, count: emptyLines });
  }

  return { patches, stats: { changedCells, totalCells: rows * cols, changedRows } };
}

// ---------------------------------------------------------------------------
// 内部辅助类型
// ---------------------------------------------------------------------------

interface ChangedRange {
  colStart: number;
  colEnd: number;
  changedCount: number;
}

interface CellChange {
  /** true = 整行变化 */
  fullLine: boolean;
  /** 变化区间列表 */
  ranges: ChangedRange[];
}

// ---------------------------------------------------------------------------
// 内部辅助函数
// ---------------------------------------------------------------------------

/**
 * 找出某行中发生变化的连续区间。
 * 返回 null 表示无变化；返回 { fullLine: true } 表示整行变化；
 * 否则返回变化区间列表。
 */
function findChangedRanges(
  prev: Screen,
  next: Screen,
  row: number,
  cols: number
): CellChange | null {
  if (row >= prev.rows) {
    return { fullLine: true, ranges: [{ colStart: 0, colEnd: cols, changedCount: cols }] };
  }

  const ranges: ChangedRange[] = [];
  let inChange = false;
  let rangeStart = 0;
  let rangeChangedCount = 0;
  let anyEmpty = true;

  for (let c = 0; c < cols; c++) {
    const prevCell = prev.getCell(c, row);
    const nextCell = next.getCell(c, row);

    const changed =
      prevCell.char !== nextCell.char ||
      prevCell.styleId !== nextCell.styleId ||
      prevCell.width !== nextCell.width;

    if (nextCell.char !== '') anyEmpty = false;

    if (changed) {
      if (!inChange) {
        inChange = true;
        rangeStart = c;
        rangeChangedCount = 1;
      } else {
        rangeChangedCount++;
      }
    } else {
      if (inChange) {
        // 检查是否刚跳过了一个 spacer tail（宽字符第二格）
        // 若变化区间以 spacer tail 结束，扩大区间到包含它
        if (c > 0 && nextCell.width === 2 && nextCell.char === '') {
          rangeChangedCount++;
        } else {
          ranges.push({ colStart: rangeStart, colEnd: c, changedCount: rangeChangedCount });
          inChange = false;
        }
      }
    }
  }

  if (inChange) {
    ranges.push({ colStart: rangeStart, colEnd: cols, changedCount: rangeChangedCount });
  }

  // 如果全为空行且无变化 → null
  if (anyEmpty && ranges.length === 0) return null;

  // 如果无变化区间 → null
  if (ranges.length === 0) return null;

  // 如果整行只有 1 个变化区间且覆盖整行 → fullLine
  if (ranges.length === 1) {
    // biome-ignore lint/style/noNonNullAssertion: length check ensures element exists
    const r = ranges[0]!;
    if (r.colStart === 0 && r.colEnd >= cols) {
      return { fullLine: true, ranges };
    }
  }

  return { fullLine: false, ranges };
}

/** 行文本分段，含样式转换 */
interface TextSegment {
  text: string;
  styleTransition: string | null;
}

/**
 * 为某行的某一区间构建分段文本。
 * 每个样式变化处切分为新 segment。
 */
function buildSegmentText(
  screen: Screen,
  row: number,
  colStart: number,
  colEnd: number,
  stylePool: StylePool
): TextSegment[] {
  const segments: TextSegment[] = [];
  let currentText = '';
  let currentStyle = -1; // -1 = uninitialized
  let initialized = false;

  const maxCol = Math.min(colEnd, screen.cols);

  for (let c = colStart; c < maxCol; c++) {
    const cell = screen.getCell(c, row);
    if (cell.width === 2 && cell.char === '') {
      // spacer tail: 跳过
      continue;
    }

    if (!initialized) {
      currentStyle = cell.styleId;
      currentText = cell.char;
      initialized = true;
      continue;
    }

    if (cell.styleId !== currentStyle) {
      // flush current segment
      segments.push({
        text: currentText,
        styleTransition: stylePool.transition(
          currentStyle === -1 ? 0 : currentStyle,
          currentStyle === -1 ? cell.styleId : currentStyle
        ),
      });
      currentStyle = cell.styleId;
      currentText = cell.char;
    } else {
      currentText += cell.char;
    }
  }

  // flush last segment
  if (initialized) {
    segments.push({
      text: currentText,
      styleTransition: null, // 调用方在区间前已做 style transition
    });
  }

  return segments;
}

/**
 * 构建一行的完整文本（用于 fullLine 写入）。
 * 空行返回 null。
 */
function buildLineText(screen: Screen, row: number, cols: number): string | null {
  let text = '';
  let hasContent = false;

  for (let c = 0; c < cols; c++) {
    const cell = screen.getCell(c, row);
    if (cell.char === '') continue;
    if (cell.width === 2 && cell.char === '') continue; // spacer tail
    text += cell.char;
    hasContent = true;
  }

  return hasContent ? text : null;
}

/**
 * 统计一行中非空单元格数。
 */
function countNonEmptyCells(screen: Screen, row: number, cols: number): number {
  let count = 0;
  for (let c = 0; c < cols; c++) {
    const cell = screen.getCell(c, row);
    if (cell.char !== '' && !(cell.width === 2 && cell.char === '')) {
      // 跳过 spacer tail
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// DECSTBM 硬件滚动检测 — PR 6
// ---------------------------------------------------------------------------

/**
 * 检测两帧之间可滚动区域是否存在均匀位移（流式追加内容场景）。
 *
 * 算法：在重叠区域内采样前/中/后三行，逐 cell 比较。
 * 如果 sample 行的全部 cell 在两帧间以指定偏移量匹配，则判定发生了 uniform shift。
 *
 * 仅在流式输出追加内容时触发（followBottom=true），
 * 用户主动滚动（PageUp/鼠标滚轮）时内容非均匀变化，检测会返回 null。
 *
 * @param prev  上一帧（不可为 null，调用方保证）
 * @param next  当前帧
 * @param rect  可滚动区域（即 OutputArea 的渲染矩形）
 * @returns delta 值（正数 = 向上滚动），或 null（无优化机会）
 */
export function detectDecstbmScroll(prev: Screen, next: Screen, rect: Rect): number | null {
  const { y, height } = rect;

  // 最小高度检查
  if (height < 2) return null;

  // 边界检查：两帧都必须能容纳该矩形
  if (prev.rows < y + height || next.rows < y + height) return null;

  // 尝试最常见的 delta 值（流式输出一般每次追加 1~3 个显示行）
  const MAX_DELTA = Math.min(3, height - 1);

  for (let delta = 1; delta <= MAX_DELTA; delta++) {
    if (checkUniformShift(prev, next, rect, delta)) {
      return delta;
    }
  }

  return null;
}

/**
 * 检查指定 delta 是否构成 uniform shift。
 * next.row[y + i] 应与 prev.row[y + i + delta] 匹配（对所有在重叠区内的 i）。
 * 采样 3 行（首、中、尾）加速检查。
 */
function checkUniformShift(prev: Screen, next: Screen, rect: Rect, delta: number): boolean {
  const { y, x, width, height } = rect;
  const overlapCount = height - delta;
  if (overlapCount <= 0) return false;

  // 采样索引：首行、1/3处、2/3处（保证覆盖面）
  const sampleIndices = [
    0,
    Math.floor(overlapCount / 3),
    Math.floor((overlapCount * 2) / 3),
    overlapCount - 1,
  ];
  // 去重
  const uniqueIndices = [...new Set(sampleIndices)].filter((i) => i >= 0 && i < overlapCount);

  for (const si of uniqueIndices) {
    const prevRow = y + si + delta;
    const nextRow = y + si;
    if (!rowsMatch(prev, next, prevRow, nextRow, x, width)) {
      return false;
    }
  }

  return true;
}

/**
 * 比较两帧中指定行的指定列范围是否完全相同。
 */
function rowsMatch(
  prev: Screen,
  next: Screen,
  prevRow: number,
  nextRow: number,
  x: number,
  width: number
): boolean {
  for (let c = x; c < x + width; c++) {
    const pc = prev.getCell(c, prevRow);
    const nc = next.getCell(c, nextRow);
    if (pc.char !== nc.char || pc.styleId !== nc.styleId) {
      return false;
    }
  }
  return true;
}
