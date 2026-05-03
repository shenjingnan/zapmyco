/**
 * CronScheduler — 定时任务调度引擎
 *
 * 在 REPL 会话中运行，1 秒间隔检查到期任务。
 * 仅在 REPL 空闲时触发任务，使用确定性抖动分散负载。
 *
 * 设计要点:
 * - 1s setInterval 检查循环
 * - idle 门控: 仅当 REPL state === 'idle' 时触发
 * - timer.unref(): 不阻止进程退出
 * - 确定性 jitter: 基于 jobId 哈希
 * - 7 天自动过期: recurring 任务到期前触发最后一次
 * - 启动补发: 处理跨会话错过的一次性任务
 *
 * @module cli/repl/cron/cron-scheduler
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { logger } from '@/infra/logger';
import { getMissedOneShotJobs, parseCron } from './cron-parser';
import type { CronStore } from './cron-store';
import type { CronJob, SchedulerStatus } from './types';
import { CRON_CONSTANTS } from './types';

const log = logger.child('cron:scheduler');

// ============ 类型 ============

export interface CronSchedulerOptions {
  /** 会话 idle 状态检查函数 */
  isIdle: () => boolean;
  /** 调度检查间隔（毫秒），默认 1000 */
  checkIntervalMs?: number;
}

/** 当任务触发时发出的事件 */
export interface CronFireEvent {
  job: CronJob;
}

// ============ CronScheduler ============

export class CronScheduler extends EventEmitter {
  private store: CronStore;
  private jobs: CronJob[] = [];
  private sessionJobs: CronJob[] = []; // durable=false 的仅内存任务
  private timer: ReturnType<typeof setInterval> | null = null;
  private isIdle: () => boolean;
  private checkIntervalMs: number;
  private running = false;
  private missedAsked = new Set<string>();

  constructor(store: CronStore, options: CronSchedulerOptions) {
    super();
    this.store = store;
    this.isIdle = options.isIdle;
    this.checkIntervalMs = options.checkIntervalMs ?? CRON_CONSTANTS.CHECK_INTERVAL_MS;
  }

  // ============ 生命周期 ============

  /** 启动调度器：加载 durable 任务，启动检查循环 */
  async start(): Promise<void> {
    if (this.running) return;

    // 加载持久化任务
    const loadedJobs = await this.store.load();
    this.jobs = loadedJobs;

    log.info(`调度器启动，加载 ${loadedJobs.length} 个 durable 任务`);

    // 处理错过的一次性任务
    await this.handleMissedJobs();

    // 检查自动过期
    this.checkAutoExpiry();

    // 启动定时循环
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.checkIntervalMs);
    // 不阻止进程退出
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /** 停止调度器 */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('调度器已停止');
  }

  // ============ 任务管理 ============

  /** 添加任务 */
  async addJob(job: CronJob): Promise<string | null> {
    // 数量上限
    if (this.jobs.length + this.sessionJobs.length >= CRON_CONSTANTS.MAX_JOBS) {
      return `任务数已达上限（${CRON_CONSTANTS.MAX_JOBS}）`;
    }

    // 验证 cron 表达式
    const schedule = parseCron(job.cron);
    if (!schedule) {
      return `无效的 cron 表达式: ${job.cron}`;
    }

    // 检查是否有未来匹配（365 天内）
    const next = schedule.nextFrom(new Date());
    if (!next) {
      return `cron 表达式在未来 365 天内无匹配: ${job.cron}`;
    }

    if (job.durable) {
      this.jobs.push(job);
      await this.store.persist(this.jobs);
    } else {
      this.sessionJobs.push(job);
    }

    log.info('任务已添加', { id: job.id, cron: job.cron, durable: job.durable });
    return null;
  }

  /** 删除任务 */
  async removeJob(id: string): Promise<boolean> {
    // 先检查 session jobs
    const sessionIdx = this.sessionJobs.findIndex((j) => j.id === id);
    if (sessionIdx >= 0) {
      this.sessionJobs.splice(sessionIdx, 1);
      return true;
    }

    // 再检查 durable jobs
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx >= 0) {
      this.jobs.splice(idx, 1);
      await this.store.persist(this.jobs);
      return true;
    }

    return false;
  }

  /** 更新任务 */
  async updateJob(id: string, updates: Partial<CronJob>): Promise<string | null> {
    const job = this.findJob(id);
    if (!job) return `任务未找到: ${id}`;

    // 如果更新了 cron，验证新表达式
    if (updates.cron !== undefined) {
      const schedule = parseCron(updates.cron);
      if (!schedule) return `无效的 cron 表达式: ${updates.cron}`;
      const next = schedule.nextFrom(new Date());
      if (!next) return `cron 表达式在未来 365 天内无匹配: ${updates.cron}`;
    }

    Object.assign(job, updates);

    if (job.durable) {
      await this.store.persist(this.jobs);
    }

    return null;
  }

  /** 获取所有任务 */
  getJobs(): CronJob[] {
    return [...this.jobs, ...this.sessionJobs];
  }

  /** 获取调度器状态 */
  async getStatus(): Promise<SchedulerStatus> {
    const allJobs = this.getJobs();
    return {
      running: this.running,
      jobCount: allJobs.length,
      enabledCount: allJobs.filter((j) => j.enabled).length,
      durableCount: this.jobs.length,
      sessionCount: this.sessionJobs.length,
    };
  }

  /** 立即触发指定任务（不改变调度） */
  async triggerJob(id: string): Promise<string | null> {
    const job = this.findJob(id);
    if (!job) return `任务未找到: ${id}`;
    if (!job.enabled) return `任务已暂停: ${id}`;

    this.emit('fire', { job });
    job.lastFiredAt = Date.now();
    job.fireCount++;

    if (job.durable) {
      await this.store.persist(this.jobs);
    }

    return null;
  }

  // ============ 私有方法 ============

  /** 定时检查循环 */
  private async tick(): Promise<void> {
    if (!this.running) return;

    // idle 门控：仅在 REPL 空闲时触发
    if (!this.isIdle()) return;

    const now = Date.now();

    // 收集到期的任务
    const dueJobs = this.getDueJobs(now);
    if (dueJobs.length === 0) return;

    // 顺序触发（非并行，避免轰炸）
    for (const job of dueJobs) {
      if (!this.isIdle()) {
        // 如果在触发过程中 REPL 开始执行，停止后续触发
        break;
      }

      this.emit('fire', { job });
      job.lastFiredAt = now;
      job.fireCount++;

      // 一次性任务触发后删除
      if (!job.recurring) {
        await this.removeJob(job.id);
      }

      // 达到最大执行次数
      if (job.maxFires && job.fireCount >= job.maxFires) {
        await this.removeJob(job.id);
      }
    }

    // 批量持久化
    if (dueJobs.some((j) => j.durable)) {
      await this.store.persist(this.jobs);
    }

    // 检查过期
    this.checkAutoExpiry();
  }

  /** 获取到期任务（已应用 jitter） */
  private getDueJobs(nowMs: number): CronJob[] {
    const allJobs = this.getJobs();
    const due: CronJob[] = [];

    for (const job of allJobs) {
      if (!job.enabled) continue;

      const schedule = parseCron(job.cron);
      if (!schedule) continue;

      // 计算基准时间：上次触发时间或创建时间
      const fromMs = job.lastFiredAt ?? job.createdAt;
      const from = new Date(fromMs);

      const rawNext = schedule.nextFrom(from);
      if (!rawNext) continue;

      let nextMs = rawNext.getTime();

      // 应用 jitter
      if (job.recurring) {
        nextMs = applyRecurringJitter(job.id, nextMs, fromMs, schedule, from);
      } else {
        nextMs = applyOneShotJitter(job.id, rawNext);
      }

      if (nowMs >= nextMs) {
        due.push(job);
      }
    }

    return due;
  }

  private findJob(id: string): CronJob | undefined {
    return this.jobs.find((j) => j.id === id) ?? this.sessionJobs.find((j) => j.id === id);
  }

  /** 处理启动时错过的一次性任务 */
  private async handleMissedJobs(): Promise<void> {
    const oneShotJobs = this.jobs.filter((j) => !j.recurring && !j.lastFiredAt);
    if (oneShotJobs.length === 0) return;

    const now = new Date();
    const missed = getMissedOneShotJobs(oneShotJobs, now);

    if (missed.length === 0) return;

    const toFire = missed.slice(0, CRON_CONSTANTS.MAX_ONESHOT_MISSED_FIRE_COUNT);
    const toDelete = missed.slice(CRON_CONSTANTS.MAX_ONESHOT_MISSED_FIRE_COUNT);

    // 超过上限的任务直接删除
    for (const m of toDelete) {
      this.missedAsked.add(m.id);
      await this.removeJob(m.id);
    }

    // 补发任务（交错触发）
    for (let i = 0; i < toFire.length; i++) {
      const m = toFire[i];
      if (!m) continue;
      const job = this.jobs.find((j) => j.id === m.id);
      if (!job) continue;

      const delay = i * CRON_CONSTANTS.MISSED_FIRE_STAGGER_MS;

      setTimeout(() => {
        if (!this.missedAsked.has(job.id)) {
          this.missedAsked.add(job.id);
          this.emit('fire', { job });
          job.lastFiredAt = Date.now();
          job.fireCount++;
          // 一次性任务触发后删除
          void this.removeJob(job.id);
        }
      }, delay);
    }

    if (toDelete.length > 0) {
      log.info(`跳过 ${toDelete.length} 个错过的一次性任务（超出补发上限）`);
      this.emit('missed-overflow', {
        count: toDelete.length,
        jobIds: toDelete.map((m) => m.id),
      });
    }
  }

  /** 检查 7 天自动过期 */
  private checkAutoExpiry(): void {
    const now = Date.now();
    const autoExpireMs = CRON_CONSTANTS.AUTO_EXPIRE_DAYS * 24 * 60 * 60 * 1000;

    for (const job of this.jobs) {
      if (!job.recurring) continue;
      if (job.durable && now - job.createdAt >= autoExpireMs) {
        // 触发最后一次后删除
        this.emit('fire', { job });
        job.lastFiredAt = now;
        job.fireCount++;
        void this.removeJob(job.id);
        log.info('任务已过期并触发最后一次', { id: job.id });
      }
    }
  }
}

// ============ Jitter 计算 ============

/**
 * 基于 jobId 计算确定性抖动分数 [0, 1)
 * 使用 SHA256 前 8 位 hex 转换，纯数字 ID 回退到 parseInt
 */
function jitterFrac(jobId: string): number {
  // 尝试从 jobId 提取数值（兼容手动编辑 JSON 的情况）
  if (/^[0-9a-fA-F]{8}$/.test(jobId)) {
    const hash = createHash('sha256').update(jobId).digest('hex');
    const intVal = parseInt(hash.slice(0, 8), 16);
    return intVal / 0xffffffff;
  }

  // 非 hex ID：退化为无抖动
  return 0;
}

/**
 * 循环任务抖动：正向延迟
 * 延迟 = jitterFrac * 10% * interval，上限 15 分钟
 */
function applyRecurringJitter(
  jobId: string,
  rawNextMs: number,
  _fromMs: number,
  schedule: ReturnType<typeof parseCron>,
  from: Date
): number {
  if (!schedule) return rawNextMs;

  // 获取下两次触发来计算间隔
  const next1 = schedule.nextFrom(from);
  if (!next1) return rawNextMs;

  const next2 = schedule.nextFrom(next1);
  if (!next2) return rawNextMs;

  const intervalMs = next2.getTime() - next1.getTime();
  if (intervalMs <= 0) return rawNextMs;

  const frac = jitterFrac(jobId);
  const RECURRING_FRAC = 0.1;
  const RECURRING_CAP_MS = 15 * 60 * 1000; // 15 分钟

  const delay = Math.min(frac * RECURRING_FRAC * intervalMs, RECURRING_CAP_MS);
  return rawNextMs + Math.floor(delay);
}

/**
 * 一次性任务抖动：反向（提前触发）
 * 仅对 :00 和 :30 分钟时刻生效，最多提前 90 秒
 */
function applyOneShotJitter(jobId: string, rawNext: Date): number {
  const minutes = rawNext.getMinutes();
  const ONE_SHOT_MINUTE_MOD = 30;
  const ONE_SHOT_MAX_MS = 90 * 1000; // 90 秒
  const ONE_SHOT_FLOOR_MS = 0;

  // 仅对 :00/:30 等固定分钟时刻生效
  if (minutes % ONE_SHOT_MINUTE_MOD !== 0) {
    return rawNext.getTime();
  }

  const frac = jitterFrac(jobId);
  const early = ONE_SHOT_FLOOR_MS + frac * (ONE_SHOT_MAX_MS - ONE_SHOT_FLOOR_MS);
  return rawNext.getTime() - Math.floor(early);
}
