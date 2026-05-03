import { describe, expect, it } from 'vitest';
import type { SubAgentConfig } from '@/config/types';
import type { SubAgentResultEntry } from '@/core/sub-agent/types';

describe('SubAgentManager', () => {
  describe('SubAgentConfig defaults', () => {
    it('should have sensible default values', () => {
      const config: SubAgentConfig = {
        enabled: true,
        maxConcurrent: 5,
        taskTimeoutMs: 300_000,
        maxOutputChars: 5000,
        maxTurns: 30,
        allowRecursiveSpawn: false,
      };

      expect(config.enabled).toBe(true);
      expect(config.maxConcurrent).toBeGreaterThan(0);
      expect(config.taskTimeoutMs).toBeGreaterThan(0);
      expect(config.maxOutputChars).toBeGreaterThan(0);
      expect(config.maxTurns).toBeGreaterThan(0);
      expect(config.allowRecursiveSpawn).toBe(false);
    });
  });

  describe('SubAgentResultEntry structure', () => {
    it('should have required fields for success', () => {
      const entry: SubAgentResultEntry = {
        specId: 'task-1',
        status: 'success',
        output: 'Result text',
        duration: 1234,
      };

      expect(entry.specId).toBe('task-1');
      expect(entry.status).toBe('success');
      expect(entry.output).toBe('Result text');
      expect(entry.duration).toBeGreaterThan(0);
    });

    it('should have error field for failure', () => {
      const entry: SubAgentResultEntry = {
        specId: 'task-1',
        status: 'failure',
        output: null,
        error: 'Something went wrong',
        duration: 567,
      };

      expect(entry.status).toBe('failure');
      expect(entry.output).toBeNull();
      expect(entry.error).toBe('Something went wrong');
    });
  });

  describe('result filtering helpers', () => {
    it('should correctly identify success entries', () => {
      const results: SubAgentResultEntry[] = [
        { specId: 'a', status: 'success', output: 'ok', duration: 100 },
        { specId: 'b', status: 'failure', output: null, error: 'err', duration: 200 },
        { specId: 'c', status: 'success', output: 'ok2', duration: 300 },
      ];

      const succeeded = results.filter((r) => r.status === 'success');
      const failed = results.filter((r) => r.status === 'failure');

      expect(succeeded).toHaveLength(2);
      expect(failed).toHaveLength(1);
    });
  });
});
