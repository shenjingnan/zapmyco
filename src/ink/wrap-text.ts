/**
 * wrap-text — 文本换行 + 截断
 *
 * 根据 `textWrap` 类型对文本进行换行或截断。
 * 支持三种截断位置：start（开头）、middle（中间）、end（结尾）。
 *
 * 参考 claude-code src/ink/wrap-text.ts
 */

import { stringWidth } from './stringWidth';
import { wrapAnsi } from './wrapAnsi';

export type TextWrapType =
  | 'wrap'
  | 'wrap-trim'
  | 'truncate'
  | 'truncate-start'
  | 'truncate-middle'
  | 'truncate-end';

/**
 * 按可见宽度截断字符串。
 * 在截断位置插入 `...`（省略号），保留 ANSI 颜色完整性。
 */
function truncate(text: string, columns: number, position: 'start' | 'middle' | 'end'): string {
  if (columns <= 0) return '';
  if (text.length === 0) return text;

  const textWidth = stringWidth(text);
  if (textWidth <= columns) return text;

  const ellipsis = '\u2026';
  const ellipsisWidth = 1; // … 是单宽字符
  const targetWidth = columns - ellipsisWidth;

  if (targetWidth <= 0) return ellipsis;

  // 剥离 ANSI 用于宽度计算，但保留原始字符串用于切片
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC 是 ANSI 序列起始
  const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

  // 将字符串拆为字符数组（正确处理代理对）
  const chars = Array.from(text);

  if (position === 'end') {
    // 从头截断到最后
    let result = '';
    let currentWidth = 0;
    for (const char of chars) {
      if (ANSI_RE.test(char)) {
        result += char;
        continue;
      }
      const w = stringWidth(char);
      if (currentWidth + w > targetWidth) break;
      result += char;
      currentWidth += w;
    }
    return result + ellipsis;
  }

  if (position === 'start') {
    // 从后往前截断
    let result = '';
    let currentWidth = 0;
    for (let i = chars.length - 1; i >= 0; i--) {
      const char = chars[i] as string;
      if (ANSI_RE.test(char)) {
        result = char + result;
        continue;
      }
      const w = stringWidth(char);
      if (currentWidth + w > targetWidth) break;
      result = char + result;
      currentWidth += w;
    }
    return ellipsis + result;
  }

  // middle — 两边各保留一半
  const halfWidth = Math.floor(targetWidth / 2);
  const leftHalfWidth = halfWidth;
  const rightHalfWidth = targetWidth - halfWidth;

  let leftResult = '';
  let leftWidth = 0;
  let rightResult = '';
  let rightWidth = 0;
  let leftIdx = 0;
  let rightIdx = chars.length - 1;

  // 从左构建
  while (leftIdx <= rightIdx && leftWidth < leftHalfWidth) {
    const char = chars[leftIdx] as string;
    if (ANSI_RE.test(char)) {
      leftResult += char;
      leftIdx++;
      continue;
    }
    const w = stringWidth(char);
    if (leftWidth + w > leftHalfWidth) break;
    leftResult += char;
    leftWidth += w;
    leftIdx++;
  }

  // 从右构建
  while (rightIdx >= leftIdx && rightWidth < rightHalfWidth) {
    const char = chars[rightIdx] as string;
    if (ANSI_RE.test(char)) {
      rightResult = char + rightResult;
      rightIdx--;
      continue;
    }
    const w = stringWidth(char);
    if (rightWidth + w > rightHalfWidth) break;
    rightResult = char + rightResult;
    rightWidth += w;
    rightIdx--;
  }

  return leftResult + ellipsis + rightResult;
}

/**
 * 按指定的 textWrap 类型对文本进行换行或截断。
 *
 * @param text     - 输入文本
 * @param maxWidth - 最大宽度
 * @param wrapType - 换行类型
 * @returns 处理后的文本
 */
export function wrapText(text: string, maxWidth: number, wrapType: TextWrapType = 'wrap'): string {
  switch (wrapType) {
    case 'wrap': {
      return wrapAnsi(text, maxWidth, { trim: false, hard: true });
    }
    case 'wrap-trim': {
      return wrapAnsi(text, maxWidth, { trim: true, hard: true });
    }
    case 'truncate':
    case 'truncate-end': {
      return truncate(text, maxWidth, 'end');
    }
    case 'truncate-start': {
      return truncate(text, maxWidth, 'start');
    }
    case 'truncate-middle': {
      return truncate(text, maxWidth, 'middle');
    }
    default: {
      return text;
    }
  }
}
