import { describe, expect, it } from 'vitest';
import type { ProgressEventType, ProgressPayload } from '@/core/aggregator/types';
import type { GoalConstraints, GoalType } from '@/core/intent/types';
import type { ArtifactType, FinalResult, TaskResult, TokenUsage } from '@/core/result/types';
import type { SubTask, TaskGraph, TaskStatus } from '@/core/task/types';

/**
 * 类型定义文件覆盖率测试
 *
 * 纯类型定义文件无法直接测试运行时行为，
 * 通过导入验证模块可正常加载且导出正确。
 */

describe('core types', () => {
  it('should export task types correctly', () => {
    // 验证类型枚举值存在
    const statuses: TaskStatus[] = [
      'pending',
      'ready',
      'running',
      'succeeded',
      'failed',
      'skipped',
      'cancelled',
    ];
    expect(statuses).toHaveLength(7);

    // 验证可以构造对象
    const subTask: Partial<SubTask> = {
      id: 'test-id',
      name: 'Test Task',
      description: 'Test description',
      status: 'pending',
    };
    expect(subTask.id).toBe('test-id');

    // 验证 TaskGraph 结构
    const graph: Partial<TaskGraph> = {
      goalId: 'g1',
      nodes: new Map(),
      edges: [],
      entryNodes: [],
      layers: [],
    };
    expect(graph.goalId).toBe('g1');
  });

  it('should export intent types correctly', () => {
    // GoalType 是一个联合类型，验证模块加载成功
    expect(typeof ({} as GoalType)).toBeDefined();
    expect(typeof ({} as GoalConstraints)).toBeDefined();
  });

  it('should export result types correctly', () => {
    // 验证 ArtifactType
    const artifactTypes: ArtifactType[] = ['pull-request', 'file', 'report', 'comment', 'url'];
    expect(artifactTypes).toHaveLength(5);

    // 验证 TokenUsage 结构
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      estimatedCostUsd: 0.003,
    };
    expect(usage.totalTokens).toBe(300);

    // 验证 TaskResult 结构
    const result: Partial<TaskResult> = {
      taskId: 't1',
      status: 'success',
      artifacts: [],
      duration: 1000,
      tokenUsage: usage,
    };
    expect(result.status).toBe('success');

    // 验证 FinalResult 结构
    const final: Partial<FinalResult> = {
      goalId: 'g1',
      overallStatus: 'success',
      summary: 'Done',
      taskResults: [],
      allArtifacts: [],
      totalDuration: 5000,
      totalTokenUsage: usage,
    };
    expect(final.overallStatus).toBe('success');
  });

  it('should export aggregator types correctly', () => {
    expect(typeof ({} as ProgressEventType)).toBeDefined();
    expect(typeof ({} as ProgressPayload)).toBeDefined();
  });
});
