import { describe, expect, it } from 'vitest';
import { aggregateResults, buildTeamSummary } from '@/core/agent-team/agent-result-aggregator';
import type { WorkerResult } from '@/core/agent-team/types';

function makeResult(
  overrides: Partial<WorkerResult> & { tokenUsage?: WorkerResult['tokenUsage'] } = {}
): WorkerResult {
  const result: WorkerResult = {
    instanceId: overrides.instanceId ?? 'w-1',
    typeId: overrides.typeId ?? 'researcher',
    taskDescription: overrides.taskDescription ?? 'test task',
    status: overrides.status ?? 'success',
    output: overrides.output ?? 'task output',
    artifacts: overrides.artifacts ?? [],
    duration: overrides.duration ?? 1000,
    tokenUsage: overrides.tokenUsage ?? {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      estimatedCostUsd: 0,
    },
  };
  if (overrides.error !== undefined) {
    result.error = overrides.error;
  }
  return result;
}

describe('agent-result-aggregator', () => {
  describe('aggregateResults', () => {
    it('should aggregate successful results', () => {
      const results = [
        makeResult({ instanceId: 'w-1', typeId: 'researcher' }),
        makeResult({ instanceId: 'w-2', typeId: 'coder' }),
      ];

      const teamResult = aggregateResults('team-1', results);

      expect(teamResult.teamId).toBe('team-1');
      expect(teamResult.stats.total).toBe(2);
      expect(teamResult.stats.succeeded).toBe(2);
      expect(teamResult.stats.failed).toBe(0);
      expect(teamResult.totalDuration).toBe(2000);
      expect(teamResult.totalTokenUsage.inputTokens).toBe(200);
      expect(teamResult.totalTokenUsage.outputTokens).toBe(100);
      expect(teamResult.totalTokenUsage.totalTokens).toBe(300);
    });

    it('should handle empty results', () => {
      const teamResult = aggregateResults('team-empty', []);

      expect(teamResult.stats.total).toBe(0);
      expect(teamResult.stats.succeeded).toBe(0);
      expect(teamResult.stats.failed).toBe(0);
      expect(teamResult.totalDuration).toBe(0);
    });

    it('should handle mixed success and failure', () => {
      const results = [
        makeResult({ instanceId: 'w-1', status: 'success' }),
        makeResult({
          instanceId: 'w-2',
          status: 'failure',
          error: { code: 'ERR', message: 'failed', retryable: false },
        }),
        makeResult({ instanceId: 'w-3', status: 'partial' }),
      ];

      const teamResult = aggregateResults('team-2', results);

      expect(teamResult.stats.succeeded).toBe(1);
      expect(teamResult.stats.failed).toBe(2);
    });

    it('should handle all failures', () => {
      const results = [
        makeResult({
          instanceId: 'w-1',
          status: 'failure',
          error: { code: 'ERR', message: 'fail', retryable: false },
        }),
        makeResult({
          instanceId: 'w-2',
          status: 'failure',
          error: { code: 'ERR', message: 'fail', retryable: false },
        }),
      ];

      const teamResult = aggregateResults('team-3', results);

      expect(teamResult.stats.succeeded).toBe(0);
      expect(teamResult.stats.failed).toBe(2);
    });

    it('should sum token usage correctly', () => {
      const results = [
        makeResult({
          tokenUsage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            estimatedCostUsd: 0.001,
          },
        }),
        makeResult({
          tokenUsage: {
            inputTokens: 40,
            outputTokens: 50,
            totalTokens: 90,
            estimatedCostUsd: 0.002,
          },
        }),
      ];

      const teamResult = aggregateResults('team-4', results);

      expect(teamResult.totalTokenUsage.inputTokens).toBe(50);
      expect(teamResult.totalTokenUsage.outputTokens).toBe(70);
      expect(teamResult.totalTokenUsage.totalTokens).toBe(120);
      expect(teamResult.totalTokenUsage.estimatedCostUsd).toBe(0.003);
    });

    it('should handle zero token usage', () => {
      const result = makeResult({
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        },
      });

      const teamResult = aggregateResults('team-5', [result]);

      expect(teamResult.totalTokenUsage.inputTokens).toBe(0);
      expect(teamResult.totalTokenUsage.outputTokens).toBe(0);
    });
  });

  describe('buildTeamSummary', () => {
    it('should return placeholder for empty results', () => {
      const summary = buildTeamSummary([]);
      expect(summary).toContain('无 Worker 结果');
    });

    it('should include success and failure counts', () => {
      const results = [
        makeResult({ instanceId: 'w-1', status: 'success', output: 'output 1' }),
        makeResult({
          instanceId: 'w-2',
          status: 'failure',
          output: null,
          error: { code: 'ERR', message: 'failed', retryable: false },
        }),
      ];

      const summary = buildTeamSummary(results);
      expect(summary).toContain('1 成功');
      expect(summary).toContain('1 失败');
    });

    it('should include success worker output in detail section', () => {
      const results = [
        makeResult({ instanceId: 'w-1', status: 'success', output: 'detailed output' }),
      ];

      const summary = buildTeamSummary(results);
      expect(summary).toContain('detailed output');
    });
  });
});
