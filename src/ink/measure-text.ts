/**
 * measure-text — 单次遍历同时测量宽度和高度
 *
 * 在单次迭代中同时计算文本的显示宽度和换行后的高度。
 * 避免 split 分配数组，使用 indexOf 遍历。
 *
 * 参考 claude-code src/ink/measure-text.ts
 */

import { lineWidth } from './line-width-cache';

export interface MeasureResult {
  /** 最宽行的宽度 */
  width: number;
  /** 换行后的总行数 */
  height: number;
}

/**
 * 测量文本在指定最大宽度下的尺寸。
 *
 * @param text     - 输入文本
 * @param maxWidth - 最大行宽（<= 0 或 Infinity 时不换行）
 * @returns `{ width, height }`
 */
export function measureText(text: string, maxWidth: number): MeasureResult {
  if (text.length === 0) {
    return { width: 0, height: 1 }; // 空字符串计为一行
  }

  let maxW = 0;
  let height = 0;
  let start = 0;

  // 不需要换行的情况
  const noWrap = maxWidth <= 0 || !Number.isFinite(maxWidth) || Number.isNaN(maxWidth);

  while (start < text.length) {
    const idx = text.indexOf('\n', start);
    if (idx === -1) {
      // 最后一行
      const line = text.slice(start);
      const w = lineWidth(line);
      maxW = Math.max(maxW, w);
      height += noWrap ? 1 : w === 0 ? 1 : Math.ceil(w / maxWidth);
      break;
    }
    const line = text.slice(start, idx);
    const w = lineWidth(line);
    maxW = Math.max(maxW, w);

    height += noWrap ? 1 : w === 0 ? 1 : Math.ceil(w / maxWidth);

    start = idx + 1;
  }

  return { width: maxW, height };
}
