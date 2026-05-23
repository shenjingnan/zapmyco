/**
 * useTerminalFocus — 终端焦点 hook
 *
 * 使用 DECSET 1004 焦点报告检测终端窗口是否获得焦点。
 * 终端失去焦点时返回 false（可用于暂停动画等优化）。
 *
 * @returns true 如果终端窗口有焦点（或焦点状态未知）
 */

import { useContext } from 'react';
import TerminalFocusContext from '../components/TerminalFocusContext';

/**
 * 检测终端窗口是否获得焦点。
 *
 * @example
 * const focused = useTerminalFocus();
 * // 失去焦点时暂停动画
 * const animate = useAnimationFrame(cb, { enabled: focused });
 */
export function useTerminalFocus(): boolean {
  const { isTerminalFocused } = useContext(TerminalFocusContext);
  return isTerminalFocused;
}
