/**
 * useTerminalSize — 终端尺寸 hook
 *
 * 提供终端当前的 columns 和 rows。当终端尺寸变化时自动更新。
 */

import { useContext } from 'react';
import { type TerminalSize, TerminalSizeContext } from '../components/TerminalSizeContext';

/**
 * 获取当前终端尺寸。
 *
 * @returns { columns, rows } 终端列数和行数
 *
 * @example
 * const { columns, rows } = useTerminalSize();
 */
export function useTerminalSize(): TerminalSize {
  const size = useContext(TerminalSizeContext);

  // 默认值（当上下文不可用时）
  return size ?? { columns: 80, rows: 24 };
}
