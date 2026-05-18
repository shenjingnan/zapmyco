/**
 * Agent 工具调用分组处理器测试
 */

import { describe, expect, it } from 'vitest';
import {
  buildToolCallGroups,
  countHiddenToolUses,
} from '@/core/agent-team/agent-progress-processor';
import type { AgentToolCallRecord } from '@/core/agent-team/types';

function makeRecord(
  toolName: string,
  status: 'running' | 'completed' | 'failed' = 'completed'
): AgentToolCallRecord {
  return {
    toolName,
    status,
    startedAt: Date.now(),
  };
}

function makeRecordWithArgs(
  toolName: string,
  argsDisplay: string,
  status: 'running' | 'completed' | 'failed' = 'completed'
): AgentToolCallRecord {
  return {
    toolName,
    argsDisplay,
    status,
    startedAt: Date.now(),
  };
}

describe('buildToolCallGroups', () => {
  it('空数组应返回空分组', () => {
    const groups = buildToolCallGroups([]);
    expect(groups).toEqual([]);
  });

  it('单个工具调用应返回独立分组', () => {
    const records = [makeRecord('ReadFile')];
    const groups = buildToolCallGroups(records);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(1);
    expect(groups[0]?.label).toBe('Read');
  });

  it('多个相同连续调用应合并为一个分组', () => {
    const records = [makeRecord('ReadFile'), makeRecord('ReadFile'), makeRecord('ReadFile')];
    const groups = buildToolCallGroups(records);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(3);
    expect(groups[0]?.label).toBe('Read');
  });

  it('不同分类的调用不应合并', () => {
    const records = [makeRecord('ReadFile'), makeRecord('Grep')];
    const groups = buildToolCallGroups(records);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBe('Read');
    expect(groups[0]?.count).toBe(1);
    expect(groups[1]?.label).toBe('Search');
    expect(groups[1]?.count).toBe(1);
  });

  it('连续相同然后切换分类的分组应正确', () => {
    const records = [
      makeRecord('ReadFile'),
      makeRecord('ReadFile'),
      makeRecord('Exec'),
      makeRecord('Exec'),
      makeRecord('Exec'),
    ];
    const groups = buildToolCallGroups(records);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBe('Read');
    expect(groups[0]?.count).toBe(2);
    expect(groups[1]?.label).toBe('Exec');
    expect(groups[1]?.count).toBe(3);
  });

  it('交替分类不应合并', () => {
    const records = [
      makeRecord('ReadFile'),
      makeRecord('Grep'),
      makeRecord('ReadFile'),
      makeRecord('Grep'),
    ];
    const groups = buildToolCallGroups(records);
    expect(groups).toHaveLength(4);
  });

  it('单次调用不应被分组（< 阈值）', () => {
    const records = [makeRecord('ReadFile')];
    const groups = buildToolCallGroups(records);
    // 单个 ReadFile 应为独立分组（count=1），标签为 Read
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(1);
  });

  it('分组应保留 argsDisplay', () => {
    const records = [
      makeRecordWithArgs('ReadFile', 'src/foo.ts'),
      makeRecordWithArgs('ReadFile', 'src/bar.ts'),
    ];
    const groups = buildToolCallGroups(records);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.calls[0]?.argsDisplay).toBe('src/foo.ts');
    expect(groups[0]?.calls[1]?.argsDisplay).toBe('src/bar.ts');
  });
});

describe('countHiddenToolUses', () => {
  it('分组数不超过上限时不应隐藏', () => {
    const records = [makeRecord('ReadFile'), makeRecord('Grep')];
    const groups = buildToolCallGroups(records);
    const result = countHiddenToolUses(groups, 5);
    expect(result.visibleGroups).toHaveLength(2);
    expect(result.hiddenCount).toBe(0);
  });

  it('分组数超过上限时应正确计算隐藏数', () => {
    const records = [
      makeRecord('ReadFile'),
      makeRecord('ReadFile'),
      makeRecord('ReadFile'),
      makeRecord('Grep'),
      makeRecord('Grep'),
      makeRecord('Exec'),
    ];
    const groups = buildToolCallGroups(records);
    // 分组结果：[Read×3, Search×2, Exec×1] = 3 个分组
    const result = countHiddenToolUses(groups, 2);
    expect(result.visibleGroups).toHaveLength(2); // Show groups: Read×3, Search×2
    expect(result.hiddenCount).toBe(1); // Hidden: Exec×1
  });

  it('上限为 0 时应全部隐藏', () => {
    const records = [makeRecord('ReadFile'), makeRecord('Exec')];
    const groups = buildToolCallGroups(records);
    const result = countHiddenToolUses(groups, 0);
    expect(result.visibleGroups).toHaveLength(0);
    expect(result.hiddenCount).toBe(2);
  });
});
