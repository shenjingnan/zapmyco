/**
 * widest-line — 字符串中最宽行的宽度
 *
 * 遍历所有行（`\n` 分隔），返回最大宽度。
 * 使用 indexOf 遍历而非 split 分配数组。
 *
 * 参考 claude-code src/ink/widest-line.ts
 */

import { lineWidth } from './line-width-cache';

/**
 * 返回字符串中最宽行的显示宽度。
 *
 * @param text - 输入文本
 * @returns 最宽行的宽度
 */
export function widestLine(text: string): number {
  let max = 0;
  let start = 0;

  while (true) {
    const idx = text.indexOf('\n', start);
    if (idx === -1) break;

    const line = text.slice(start, idx);
    max = Math.max(max, lineWidth(line));
    start = idx + 1;
  }

  // 最后一行（无换行结尾）
  if (start < text.length || text.endsWith('\n')) {
    const line = start < text.length ? text.slice(start) : '';
    max = Math.max(max, lineWidth(line));
  } else if (text.length === 0) {
    return 0;
  }

  return max;
}
