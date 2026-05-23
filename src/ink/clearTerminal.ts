/**
 * clearTerminal — 跨平台清屏
 *
 * 根据终端环境生成正确的 ANSI 清屏序列。
 *
 * 参考 claude-code src/ink/clearTerminal.ts
 */

import { CURSOR_HOME, ERASE_SCREEN, ERASE_SCROLLBACK } from './termio/csi';

// ---------------------------------------------------------------------------
// 运行时终端检测
// ---------------------------------------------------------------------------

let _clearSequence: string | null = null;

/**
 * 获取适用于当前终端的清屏 ANSI 序列。
 *
 * 策略：
 * - 现代 Windows Terminal（WT_SESSION）：ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
 * - 传统 Windows：ERASE_SCREEN + HVP CURSOR_HOME
 * - Unix/macOS：ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
 */
function getClearTerminalSequence(): string {
  const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
  const hasWtSession = typeof process !== 'undefined' && Boolean(process.env.WT_SESSION);
  const hasConPty = typeof process !== 'undefined' && Boolean(process.env.CONPTY);
  const hasMintty = typeof process !== 'undefined' && Boolean(process.env.MINTTY);

  if (isWindows && !hasWtSession && !hasConPty && !hasMintty) {
    // 传统 Windows：HVP 方式
    return `${ERASE_SCREEN}\x1b[0f`; // CURSOR_HOME via HVP
  }

  return `${ERASE_SCREEN}${ERASE_SCROLLBACK}${CURSOR_HOME}`;
}

/**
 * 清屏 ANSI 序列（模块加载时计算一次）。
 */
export const clearTerminal: string = (() => {
  if (_clearSequence) return _clearSequence;
  _clearSequence = getClearTerminalSequence();
  return _clearSequence;
})();

/**
 * 重新检测终端并返回清屏序列（用于运行时终端环境变化）。
 */
export function getClearTerminal(): string {
  _clearSequence = getClearTerminalSequence();
  return _clearSequence;
}
