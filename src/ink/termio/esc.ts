/**
 * ESC 序列解析器
 *
 * 解析 ESC + 字符序列（2 字节序列）。
 * 产生语义动作：光标保存/恢复、重置、移动等。
 */

import type { Action } from './types.js';

/**
 * 解析 ESC 序列（不含 ESC 本身）。
 * chars 为 ESC 后的字符。
 *
 * @returns Action | null（null 表示该序列被静默忽略）
 */
export function parseEsc(chars: string): Action | null {
  switch (chars) {
    case 'c':
      // RIS — 重置为初始状态
      return { type: 'reset' };

    case '7':
      // DECSC — 保存光标位置
      return { type: 'cursor', action: { type: 'save' } };

    case '8':
      // DECRC — 恢复光标位置
      return { type: 'cursor', action: { type: 'restore' } };

    case 'D':
      // IND — 索引（光标下移一行）
      return {
        type: 'cursor',
        action: { type: 'move', direction: 'down', n: 1 },
      };

    case 'M':
      // RI — 反向索引（光标上移一行）
      return {
        type: 'cursor',
        action: { type: 'move', direction: 'up', n: 1 },
      };

    case 'E':
      // NEL — 下一行（光标移到下一行行首）
      return { type: 'cursor', action: { type: 'nextLine', n: 1 } };

    case 'H':
      // HTS — 设置制表位（现代终端很少使用，忽略）
      return null;

    default:
      // 字符集选择（`(` 或 `)` 后跟一个字符）：静默忽略
      if (chars.length === 2 && (chars[0] === '(' || chars[0] === ')')) {
        return null;
      }
      // 未识别的 ESC 序列
      return { type: 'unknown', sequence: `\x1b${chars}` };
  }
}
