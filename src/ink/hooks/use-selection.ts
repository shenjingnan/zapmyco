/**
 * useSelection — 文本选择操作 Hook
 *
 * 提供对 Ink 实例文本选择操作的 React 封装。
 * 作为纯函数导出，不依赖 React Context 注入 Ink 实例。
 * 通过 Ink 实例的 selection 字段直接操作选择状态。
 *
 * Hook 返回的方法：
 * - copySelection: 复制并清除选择
 * - copySelectionNoClear: 仅复制不清除
 * - clearSelection: 清除选择
 * - hasSelection: 检查是否有选择
 * - getState: 获取原始 SelectionState（用于拖拽滚动等）
 * - subscribe: 订阅选择变化
 */

import { useMemo, useSyncExternalStore } from 'react';
import type { FocusMove, SelectionState } from '../selection';

// ---------------------------------------------------------------------------
// InkInstance interface (duck typing for the Ink class)
// ---------------------------------------------------------------------------

export interface InkSelectionApi {
  readonly selection: SelectionState;
  copySelection: () => string;
  copySelectionNoClear: () => string;
  clearTextSelection: () => void;
  hasTextSelection: () => boolean;
  subscribeToSelectionChange: (cb: () => void) => () => void;
  shiftAnchor: (dRow: number, minRow: number, maxRow: number) => void;
  shiftSelectionForScroll: (dRow: number, minRow: number, maxRow: number) => void;
  moveSelectionFocus: (move: FocusMove) => void;
  captureScrolledRows: (firstRow: number, lastRow: number, side: 'above' | 'below') => void;
  setSelectionBgColor?: (color: string) => void;
}

// ---------------------------------------------------------------------------
// useSelection
// ---------------------------------------------------------------------------

/**
 * Hook: 访问 Ink 实例的文本选择操作。
 *
 * @param ink - Ink 实例（需要实现 InkSelectionApi 接口）
 * @returns 选择操作方法的对象
 */
export function useSelection(ink: InkSelectionApi | null): {
  copySelection: () => string;
  copySelectionNoClear: () => string;
  clearSelection: () => void;
  hasSelection: () => boolean;
  getState: () => SelectionState | null;
  subscribe: (cb: () => void) => () => void;
  shiftAnchor: (dRow: number, minRow: number, maxRow: number) => void;
  shiftSelection: (dRow: number, minRow: number, maxRow: number) => void;
  moveFocus: (move: FocusMove) => void;
  captureScrolledRows: (firstRow: number, lastRow: number, side: 'above' | 'below') => void;
  setSelectionBgColor: (color: string) => void;
} {
  return useMemo(() => {
    if (!ink) {
      return {
        copySelection: () => '',
        copySelectionNoClear: () => '',
        clearSelection: () => {},
        hasSelection: () => false,
        getState: () => null,
        subscribe: () => () => {},
        shiftAnchor: () => {},
        shiftSelection: () => {},
        moveFocus: () => {},
        captureScrolledRows: () => {},
        setSelectionBgColor: () => {},
      };
    }

    return {
      copySelection: () => ink.copySelection(),
      copySelectionNoClear: () => ink.copySelectionNoClear(),
      clearSelection: () => ink.clearTextSelection(),
      hasSelection: () => ink.hasTextSelection(),
      getState: () => ink.selection,
      subscribe: (cb: () => void) => ink.subscribeToSelectionChange(cb),
      shiftAnchor: (dRow: number, minRow: number, maxRow: number) =>
        ink.shiftAnchor(dRow, minRow, maxRow),
      shiftSelection: (dRow: number, minRow: number, maxRow: number) =>
        ink.shiftSelectionForScroll(dRow, minRow, maxRow),
      moveFocus: (move: FocusMove) => ink.moveSelectionFocus(move),
      captureScrolledRows: (firstRow: number, lastRow: number, side: 'above' | 'below') =>
        ink.captureScrolledRows(firstRow, lastRow, side),
      setSelectionBgColor: (color: string) => ink.setSelectionBgColor?.(color) ?? {},
    };
  }, [ink]);
}

// ---------------------------------------------------------------------------
// useHasSelection
// ---------------------------------------------------------------------------

const NO_SUBSCRIBE = () => () => {};
const ALWAYS_FALSE = () => false;

/**
 * Hook: 响应式选择存在状态。
 * 当选择创建或清除时重新渲染调用者。
 */
export function useHasSelection(ink: InkSelectionApi | null): boolean {
  return useSyncExternalStore(
    ink ? (cb: () => void) => ink.subscribeToSelectionChange(cb) : NO_SUBSCRIBE,
    ink ? () => ink.hasTextSelection() : ALWAYS_FALSE
  );
}
