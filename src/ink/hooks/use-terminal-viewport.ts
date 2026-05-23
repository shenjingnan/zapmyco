/**
 * useTerminalViewport — 视口检测 hook
 *
 * 检测组件是否在终端视口内。
 * 返回值通过 ref 更新（不触发重渲染），调用者在自己的渲染周期读取最新值。
 *
 * 参考 claude-code src/ink/hooks/use-terminal-viewport.ts
 */

import { useCallback, useContext, useLayoutEffect, useRef } from 'react';
import { TerminalSizeContext } from '../components/TerminalSizeContext';
import type { DOMElement } from '../dom';

type ViewportEntry = {
  /** 元素当前是否在终端视口内 */
  isVisible: boolean;
};

/**
 * Hook 检测组件是否在终端视口内。
 *
 * @returns [ref, entry] — ref 附加到目标组件，entry 包含 isVisible 状态
 */
export function useTerminalViewport(): [
  ref: (element: DOMElement | null) => void,
  entry: ViewportEntry,
] {
  const terminalSize = useContext(TerminalSizeContext);
  const elementRef = useRef<DOMElement | null>(null);
  const entryRef = useRef<ViewportEntry>({ isVisible: true });

  const setElement = useCallback((el: DOMElement | null) => {
    elementRef.current = el;
  }, []);

  // 每次渲染后运行（yoga 布局值可能在不通知 React 的情况下变化）
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element?.yogaNode || !terminalSize) return;

    const height = element.yogaNode.getComputedHeight();
    const rows = terminalSize.rows;

    // 遍历 DOM 父链（不是 yoga.getParent()）以检测滚动容器
    let absoluteTop = element.yogaNode.getComputedTop();
    let parent: DOMElement | undefined = element.parentNode;
    let root = element.yogaNode;

    while (parent) {
      if (parent.yogaNode) {
        absoluteTop += parent.yogaNode.getComputedTop();
        root = parent.yogaNode;
      }
      if (parent.scrollTop) absoluteTop -= parent.scrollTop;
      parent = parent.parentNode;
    }

    const screenHeight = root.getComputedHeight();
    const bottom = absoluteTop + height;

    // 当内容溢出视口时，光标恢复会多滚动一行
    const cursorRestoreScroll = screenHeight > rows ? 1 : 0;
    const viewportY = Math.max(0, screenHeight - rows) + cursorRestoreScroll;
    const viewportBottom = viewportY + rows;
    const visible = bottom > viewportY && absoluteTop < viewportBottom;

    if (visible !== entryRef.current.isVisible) {
      entryRef.current = { isVisible: visible };
    }
  });

  return [setElement, entryRef.current];
}
