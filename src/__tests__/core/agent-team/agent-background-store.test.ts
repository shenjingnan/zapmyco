import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackgroundTaskEntry } from '@/core/agent-team/agent-background-store';
import { BackgroundTaskStore } from '@/core/agent-team/agent-background-store';

function makeEntry(overrides: Partial<BackgroundTaskEntry> = {}): BackgroundTaskEntry {
  return {
    taskId: overrides.taskId ?? 'task-1',
    instanceId: overrides.instanceId ?? 'inst-1',
    typeId: overrides.typeId ?? 'general-purpose',
    description: overrides.description ?? 'test task',
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  };
}

describe('BackgroundTaskStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-bg-store-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create store with custom cwd', () => {
      const store = new BackgroundTaskStore(tmpDir);
      expect(store.storagePath).toContain('.zapmyco');
      expect(store.storagePath).toContain('background-tasks');
      expect(store.storagePath.endsWith('.json')).toBe(true);
    });

    it('should create parent directory if not exists', () => {
      new BackgroundTaskStore(tmpDir);
      const dir = join(require('node:os').homedir(), '.zapmyco', 'background-tasks');
      // 目录应该已创建（可能之前就存在，所以只验证不抛错）
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe('storagePath', () => {
    it('should return file path', () => {
      const store = new BackgroundTaskStore(tmpDir);
      expect(store.storagePath).toBeDefined();
      expect(typeof store.storagePath).toBe('string');
    });
  });

  describe('save and get', () => {
    it('should save and retrieve an entry', () => {
      const store = new BackgroundTaskStore(tmpDir);
      const entry = makeEntry();
      store.save(entry);

      const retrieved = store.get('task-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.taskId).toBe('task-1');
      expect(retrieved?.typeId).toBe('general-purpose');
      expect(retrieved?.status).toBe('pending');
    });

    it('should return undefined for non-existent entry', () => {
      const store = new BackgroundTaskStore(tmpDir);
      expect(store.get('non-existent')).toBeUndefined();
    });

    it('should overwrite existing entry on save', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1', status: 'pending' }));
      store.save(makeEntry({ taskId: 'task-1', status: 'running' }));

      expect(store.get('task-1')?.status).toBe('running');
    });

    it('should persist to disk on save', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1' }));

      // 验证文件存在
      const filePath = store.storagePath;
      // storagePath 使用 homedir，不是 temp dir，但写入是异步同步的
      // 读取文件验证
      const raw = readFileSync(filePath, 'utf-8');
      const entries = JSON.parse(raw);
      expect(Array.isArray(entries)).toBe(true);
      expect(entries).toHaveLength(1);
      expect(entries[0].taskId).toBe('task-1');
    });
  });

  describe('listAll', () => {
    it('should return all entries', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1' }));
      store.save(makeEntry({ taskId: 'task-2' }));
      store.save(makeEntry({ taskId: 'task-3' }));

      const all = store.listAll();
      expect(all).toHaveLength(3);
    });

    it('should return empty array when no entries', () => {
      const store = new BackgroundTaskStore(tmpDir);
      expect(store.listAll()).toEqual([]);
    });
  });

  describe('listActive', () => {
    it('should return only pending and running entries', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1', status: 'pending' }));
      store.save(makeEntry({ taskId: 'task-2', status: 'running' }));
      store.save(makeEntry({ taskId: 'task-3', status: 'completed' }));
      store.save(makeEntry({ taskId: 'task-4', status: 'failed' }));
      store.save(makeEntry({ taskId: 'task-5', status: 'cancelled' }));

      const active = store.listActive();
      expect(active).toHaveLength(2);
      expect(active.map((e) => e.taskId).sort()).toEqual(['task-1', 'task-2']);
    });

    it('should return empty when all tasks are inactive', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1', status: 'completed' }));

      expect(store.listActive()).toHaveLength(0);
    });
  });

  describe('updateStatus', () => {
    it('should update status of existing entry', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1', status: 'pending' }));

      const result = store.updateStatus('task-1', 'running');
      expect(result).toBe(true);
      expect(store.get('task-1')?.status).toBe('running');
    });

    it('should update extra fields', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1', status: 'pending' }));

      store.updateStatus('task-1', 'completed', {
        completedAt: 1000,
        result: 'done',
        error: undefined,
      });

      const entry = store.get('task-1');
      expect(entry?.status).toBe('completed');
      expect(entry?.completedAt).toBe(1000);
      expect(entry?.result).toBe('done');
    });

    it('should return false for non-existent entry', () => {
      const store = new BackgroundTaskStore(tmpDir);
      expect(store.updateStatus('non-existent', 'running')).toBe(false);
    });

    it('should persist on updateStatus', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1', status: 'pending' }));
      store.updateStatus('task-1', 'running');

      const raw = readFileSync(store.storagePath, 'utf-8');
      const entries = JSON.parse(raw);
      expect(entries[0].status).toBe('running');
    });
  });

  describe('remove', () => {
    it('should remove existing entry', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1' }));

      expect(store.remove('task-1')).toBe(true);
      expect(store.get('task-1')).toBeUndefined();
    });

    it('should return false for non-existent entry', () => {
      const store = new BackgroundTaskStore(tmpDir);
      expect(store.remove('non-existent')).toBe(false);
    });

    it('should persist on remove', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1' }));
      store.save(makeEntry({ taskId: 'task-2' }));
      store.remove('task-1');

      const raw = readFileSync(store.storagePath, 'utf-8');
      const entries = JSON.parse(raw);
      expect(entries).toHaveLength(1);
      expect(entries[0].taskId).toBe('task-2');
    });
  });

  describe('load', () => {
    it('should load entries from disk and replace memory', () => {
      // 先用一个 store 写入
      const store1 = new BackgroundTaskStore(tmpDir);
      store1.save(makeEntry({ taskId: 'task-1', status: 'pending' }));
      store1.save(makeEntry({ taskId: 'task-2', status: 'completed' }));

      // 新建 store（相同 cwd），加载
      const store2 = new BackgroundTaskStore(tmpDir);
      store2.load();

      expect(store2.get('task-1')?.status).toBe('pending');
      expect(store2.get('task-2')?.status).toBe('completed');
      expect(store2.listAll()).toHaveLength(2);
    });

    it('should return empty array when file does not exist', () => {
      const store = new BackgroundTaskStore(tmpDir);
      const entries = store.load();
      expect(entries).toEqual([]);
    });

    it('should clear previous memory entries on load', () => {
      const store1 = new BackgroundTaskStore(tmpDir);
      store1.save(makeEntry({ taskId: 'old-task' }));

      const store2 = new BackgroundTaskStore(tmpDir);
      store2.load(); // 会从磁盘读到 old-task

      expect(store2.get('old-task')).toBeDefined();

      // 用原始 store 删掉所有内容
      store1.remove('old-task');

      const store3 = new BackgroundTaskStore(tmpDir);
      store3.load();
      expect(store3.listAll()).toHaveLength(0);
    });

    it('should handle invalid JSON gracefully', () => {
      const store = new BackgroundTaskStore(tmpDir);
      writeFileSync(store.storagePath, 'this is not json', 'utf-8');

      const entries = store.load();
      expect(entries).toEqual([]);
    });
  });

  describe('cleanStale', () => {
    it('should clean stale running tasks', () => {
      const store = new BackgroundTaskStore(tmpDir);
      const staleTime = Date.now() - 3 * 60 * 60 * 1000; // 3 hours ago
      store.save(makeEntry({ taskId: 'stale-running', status: 'running', createdAt: staleTime }));
      store.save(makeEntry({ taskId: 'fresh-running', status: 'running', createdAt: Date.now() }));

      const cleaned = store.cleanStale(2 * 60 * 60 * 1000); // max 2 hours
      expect(cleaned).toBe(1);

      const stale = store.get('stale-running');
      expect(stale?.status).toBe('failed');
      expect(stale?.error).toContain('超时丢失');

      const fresh = store.get('fresh-running');
      expect(fresh?.status).toBe('running'); // 不变
    });

    it('should clean stale pending tasks', () => {
      const store = new BackgroundTaskStore(tmpDir);
      const staleTime = Date.now() - 3 * 60 * 60 * 1000;
      store.save(makeEntry({ taskId: 'stale-pending', status: 'pending', createdAt: staleTime }));
      store.save(makeEntry({ taskId: 'fresh-pending', status: 'pending', createdAt: Date.now() }));

      const cleaned = store.cleanStale(2 * 60 * 60 * 1000);
      expect(cleaned).toBe(1);

      const stale = store.get('stale-pending');
      expect(stale?.status).toBe('cancelled');
      expect(stale?.error).toContain('pending 状态超时');

      const fresh = store.get('fresh-pending');
      expect(fresh?.status).toBe('pending');
    });

    it('should not clean completed or failed tasks', () => {
      const store = new BackgroundTaskStore(tmpDir);
      const staleTime = Date.now() - 3 * 60 * 60 * 1000;
      store.save(
        makeEntry({ taskId: 'stale-completed', status: 'completed', createdAt: staleTime })
      );
      store.save(makeEntry({ taskId: 'stale-failed', status: 'failed', createdAt: staleTime }));
      store.save(
        makeEntry({ taskId: 'stale-cancelled', status: 'cancelled', createdAt: staleTime })
      );

      const cleaned = store.cleanStale();
      expect(cleaned).toBe(0);
      expect(store.get('stale-completed')?.status).toBe('completed');
      expect(store.get('stale-failed')?.status).toBe('failed');
      expect(store.get('stale-cancelled')?.status).toBe('cancelled');
    });

    it('should return 0 when no stale tasks', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1', status: 'running', createdAt: Date.now() }));

      const cleaned = store.cleanStale();
      expect(cleaned).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should write valid JSON array to disk', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1' }));
      store.save(makeEntry({ taskId: 'task-2' }));

      const raw = readFileSync(store.storagePath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it('should write formatted JSON', () => {
      const store = new BackgroundTaskStore(tmpDir);
      store.save(makeEntry({ taskId: 'task-1' }));

      const raw = readFileSync(store.storagePath, 'utf-8');
      expect(raw).toContain('\n'); // pretty print
      expect(raw).toContain('  '); // indented
    });
  });
});
