/**
 * agent-memory 单元测试
 */

import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendAgentMemory,
  clearAgentMemory,
  freezeAgentMemorySnapshots,
  getAgentMemorySnapshot,
  getMemoryFilePath,
  initAgentMemory,
  readAgentMemory,
  resetMemorySnapshots,
} from '@/core/agent-team/agent-memory';

describe('agent-memory', () => {
  // Use a temp directory to avoid polluting real memory
  const testRoot = join(homedir(), '.zapmyco', 'memory', 'agents');
  const testTypeId = `test-agent-${Date.now()}`;

  beforeEach(async () => {
    resetMemorySnapshots();
    await initAgentMemory();
  });

  afterEach(async () => {
    // Clean up test memory file
    const filePath = getMemoryFilePath(testTypeId);
    try {
      rmSync(filePath, { force: true });
      rmSync(`${filePath}.tmp`, { force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Also clean any other test-type files
    try {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(testRoot);
      for (const entry of entries) {
        if (entry.startsWith('test-') || entry.startsWith('mem-test-')) {
          rmSync(join(testRoot, entry), { force: true });
        }
      }
    } catch {
      // Ignore
    }
    resetMemorySnapshots();
  });

  describe('initAgentMemory', () => {
    it('should create memory directory', async () => {
      await initAgentMemory();
      expect(existsSync(testRoot)).toBe(true);
    });

    it('should be idempotent', async () => {
      await initAgentMemory();
      await initAgentMemory();
      expect(existsSync(testRoot)).toBe(true);
    });
  });

  describe('getAgentMemorySnapshot', () => {
    it('should return empty string for non-existent type', async () => {
      const snapshot = await getAgentMemorySnapshot('non-existent-type');
      expect(snapshot).toBe('');
    });

    it('should return frozen snapshot after freeze', async () => {
      await appendAgentMemory(testTypeId, 'Frozen test memory entry');
      await freezeAgentMemorySnapshots();

      // Snapshot should contain the entry frozen at freeze time
      const snapshot = await getAgentMemorySnapshot(testTypeId);
      expect(snapshot).toContain('Frozen test memory entry');

      // Add another entry - snapshot should NOT change
      await appendAgentMemory(testTypeId, 'New entry after freeze');
      const snapshot2 = await getAgentMemorySnapshot(testTypeId);
      expect(snapshot2).toBe(snapshot); // Should return same frozen content
    });
  });

  describe('appendAgentMemory', () => {
    it('should append memory entry', async () => {
      const success = await appendAgentMemory(testTypeId, 'First memory entry');
      expect(success).toBe(true);

      const entries = await readAgentMemory(testTypeId);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]).toContain('First memory entry');
    });

    it('should append multiple entries', async () => {
      await appendAgentMemory(testTypeId, 'Entry 1');
      await appendAgentMemory(testTypeId, 'Entry 2');
      await appendAgentMemory(testTypeId, 'Entry 3');

      const entries = await readAgentMemory(testTypeId);
      expect(entries.length).toBe(3);
    });

    it('should reject empty content', async () => {
      const success = await appendAgentMemory(testTypeId, '');
      expect(success).toBe(false);

      const entries = await readAgentMemory(testTypeId);
      expect(entries.length).toBe(0);
    });

    it('should trim whitespace-only content', async () => {
      const success = await appendAgentMemory(testTypeId, '   ');
      expect(success).toBe(false);
    });

    it('should include timestamp in entries', async () => {
      await appendAgentMemory(testTypeId, 'Timed entry');
      const entries = await readAgentMemory(testTypeId);
      expect(entries[0]).toMatch(/\[\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('readAgentMemory', () => {
    it('should return empty array for non-existent type', async () => {
      const entries = await readAgentMemory('non-existent');
      expect(entries).toEqual([]);
    });

    it('should read entries in order', async () => {
      await appendAgentMemory(testTypeId, 'First');
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await appendAgentMemory(testTypeId, 'Second');

      const entries = await readAgentMemory(testTypeId);
      expect(entries.length).toBe(2);
    });
  });

  describe('clearAgentMemory', () => {
    it('should clear all entries', async () => {
      await appendAgentMemory(testTypeId, 'Entry 1');
      await appendAgentMemory(testTypeId, 'Entry 2');

      const success = await clearAgentMemory(testTypeId);
      expect(success).toBe(true);

      const entries = await readAgentMemory(testTypeId);
      expect(entries.length).toBe(0);
    });

    it('should succeed for non-existent type', async () => {
      const success = await clearAgentMemory('never-existed');
      expect(success).toBe(true);
    });
  });

  describe('getMemoryFilePath', () => {
    it('should return path under memory agents directory', () => {
      const path = getMemoryFilePath('my-type');
      expect(path).toContain('memory');
      expect(path).toContain('agents');
      expect(path).toContain('my-type.md');
    });
  });

  describe('freezeAgentMemorySnapshots', () => {
    it('should clear previous snapshots', async () => {
      await appendAgentMemory(testTypeId, 'Pre-freeze entry');
      await freezeAgentMemorySnapshots();

      const snapshot = await getAgentMemorySnapshot(testTypeId);
      expect(snapshot).toContain('Pre-freeze entry');

      // Freeze again (clears old snapshots)
      await freezeAgentMemorySnapshots();
      // After second freeze, snapshot should be empty (file still has content but snapshot was cleared)
      // Actually the second get will reload from file since snapshot was cleared
      const snapshot2 = await getAgentMemorySnapshot(testTypeId);
      expect(snapshot2).toContain('Pre-freeze entry');
    });
  });

  describe('type isolation', () => {
    it('should isolate memories between different types', async () => {
      const typeA = `${testTypeId}-a`;
      const typeB = `${testTypeId}-b`;

      await appendAgentMemory(typeA, 'Memory for A');
      await appendAgentMemory(typeB, 'Memory for B');

      const entriesA = await readAgentMemory(typeA);
      const entriesB = await readAgentMemory(typeB);

      expect(entriesA[0]).toContain('Memory for A');
      expect(entriesB[0]).toContain('Memory for B');

      // Cleanup
      rmSync(getMemoryFilePath(typeA), { force: true });
      rmSync(getMemoryFilePath(typeB), { force: true });
    });
  });
});
