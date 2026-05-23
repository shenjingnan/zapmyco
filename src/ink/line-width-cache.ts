/**
 * line-width-cache — 行宽缓存
 *
 * 缓存字符串宽度计算结果，避免频繁调用 stringWidth。
 * 在流式输出场景下减少 ~50x 的 stringWidth 调用（文本增长但已有行不变）。
 *
 * 参考 claude-code src/ink/line-width-cache.ts
 */

import { stringWidth } from './stringWidth';

const MAX_CACHE_SIZE = 4096;
const cache = new Map<string, number>();

/**
 * 获取字符串的显示宽度（带缓存）。
 * 缓存满时整体清空（简单策略，一行帧内可重新填充）。
 */
export function lineWidth(text: string): number {
  const cached = cache.get(text);
  if (cached !== undefined) return cached;

  const width = stringWidth(text);

  if (cache.size >= MAX_CACHE_SIZE) {
    cache.clear();
  }
  cache.set(text, width);

  return width;
}

/**
 * 清空宽度缓存（用于测试或内存回收）。
 */
export function clearLineWidthCache(): void {
  cache.clear();
}
