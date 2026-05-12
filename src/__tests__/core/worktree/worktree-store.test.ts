/**
 * WorktreeStore 测试
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorktreeRecord } from '@/core/worktree/types';
import { WorktreeStore } from '@/core/worktree/worktree-store';

function makeRecord(overrides: Partial<WorktreeRecord> = {}): WorktreeRecord {
  return {
    id: overrides.id ?? 'test-1',
    worktreePath: overrides.worktreePath ?? '/tmp/worktrees/test-1',
    branchName: overrides.branchName ?? 'zapmyco-test-1',
    originalPath: overrides.originalPath ?? '/projects/myapp',
    createdAt: overrides.createdAt ?? Date.now(),
    createdBy: overrides.createdBy ?? 'agent-test',
    status: overrides.status ?? 'active',
  };
}

describe('WorktreeStore', () => {
  let tmpDir: string;
  let store: WorktreeStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-wt-store-'));
    store = new WorktreeStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('应该使用自定义目录', () => {
      expect(store.getBaseDir()).toBe(tmpDir);
    });

    it('应该使用默认目录（不传参时）', () => {
      const s = new WorktreeStore();
      expect(s.getBaseDir()).toContain('.zapmyco');
    });
  });

  describe('save and get', () => {
    it('应该保存并读取记录', () => {
      const record = makeRecord();
      store.save(record);

      const result = store.get('test-1');
      expect(result).toBeDefined();
      expect(result?.id).toBe('test-1');
      expect(result?.worktreePath).toBe('/tmp/worktrees/test-1');
      expect(result?.status).toBe('active');
    });

    it('不存在的记录应返回 undefined', () => {
      const result = store.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('应该将记录持久化到磁盘', () => {
      const record = makeRecord();
      store.save(record);

      const filePath = join(tmpDir, 'test-1.json');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.id).toBe('test-1');
    });

    it('id 中的特殊字符应被替换', () => {
      const record = makeRecord({ id: 'test/../path' });
      store.save(record);

      const filePath = join(tmpDir, 'test____path.json');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('listAll', () => {
    it('空存储应返回空数组', () => {
      expect(store.listAll()).toEqual([]);
    });

    it('应该列出所有记录', () => {
      store.save(makeRecord({ id: 'a' }));
      store.save(makeRecord({ id: 'b' }));
      store.save(makeRecord({ id: 'c', status: 'cleaned' }));

      const all = store.listAll();
      expect(all).toHaveLength(3);
    });
  });

  describe('listActive', () => {
    it('应该只列出 active 状态的记录', () => {
      store.save(makeRecord({ id: 'a', status: 'active' }));
      store.save(makeRecord({ id: 'b', status: 'cleaned' }));
      store.save(makeRecord({ id: 'c', status: 'expired' }));

      const active = store.listActive();
      expect(active).toHaveLength(1);
      expect(active[0]?.id).toBe('a');
    });
  });

  describe('updateStatus', () => {
    it('应该更新记录状态', () => {
      const record = makeRecord();
      store.save(record);

      store.updateStatus('test-1', 'cleaned');
      const result = store.get('test-1');
      expect(result?.status).toBe('cleaned');
    });

    it('更新不存在的记录不会抛异常', () => {
      expect(() => store.updateStatus('nonexistent', 'cleaned')).not.toThrow();
    });
  });

  describe('delete', () => {
    it('应该从缓存和磁盘中删除记录', () => {
      const record = makeRecord();
      store.save(record);
      expect(store.get('test-1')).toBeDefined();

      store.delete('test-1');
      expect(store.get('test-1')).toBeUndefined();

      const filePath = join(tmpDir, 'test-1.json');
      expect(existsSync(filePath)).toBe(false);
    });

    it('删除不存在的记录不会抛异常', () => {
      expect(() => store.delete('nonexistent')).not.toThrow();
    });
  });

  describe('load', () => {
    it('应该从磁盘加载记录', () => {
      // 第一个 store 写入记录
      store.save(makeRecord({ id: 'a' }));
      store.save(makeRecord({ id: 'b' }));
      store.save(makeRecord({ id: 'c', status: 'cleaned' }));

      // 第二个 store 从同一目录加载
      const store2 = new WorktreeStore(tmpDir);
      const records = store2.load();
      expect(records).toHaveLength(3);

      const a = store2.get('a');
      expect(a).toBeDefined();
      expect(a?.id).toBe('a');
    });

    it('空目录应返回空数组', () => {
      const store2 = new WorktreeStore(tmpDir);
      const records = store2.load();
      expect(records).toEqual([]);
    });
  });

  describe('cleanExpired', () => {
    it('应标记过期记录', () => {
      const oldDate = Date.now() - 48 * 60 * 60 * 1000; // 48 小时前
      store.save(makeRecord({ id: 'old', createdAt: oldDate, status: 'active' }));
      store.save(makeRecord({ id: 'new', createdAt: Date.now(), status: 'active' }));
      store.save(makeRecord({ id: 'expired', status: 'expired' }));

      const cleaned = store.cleanExpired(24 * 60 * 60 * 1000); // 24h 过期
      expect(cleaned).toBeGreaterThanOrEqual(1);

      // 旧记录应被标记为 expired，且从缓存中删除
      const oldRecord = store.get('old');
      expect(oldRecord?.status ?? 'expired').toBe('expired');

      // 新记录应保持 active
      const newRecord = store.get('new');
      expect(newRecord?.status).toBe('active');
    });

    it('无过期记录时应返回 0', () => {
      store.save(makeRecord({ id: 'fresh', createdAt: Date.now(), status: 'active' }));

      const cleaned = store.cleanExpired(24 * 60 * 60 * 1000);
      expect(cleaned).toBe(0);
    });
  });
});
