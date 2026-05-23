/**
 * render-to-screen — 离屏渲染 + 搜索扫描
 *
 * 将 React 元素渲染到独立的 Screen buffer 上，用于搜索高亮。
 * 扫描 Screen buffer 返回匹配位置。
 *
 * 参考 claude-code src/ink/render-to-screen.ts
 */

import type { ReactElement } from 'react';
import { createNode, type DOMElement } from './dom';
import { FocusManager } from './focus';
import { Output } from './output';
import reconciler from './reconciler';
import { renderNodeToOutput } from './render-node-to-output';
import { Screen } from './screen';
import { withCurrentMatch } from './style-cache';

/**
 * 匹配位置（相对于消息的边界框，row 0 = 消息顶部）。
 */
export type MatchPosition = {
  row: number;
  col: number;
  /** 匹配占用的 CELL 数 */
  len: number;
};

// 跨调用共享的持久化资源
let root: DOMElement | undefined;
let container: ReturnType<typeof reconciler.createContainer> | undefined;
let output: Output | undefined;

const noop = () => {};

// 性能计时
const timing = { reconcile: 0, yoga: 0, paint: 0, scan: 0, calls: 0 };
const LOG_EVERY = 20;

/**
 * 将 React 元素渲染到独立的 Screen buffer。
 * 用于搜索：渲染一条消息，扫描 Screen 查找查询。
 *
 * @param el    - React 元素（调用方负责包装所有 Context）
 * @param width - 渲染宽度
 * @returns Screen buffer 和自然高度
 */
export function renderToScreen(
  el: ReactElement,
  width: number
): { screen: Screen; height: number } {
  if (!root) {
    root = createNode('ink-root');
    root.focusManager = new FocusManager();
    // biome-ignore lint/suspicious/noExplicitAny: reconciler internal API
    container = (reconciler as any).createContainer(
      root,
      0, // LegacyRoot
      null,
      false,
      null,
      'search-render',
      noop,
      noop,
      noop,
      noop
    );
  }

  const t0 = performance.now();

  // biome-ignore lint/suspicious/noExplicitAny: reconciler internal API
  (reconciler as any).updateContainerSync(el, container, null, noop);
  try {
    // biome-ignore lint/suspicious/noExplicitAny: reconciler internal API
    (reconciler as any).flushSyncWork?.();
  } catch {
    // 某些 reconciler 版本可能没有 flushSyncWork
  }
  const t1 = performance.now();

  // Yoga 布局
  root.yogaNode?.setWidth(width);
  root.yogaNode?.calculateLayout(width);
  const height = Math.ceil(root.yogaNode?.getComputedHeight() ?? 0);
  const t2 = performance.now();

  // 绘制到 Screen
  const screen = new Screen(Math.max(1, height), width);
  if (!output) {
    output = new Output({ width, height });
    output.reset(width, height, screen);
  } else {
    output.reset(width, height, screen);
  }
  // biome-ignore lint/suspicious/noExplicitAny: RenderOptions type with exactOptionalPropertyTypes
  renderNodeToOutput(root, output, {} as any);
  const rendered = output.get();
  const t3 = performance.now();

  // 卸载以便下次调用获得新树
  // biome-ignore lint/suspicious/noExplicitAny: reconciler internal API
  (reconciler as any).updateContainerSync(null, container, null, noop);
  try {
    // biome-ignore lint/suspicious/noExplicitAny: reconciler internal API
    (reconciler as any).flushSyncWork?.();
  } catch {
    // noop
  }

  timing.reconcile += t1 - t0;
  timing.yoga += t2 - t1;
  timing.paint += t3 - t2;
  if (++timing.calls % LOG_EVERY === 0) {
    const total = timing.reconcile + timing.yoga + timing.paint + timing.scan;
    console.warn(
      `renderToScreen: ${timing.calls} calls · ` +
        `reconcile=${timing.reconcile.toFixed(1)}ms yoga=${timing.yoga.toFixed(1)}ms ` +
        `paint=${timing.paint.toFixed(1)}ms scan=${timing.scan.toFixed(1)}ms · ` +
        `total=${total.toFixed(1)}ms · avg ${(total / timing.calls).toFixed(2)}ms/call`
    );
  }

  return { screen: rendered, height };
}

/**
 * 扫描 Screen buffer 查找所有查询匹配。
 * 返回相对于 buffer 的位置（row 0 = buffer 顶部）。
 * 大小写不敏感。
 */
export function scanPositions(screen: Screen, query: string): MatchPosition[] {
  const lq = query.toLowerCase();
  if (!lq) return [];
  const qlen = lq.length;
  const w = screen.cols;
  const h = screen.rows;
  const positions: MatchPosition[] = [];

  const t0 = performance.now();
  for (let row = 0; row < h; row++) {
    let text = '';
    const colOf: number[] = [];
    const codeUnitToCell: number[] = [];

    for (let col = 0; col < w; col++) {
      const cell = screen.getCell(col, row);
      if (!cell) continue;
      const lc = cell.char.toLowerCase();
      const cellIdx = colOf.length;
      for (let i = 0; i < lc.length; i++) {
        codeUnitToCell.push(cellIdx);
      }
      text += lc;
      colOf.push(col);
    }

    let pos = text.indexOf(lq);
    while (pos >= 0) {
      const startCi = codeUnitToCell[pos]!;
      const endCi = codeUnitToCell[pos + qlen - 1]!;
      const col = colOf[startCi]!;
      const endCol = colOf[endCi]! + 1;
      positions.push({ row, col, len: endCol - col });
      pos = text.indexOf(lq, pos + qlen);
    }
  }
  timing.scan += performance.now() - t0;

  return positions;
}

/**
 * 在 Screen 上应用"当前匹配"高亮（黄色+加粗+下划线）。
 * positions 是消息相对坐标，rowOffset 是消息的屏幕行偏移。
 */
export function applyPositionedHighlight(
  screen: Screen,
  positions: MatchPosition[],
  rowOffset: number,
  currentIdx: number
): boolean {
  if (currentIdx < 0 || currentIdx >= positions.length) return false;
  const p = positions[currentIdx]!;
  const row = p.row + rowOffset;
  if (row < 0 || row >= screen.rows) return false;

  for (let col = p.col; col < p.col + p.len; col++) {
    if (col < 0 || col >= screen.cols) continue;
    const cell = screen.getCell(col, row);
    if (!cell) continue;
    const newStyleId = withCurrentMatch(cell.styleId);
    screen.setCellStyleId(col, row, newStyleId);
  }
  return true;
}
