import { describe, expect, it } from 'vitest';
import type { CredentialEntry } from '@/llm/credential-pool';
import { CredentialPool } from '@/llm/credential-pool';

function makeEntries(count: number, prefix = 'key-'): CredentialEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    apiKey: `${prefix}${i + 1}`,
    label: `key-${i + 1}`,
    priority: 1,
  }));
}

describe('CredentialPool', () => {
  describe('round-robin 策略', () => {
    it('should return keys in round-robin order', () => {
      const pool = new CredentialPool('test', makeEntries(3), { strategy: 'round-robin' });
      expect(pool.getKey()).toBe('key-1');
      expect(pool.getKey()).toBe('key-2');
      expect(pool.getKey()).toBe('key-3');
      expect(pool.getKey()).toBe('key-1');
    });

    it('should skip disabled keys', () => {
      const pool = new CredentialPool('test', [
        { apiKey: 'key-1', label: 'a', priority: 1 },
        { apiKey: 'key-2', label: 'b', priority: 1, enabled: false },
        { apiKey: 'key-3', label: 'c', priority: 1 },
      ]);

      // key-2 is disabled, should be skipped
      expect(pool.getKey()).toBe('key-1');
      expect(pool.getKey()).toBe('key-3');
      expect(pool.getKey()).toBe('key-1');
    });
  });

  describe('random 策略', () => {
    it('should return a valid key', () => {
      const pool = new CredentialPool('test', makeEntries(5), { strategy: 'random' });
      const key = pool.getKey();
      expect(key).toBeDefined();
      expect(['key-1', 'key-2', 'key-3', 'key-4', 'key-5']).toContain(key);
    });
  });

  describe('priority-first 策略', () => {
    it('should prefer lower priority numbers', () => {
      const pool = new CredentialPool(
        'test',
        [
          { apiKey: 'high-1', label: 'h1', priority: 1 },
          { apiKey: 'high-2', label: 'h2', priority: 1 },
          { apiKey: 'low-1', label: 'l1', priority: 2 },
        ],
        { strategy: 'priority-first' }
      );

      // Should get high priority keys first
      const key1 = pool.getKey();
      const key2 = pool.getKey();
      expect(key1).toMatch(/^high-/);
      expect(key2).toMatch(/^high-/);
    });
  });

  describe('故障标记与恢复', () => {
    it('should mark key as failed without disabling immediately', () => {
      const entries = makeEntries(2);
      const pool = new CredentialPool('test', entries, { maxConsecutiveFailures: 3 });

      pool.markFailed('key-1');
      // After 1 failure, key should still be available
      expect(pool.getKey()).toBe('key-1');
    });

    it('should disable key after consecutive failures', () => {
      const entries = makeEntries(2);
      const pool = new CredentialPool('test', entries, { maxConsecutiveFailures: 2 });

      pool.markFailed('key-1');
      pool.markFailed('key-1');
      // After 2 consecutive failures, key-1 should be disabled
      const key = pool.getKey();
      expect(key).toBe('key-2');
    });

    it('should reset consecutive failures on success', () => {
      const entries = makeEntries(2);
      const pool = new CredentialPool('test', entries, { maxConsecutiveFailures: 2 });

      pool.markFailed('key-1');
      pool.markSuccess('key-1');
      pool.markFailed('key-1');
      // Only 1 consecutive failure after reset, should still be available
      expect(pool.getKey()).toBe('key-1');
    });

    it('should recover after recoveryMs', () => {
      const entries = makeEntries(2);
      const pool = new CredentialPool('test', entries, {
        recoveryMs: 10,
        maxConsecutiveFailures: 2,
      });

      pool.markFailed('key-1');
      pool.markFailed('key-1');
      // key-1 should be disabled now
      expect(pool.getKey()).toBe('key-2');

      // Wait for recovery
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // After recovery, key-1 should be available again
          const key = pool.getKey();
          expect(key).toBe('key-1');
          resolve();
        }, 20);
      });
    });
  });

  describe('统计信息', () => {
    it('should return correct stats', () => {
      // enabled=false 在构造函数中被过滤，所以 total 不含 disabled entries
      const pool = new CredentialPool('test', [
        { apiKey: 'key-1', label: 'a' },
        { apiKey: 'key-2', label: 'b', enabled: false },
      ]);

      const stats = pool.getStats();
      expect(stats.provider).toBe('test');
      expect(stats.total).toBe(1); // enabled=false 被过滤
      expect(stats.active).toBe(1);
      expect(stats.disabled).toBe(0); // 构造后无运行期禁用
    });

    it('should track disabled count for runtime-disabled keys', () => {
      const pool = new CredentialPool('test', makeEntries(2), { maxConsecutiveFailures: 2 });

      pool.markFailed('key-1');
      pool.markFailed('key-1');
      // key-1 is runtime-disabled now
      const stats = pool.getStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(1);
      expect(stats.disabled).toBe(1);
    });
  });

  describe('withKey', () => {
    it('should execute with a valid key and auto-manage concurrency', async () => {
      const pool = new CredentialPool('test', makeEntries(2));
      let capturedKey: string | undefined;

      const result = await pool.withKey(async (key) => {
        capturedKey = key;
        return 'done';
      });

      expect(result).toBe('done');
      expect(capturedKey).toBeDefined();
    });

    it('should mark success on completion', () => {
      const pool = new CredentialPool('test', makeEntries(1), { maxConsecutiveFailures: 2 });
      // get the key
      const key = pool.getKey();
      expect(key).toBeDefined();
      if (!key) return;
      // Directly test success marking
      pool.markFailed(key);
      pool.markSuccess(key);
      pool.markFailed(key);
      // Should still be available (only 1 consecutive after reset)
      expect(pool.getKey()).toBe(key);
    });

    it('should throw when no keys available', async () => {
      const pool = new CredentialPool('test', [{ apiKey: 'key-1', enabled: false }]);

      await expect(pool.withKey(async () => 'done')).rejects.toThrow('没有可用的 Key');
    });
  });

  describe('reset', () => {
    it('should reset all key states', () => {
      const entries = makeEntries(2);
      const pool = new CredentialPool('test', entries, { maxConsecutiveFailures: 2 });

      pool.markFailed('key-1');
      pool.markFailed('key-1');
      // key-1 disabled
      expect(pool.getKey()).toBe('key-2');

      pool.reset();
      // After reset, key-1 should be available again
      expect(pool.getKey()).toBe('key-1');
    });
  });

  describe('rate limit handling', () => {
    it('should immediately disable key on rate limit error', () => {
      const entries = makeEntries(2);
      const pool = new CredentialPool('test', entries, { maxConsecutiveFailures: 5 });

      pool.markFailed('key-1', new Error('429 Too Many Requests'));
      // key-1 should be immediately disabled
      expect(pool.getKey()).toBe('key-2');
    });
  });

  describe('empty pool', () => {
    it('should return undefined when all keys are disabled', () => {
      const pool = new CredentialPool('test', [{ apiKey: 'key-1', enabled: false }]);
      expect(pool.getKey()).toBeUndefined();
    });
  });
});
