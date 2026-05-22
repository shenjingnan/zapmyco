/**
 * optimizer — Diff 补丁优化器
 *
 * 对 diff 引擎输出的补丁序列进行优化，减少终端输出的字节数。
 *
 * 优化规则：
 * 1. 移除空的 stdout 补丁
 * 2. 合并相邻的 cursorMove 补丁
 * 3. 移除 no-op cursorMove (0,0)
 * 4. 合并相邻的 styleStr 补丁
 * 5. 取消相邻的 cursorHide/cursorShow 对
 * 6. 移除 count=0 的 clear 补丁
 *
 * 参考 claude-code src/ink/optimizer.ts
 */

import type { Diff } from './frame';

export function optimize(diff: Diff): Diff {
  if (diff.length <= 1) return diff;

  const result: Diff = [];
  let len = 0;

  for (const patch of diff) {
    // Skip no-ops
    if (patch.type === 'stdout' && patch.content === '') continue;
    if (patch.type === 'cursorMove' && patch.x === 0 && patch.y === 0) continue;
    if (patch.type === 'clear' && patch.count === 0) continue;

    // Try to merge with previous patch
    if (len > 0) {
      const last = result[len - 1]!;

      // Merge consecutive cursorMove
      if (patch.type === 'cursorMove' && last.type === 'cursorMove') {
        result[len - 1] = {
          type: 'cursorMove',
          x: last.x + patch.x,
          y: last.y + patch.y,
        };
        continue;
      }

      // Collapse consecutive cursorTo (only last matters)
      if (patch.type === 'cursorTo' && last.type === 'cursorTo') {
        result[len - 1] = patch;
        continue;
      }

      // Merge adjacent styleStr
      if (patch.type === 'styleStr' && last.type === 'styleStr') {
        result[len - 1] = { type: 'styleStr', str: last.str + patch.str };
        continue;
      }

      // Cancel cursor hide/show pair
      if (
        (patch.type === 'cursorShow' && last.type === 'cursorHide') ||
        (patch.type === 'cursorHide' && last.type === 'cursorShow')
      ) {
        result.pop();
        len--;
        continue;
      }
    }

    result.push(patch);
    len++;
  }

  return result;
}
