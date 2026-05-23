/**
 * log-update — Screen diff 引擎
 *
 * 比较前后两个 Frame 的 Screen 缓冲区，生成为最小终端补丁序列(Diff)。
 *
 * 核心算法基于 src/cli/tui/diff.ts 的 diffScreens()，
 * 适配 Frame/Diff 类型体系。
 *
 * 参考 claude-code src/ink/log-update.ts 的结构。
 */

import type { StylePool } from '@/cli/tui/style-pool';
import type { Diff, Frame, Patch } from './frame';
import { shouldClearScreen } from './frame';

// ---------------------------------------------------------------------------
// DECSTBM 硬件滚动检测
// ---------------------------------------------------------------------------

/**
 * 检测两帧在指定矩形区域内是否存在均匀位移（硬件滚动优化）。
 *
 * 当可滚动区域内容发生 uniform shift（流式追加），用 DECSTBM + SU/SD
 * 替代逐 cell 差异输出，减少传输量并提高终端渲染效率。
 *
 * @param prev  上一帧 Screen
 * @param next  当前帧 Screen
 * @param rect  可滚动区域（x, y, width, height）
 * @returns 检测到的 delta 值（正数=向下滚动），或 null（无均匀位移）
 */
export function detectDecstbmScroll(
  prev: import('./screen').Screen,
  next: import('./screen').Screen,
  rect: { x: number; y: number; width: number; height: number }
): number | null {
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
function checkUniformShift(
  prev: import('./screen').Screen,
  next: import('./screen').Screen,
  rect: { x: number; y: number; width: number; height: number },
  delta: number
): boolean {
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
  prev: import('./screen').Screen,
  next: import('./screen').Screen,
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

// ---------------------------------------------------------------------------
// LogUpdate
// ---------------------------------------------------------------------------

export class LogUpdate {
  private stylePool: StylePool;

  constructor(stylePool: StylePool) {
    this.stylePool = stylePool;
  }

  /**
   * 比较 prev 和 next 两帧，生成差异补丁序列。
   *
   * @param prev  上一帧（null 表示首次渲染）
   * @param next  当前帧
   * @returns Diff 补丁序列
   */
  render(prev: Frame | null, next: Frame): Diff {
    const patches: Patch[] = [];

    // 检查是否需要清屏
    if (prev) {
      const clearReason = shouldClearScreen(prev, next);
      if (clearReason) {
        patches.push({ type: 'clearTerminal', reason: clearReason });
        prev = null; // 清屏后相当于首次渲染
      }
    }

    // DECSTBM 硬件滚动：当 scrollHint 存在时发射滚动序列并同步缓冲区
    if (prev && next.scrollHint && next.scrollHint.delta !== 0) {
      const { top, bottom, delta } = next.scrollHint;
      // 1-based for terminal CSI sequences
      patches.push({ type: 'setScrollRegion', top: top + 1, bottom: bottom + 1 });
      patches.push(
        delta > 0 ? { type: 'scrollUp', count: delta } : { type: 'scrollDown', count: -delta }
      );
      patches.push({ type: 'resetScrollRegion' });

      // 同步 prevScreen 缓冲区，使后续 diff 仅发现边缘行差异
      prev.screen.shiftRows(top, bottom, delta);
    }

    const prevScreen = prev?.screen ?? null;
    const nextScreen = next.screen;

    if (prevScreen === null) {
      // 首次渲染：全帧输出
      this._renderFullFrame(nextScreen, patches);
      return patches;
    }

    // 后续渲染：逐行比较
    this._renderDiff(prevScreen, nextScreen, patches);

    // 光标定位
    patches.push({
      type: 'cursorMove',
      x: next.cursor.x,
      y: next.cursor.y,
    });

    return patches;
  }

  /** 全帧渲染 */
  private _renderFullFrame(screen: import('./screen').Screen, patches: Patch[]): void {
    const rows = screen.rows;
    const cols = screen.cols;

    for (let r = 0; r < rows; r++) {
      // 收集该行的所有 segments
      const segments = this._buildRowSegments(screen, r, 0, cols);
      if (segments.length === 0) {
        // 空行
        if (r === 0) {
          patches.push({ type: 'cursorMove', x: 0, y: 0 });
        } else {
          patches.push({ type: 'cursorMove', x: 0, y: r });
        }
        patches.push({ type: 'clear', count: 1 });
        continue;
      }

      // 移动光标到行首
      patches.push({ type: 'cursorMove', x: 0, y: r });

      // 写入每个 segment
      for (const seg of segments) {
        if (seg.styleTransition) {
          patches.push({ type: 'styleStr', str: seg.styleTransition });
        }
        patches.push({ type: 'stdout', content: seg.text });
      }

      // 清行尾
      patches.push({ type: 'clear', count: 1 });
    }
  }

  /** 增量 diff 渲染 */
  private _renderDiff(
    prev: import('./screen').Screen,
    next: import('./screen').Screen,
    patches: Patch[]
  ): void {
    const rows = Math.min(next.rows, prev.rows);
    const cols = next.cols;

    for (let r = 0; r < rows; r++) {
      if (r >= prev.rows) {
        // 新行
        this._renderFullRow(next, r, patches);
        continue;
      }

      const changes = this._findChangedRanges(prev, next, r, cols);
      if (changes === null) continue; // 无变化

      if (changes.fullLine) {
        // 整行变化
        this._renderFullRow(next, r, patches);
        continue;
      }

      // 部分变化
      let lineCleared = false;
      for (const range of changes.ranges) {
        // 移动光标到变化区间起点
        patches.push({ type: 'cursorMove', x: range.colStart, y: r });

        const segments = this._buildRowSegments(next, r, range.colStart, range.colEnd);
        for (const seg of segments) {
          if (seg.styleTransition) {
            patches.push({ type: 'styleStr', str: seg.styleTransition });
          }
          patches.push({ type: 'stdout', content: seg.text });
        }

        // 如果变化区间延伸到行尾
        if (range.colEnd >= cols) {
          lineCleared = true;
          patches.push({ type: 'clear', count: 1 });
        }
      }

      // prev 行比 next 行长 → 清行尾
      const prevLen = this._countNonEmptyCells(prev, r, cols);
      const nextLen = this._countNonEmptyCells(next, r, cols);
      if (prevLen > nextLen && !lineCleared && nextLen > 0) {
        patches.push({ type: 'cursorMove', x: nextLen, y: r });
        patches.push({ type: 'clear', count: 1 });
      }
    }

    // prev 比 next 行数多 → 清多余行
    if (prev.rows > next.rows) {
      patches.push({ type: 'cursorMove', x: 0, y: next.rows });
      for (let r = next.rows; r < prev.rows; r++) {
        patches.push({ type: 'clear', count: 1 });
        if (r < prev.rows - 1) {
          patches.push({ type: 'stdout', content: '\n' });
        }
      }
    }
  }

  /** 渲染整行 */
  private _renderFullRow(screen: import('./screen').Screen, row: number, patches: Patch[]): void {
    const cols = screen.cols;
    const segments = this._buildRowSegments(screen, row, 0, cols);
    if (segments.length === 0 || segments.every((s) => s.text === '')) {
      patches.push({ type: 'clear', count: 1 });
      return;
    }

    patches.push({ type: 'cursorMove', x: 0, y: row });
    for (const seg of segments) {
      if (seg.styleTransition) {
        patches.push({ type: 'styleStr', str: seg.styleTransition });
      }
      patches.push({ type: 'stdout', content: seg.text });
    }
    patches.push({ type: 'clear', count: 1 });
  }

  // ---------------------------------------------------------------------------
  // Segment 构建
  // ---------------------------------------------------------------------------

  private _buildRowSegments(
    screen: import('./screen').Screen,
    row: number,
    colStart: number,
    colEnd: number
  ): Array<{ text: string; styleTransition: string | null }> {
    const segments: Array<{ text: string; styleTransition: string | null }> = [];
    let currentText = '';
    let currentStyle = -1;
    let firstStyle = -1;

    const maxCol = Math.min(colEnd, screen.cols);

    for (let c = colStart; c < maxCol; c++) {
      const cell = screen.getCell(c, row);
      // 跳过 spacer tail（宽字符第二格）
      if (cell.width === 2 && cell.char === '') continue;

      if (currentStyle === -1) {
        currentStyle = cell.styleId;
        firstStyle = cell.styleId;
        currentText = cell.char;
      } else if (cell.styleId !== currentStyle) {
        segments.push({
          text: currentText,
          styleTransition: this._transitionStyle(currentStyle, cell.styleId),
        });
        currentStyle = cell.styleId;
        currentText = cell.char;
      } else {
        currentText += cell.char;
      }
    }

    if (currentStyle !== -1) {
      // 从默认 style 到第一个 style 的过渡
      segments.unshift({
        text: '',
        styleTransition: this._transitionStyle(0, firstStyle),
      });
      segments.push({ text: currentText, styleTransition: null });
    }

    return segments;
  }

  // ---------------------------------------------------------------------------
  // Diff 辅助
  // ---------------------------------------------------------------------------

  private _findChangedRanges(
    prev: import('./screen').Screen,
    next: import('./screen').Screen,
    row: number,
    cols: number
  ): { fullLine: boolean; ranges: Array<{ colStart: number; colEnd: number }> } | null {
    if (row >= prev.rows) {
      return { fullLine: true, ranges: [{ colStart: 0, colEnd: cols }] };
    }

    const ranges: Array<{ colStart: number; colEnd: number }> = [];
    let inChange = false;
    let rangeStart = 0;
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
        }
      } else {
        if (inChange) {
          // 跳过 spacer tail
          if (c > 0 && nextCell.width === 2 && nextCell.char === '') {
            continue;
          }
          ranges.push({ colStart: rangeStart, colEnd: c });
          inChange = false;
        }
      }
    }

    if (inChange) {
      ranges.push({ colStart: rangeStart, colEnd: cols });
    }

    if (anyEmpty && ranges.length === 0) return null;
    if (ranges.length === 0) return null;

    if (ranges.length === 1 && ranges[0]?.colStart === 0 && ranges[0]?.colEnd >= cols) {
      return { fullLine: true, ranges };
    }

    return { fullLine: false, ranges };
  }

  private _countNonEmptyCells(
    screen: import('./screen').Screen,
    row: number,
    cols: number
  ): number {
    let count = 0;
    for (let c = 0; c < cols; c++) {
      const cell = screen.getCell(c, row);
      if (cell.char !== '' && !(cell.width === 2 && cell.char === '')) {
        count++;
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Style transition
  // ---------------------------------------------------------------------------

  private _transitionStyle(fromId: number, toId: number): string {
    if (fromId === toId) return '';

    // 尝试使用 StylePool
    try {
      return this.stylePool.transition(fromId, toId);
    } catch {
      // fallback to inline style
      if (toId === 0) return '\x1b[0m';
      return '\x1b[0m'; // default reset
    }
  }
}
