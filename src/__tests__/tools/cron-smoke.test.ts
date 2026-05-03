/**
 * Cron 系统端到端烟测试
 *
 * 启动调度器 → 创建一次性任务（马上触发） → 验证触发事件
 *
 * 运行: pnpm exec vitest run src/__tests__/tools/cron-smoke.test.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CronScheduler } from '@/cli/repl/cron/cron-scheduler';
import { CronStore } from '@/cli/repl/cron/cron-store';

describe('Cron 烟测试', () => {
  let store: CronStore;
  let scheduler: CronScheduler;
  let tmpDir: string;
  let firedJobs: string[] = [];

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-cron-smoke-'));
    store = new CronStore(tmpDir);
    firedJobs = [];

    scheduler = new CronScheduler(store, {
      isIdle: () => true, // 始终允许触发
      checkIntervalMs: 200, // 200ms 快速检查
    });

    scheduler.on('fire', (event) => {
      firedJobs.push(event.job.id);
    });
  });

  afterEach(() => {
    scheduler.stop();
    scheduler.removeAllListeners();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('一次性任务应立即触发', async () => {
    // 使用 * * * * * (每分钟) 确保任何时候都能触发
    const result = await scheduler.addJob({
      id: CronStore.generateId(),
      cron: '* * * * *',
      prompt: '烟测试 — 立即触发',
      createdAt: Date.now() - 120000, // 2 分钟前创建，确保已经"到期"
      recurring: false,
      durable: false,
      enabled: true,
      fireCount: 0,
    });

    expect(result).toBeNull(); // addJob 成功返回 null

    await scheduler.start();

    // 等待调度器触发（最多 3 秒）
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(firedJobs.length).toBeGreaterThanOrEqual(1);
  });

  it('循环任务应触发且不被删除', async () => {
    await scheduler.addJob({
      id: CronStore.generateId(),
      cron: `* * * * *`, // 每分钟
      prompt: '烟测试 — 循环',
      createdAt: Date.now() - 60000,
      recurring: true,
      durable: false,
      enabled: true,
      fireCount: 0,
    });

    await scheduler.start();

    // 等待 3 秒
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(firedJobs.length).toBeGreaterThanOrEqual(1);

    // 循环任务不应被删除
    const jobs = scheduler.getJobs();
    expect(jobs.length).toBe(1);
  });

  it('暂停的任务不应触发', async () => {
    await scheduler.addJob({
      id: CronStore.generateId(),
      cron: '* * * * *',
      prompt: '烟测试 — 暂停',
      createdAt: Date.now() - 60000,
      recurring: true,
      durable: false,
      enabled: false, // 暂停
      fireCount: 0,
    });

    await scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(firedJobs.length).toBe(0);
  });

  it('pause/resume 操作', async () => {
    const jobId = CronStore.generateId();
    await scheduler.addJob({
      id: jobId,
      cron: '* * * * *', // 每分钟
      prompt: '烟测试 — pause/resume',
      createdAt: Date.now() - 120000,
      recurring: true,
      durable: false,
      enabled: false, // 初始暂停
      fireCount: 0,
    });

    await scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(firedJobs.length).toBe(0); // 暂停中不触发

    // 恢复后立即 triggerJob 手动触发来验证 resume 生效
    await scheduler.updateJob(jobId, { enabled: true });
    const err = await scheduler.triggerJob(jobId);
    expect(err).toBeNull(); // triggerJob 应成功
    expect(firedJobs.length).toBe(1);
  });

  it('removeJob 应删除任务', async () => {
    const jobId = CronStore.generateId();
    await scheduler.addJob({
      id: jobId,
      cron: '* * * * *',
      prompt: '烟测试 — 删除',
      createdAt: Date.now() - 60000,
      recurring: true,
      durable: false,
      enabled: true,
      fireCount: 0,
    });

    const removed = await scheduler.removeJob(jobId);
    expect(removed).toBe(true);

    const jobs = scheduler.getJobs();
    expect(jobs.length).toBe(0);
  });

  it('durable 任务应持久化并在重启后恢复', async () => {
    const jobId = CronStore.generateId();

    // 创建 durable 任务
    await scheduler.addJob({
      id: jobId,
      cron: '0 9 * * *',
      prompt: '烟测试 — 持久化',
      createdAt: Date.now(),
      recurring: true,
      durable: true,
      enabled: true,
      fireCount: 0,
    });

    // 持久化
    await store.persist(scheduler.getJobs());

    // 重新加载
    const loaded = await store.load();
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.id).toBe(jobId);
  });

  it('status 应返回正确状态', async () => {
    await scheduler.addJob({
      id: CronStore.generateId(),
      cron: '0 9 * * *',
      prompt: 'status 测试',
      createdAt: Date.now(),
      recurring: true,
      durable: false,
      enabled: true,
      fireCount: 0,
    });

    const status = await scheduler.getStatus();
    expect(status.jobCount).toBe(1);
    expect(status.enabledCount).toBe(1);
    expect(status.sessionCount).toBe(1);
    expect(status.durableCount).toBe(0);
  });
});
