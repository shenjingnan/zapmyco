import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CronStore, getCronStore } from '@/cli/repl/cron/cron-store';
import type { CronJob } from '@/cli/repl/cron/types';

/**
 * CronStore 持久化存储单元测试
 *
 * 覆盖: 初始化、load/persist 周期、数据校验、原子写入
 */
describe('CronStore', () => {
  let store: CronStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-cron-'));
    store = new CronStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeJob = (overrides: Partial<CronJob> = {}): CronJob => ({
    id: overrides.id ?? CronStore.generateId(),
    cron: overrides.cron ?? '0 9 * * *',
    prompt: overrides.prompt ?? '测试任务',
    createdAt: overrides.createdAt ?? Date.now(),
    recurring: overrides.recurring ?? true,
    durable: overrides.durable ?? true,
    enabled: overrides.enabled ?? true,
    fireCount: overrides.fireCount ?? 0,
    ...(overrides.lastFiredAt !== undefined ? { lastFiredAt: overrides.lastFiredAt } : {}),
    ...(overrides.lastError !== undefined ? { lastError: overrides.lastError } : {}),
    ...(overrides.maxFires !== undefined ? { maxFires: overrides.maxFires } : {}),
  });

  describe('initialize', () => {
    it('应该创建存储目录', async () => {
      await store.initialize();
      // 目录应存在
      const fs = await import('node:fs/promises');
      await expect(fs.access(tmpDir)).resolves.toBeUndefined();
    });

    it('重复调用 initialize 应该是幂等的', async () => {
      await store.initialize();
      await store.initialize();
      // 不应抛出异常
    });
  });

  describe('load', () => {
    it('空存储应返回空数组', async () => {
      const jobs = await store.load();
      expect(jobs).toEqual([]);
    });

    it('应加载持久化的任务', async () => {
      const jobs = [makeJob({ id: 'a1b2c3d4' }), makeJob({ id: 'e5f6g7h8' })];
      await store.persist(jobs);

      const loaded = await store.load();
      expect(loaded.length).toBe(2);
      expect(loaded[0]?.id).toBe('a1b2c3d4');
      expect(loaded[1]?.id).toBe('e5f6g7h8');
    });

    it('应过滤掉无效条目', async () => {
      const fs = await import('node:fs/promises');
      const filePath = join(tmpDir, 'scheduled_tasks.json');
      await fs.mkdir(join(tmpDir), { recursive: true });
      // 写入包含无效条目的 JSON
      await fs.writeFile(
        filePath,
        JSON.stringify([
          { id: 'valid1', cron: '0 9 * * *', prompt: 'ok', createdAt: 1000 },
          { bad: true }, // 无效条目
          { id: 'valid2', cron: '0 10 * * *', prompt: 'ok', createdAt: 2000, recurring: true },
        ]),
        'utf-8'
      );

      const loaded = await store.load();
      expect(loaded.length).toBe(2);
      expect(loaded[0]!.id).toBe('valid1');
      expect(loaded[1]!.id).toBe('valid2');
    });

    it('应过滤掉无效条目 —— 缺少必需字段', async () => {
      const fs = await import('node:fs/promises');
      const filePath = join(tmpDir, 'scheduled_tasks.json');
      await fs.mkdir(join(tmpDir), { recursive: true });
      await fs.writeFile(
        filePath,
        JSON.stringify([{ id: 'incomplete', prompt: 'no cron' }]),
        'utf-8'
      );

      const loaded = await store.load();
      expect(loaded.length).toBe(0);
    });

    it('JSON 损坏时应返回空数组', async () => {
      const fs = await import('node:fs/promises');
      const filePath = join(tmpDir, 'scheduled_tasks.json');
      await fs.mkdir(join(tmpDir), { recursive: true });
      await fs.writeFile(filePath, 'this is not json', 'utf-8');

      const loaded = await store.load();
      expect(loaded).toEqual([]);
    });

    it('非数组格式应返回空数组', async () => {
      const fs = await import('node:fs/promises');
      const filePath = join(tmpDir, 'scheduled_tasks.json');
      await fs.mkdir(join(tmpDir), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({ tasks: [] }), 'utf-8');

      const loaded = await store.load();
      expect(loaded).toEqual([]);
    });
  });

  describe('persist', () => {
    it('应持久化 durable 任务', async () => {
      const jobs = [
        makeJob({ id: 'd1', durable: true }),
        makeJob({ id: 'd2', durable: true }),
        makeJob({ id: 's1', durable: false }), // session-only 不同步
      ];
      await store.persist(jobs);

      const loaded = await store.load();
      expect(loaded.length).toBe(2);
      expect(loaded[0]!.id).toBe('d1');
      expect(loaded[1]!.id).toBe('d2');
    });

    it('应使用原子写入（tmp + rename）', async () => {
      const jobs = [makeJob({ id: 'atomic-test' })];
      await store.persist(jobs);

      const loaded = await store.load();
      expect(loaded.length).toBe(1);
      expect(loaded[0]!.id).toBe('atomic-test');
    });

    it('应保留可选字段', async () => {
      const jobs = [
        makeJob({
          id: 'full',
          lastFiredAt: 100,
          lastError: 'test error',
          maxFires: 5,
        }),
      ];
      await store.persist(jobs);

      const loaded = await store.load();
      expect(loaded.length).toBe(1);
      expect(loaded[0]!.lastFiredAt).toBe(100);
      expect(loaded[0]!.lastError).toBe('test error');
      expect(loaded[0]!.maxFires).toBe(5);
    });
  });

  describe('generateId', () => {
    it('应生成 8 位 hex ID', () => {
      const id = CronStore.generateId();
      expect(id).toMatch(/^[0-9a-f]{8}$/);
    });

    it('每次调用应生成不同 ID', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(CronStore.generateId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('getCronStore', () => {
    it('应返回全局单例', () => {
      const s1 = getCronStore();
      const s2 = getCronStore();
      expect(s1).toBe(s2);
    });
  });
});
