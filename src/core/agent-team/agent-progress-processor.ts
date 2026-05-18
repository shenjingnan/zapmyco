/**
 * Agent 工具调用分组处理器
 *
 * 将扁平的工具调用记录按分类合为展示分组，
 * 类似 claude-code 的 processProgressMessages()。
 *
 * @module core/agent-team
 */

import { categorizeTool } from './agent-tool-categorizer';
import type { AgentToolCallGroup, AgentToolCallRecord } from './types';

/**
 * 连续相同分类调用的最小分组阈值。
 * >= 2 时合并为分组（如 "Read 3 files"），
 * 否则保持独立条目（如 "ReadFile: src/foo.ts"）。
 */
const GROUP_THRESHOLD = 2;

/**
 * 将扁平的工具调用记录处理为展示分组
 *
 * @param records - 工具调用记录列表
 * @returns 有序的展示分组
 */
export function buildToolCallGroups(records: AgentToolCallRecord[]): AgentToolCallGroup[] {
  const groups: AgentToolCallGroup[] = [];

  let i = 0;
  while (i < records.length) {
    const record = records[i];
    if (!record) {
      i++;
      continue;
    }

    const { category, label } = categorizeTool(record.toolName);

    // 统计连续相同分类的调用次数
    let j = i + 1;
    while (j < records.length) {
      const next = records[j];
      if (!next) break;
      const nextCat = categorizeTool(next.toolName);
      if (nextCat.category !== category) break;
      j++;
    }

    const count = j - i;
    const batch = records.slice(i, j);

    if (count >= GROUP_THRESHOLD) {
      // 合并为分组
      groups.push({
        category,
        label,
        calls: batch,
        count,
        startTime: batch[0]?.startedAt ?? 0,
        endTime: batch[batch.length - 1]?.endedAt,
      });
    } else {
      // 保持独立条目
      for (const r of batch) {
        groups.push({
          category,
          label,
          calls: [r],
          count: 1,
          startTime: r.startedAt,
          endTime: r.endedAt,
        });
      }
    }

    i = j;
  }

  return groups;
}

/**
 * 计算超过可见上限的隐藏工具调用数
 *
 * @param groups - 展示分组列表
 * @param maxVisibleGroups - 最大可见分组数
 * @returns 可见分组和隐藏计数
 */
export function countHiddenToolUses(
  groups: AgentToolCallGroup[],
  maxVisibleGroups: number
): { visibleGroups: AgentToolCallGroup[]; hiddenCount: number } {
  if (groups.length <= maxVisibleGroups) {
    return { visibleGroups: groups, hiddenCount: 0 };
  }

  const visible = groups.slice(0, maxVisibleGroups);
  const hidden = groups.slice(maxVisibleGroups);
  const hiddenCount = hidden.reduce((sum, g) => sum + g.count, 0);

  return { visibleGroups: visible, hiddenCount };
}
