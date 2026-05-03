/**
 * CronStore — 定时任务持久化存储
 *
 * 管理 ~/.zapmyco/cron/scheduled_tasks.json 文件，
 * 负责 durable 任务的跨会话恢复。
 *
 * 设计要点:
 * - 原子写入: 先写 .tmp 再 rename（防止部分写入损坏）
 * - 容错加载: JSON 损坏时降级为空列表，不阻塞启动
 * - 全局单例: 与 MemoryStore 相同的单例模式
 *
 * @module cli/repl/cron/cron-store
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '@/infra/logger';
import type { CronJob } from './types';

const log = logger.child('cron:store');

// ============ 常量 ============

const STORE_DIR = join(homedir(), '.zapmyco', 'cron');
const STORE_FILE = join(STORE_DIR, 'scheduled_tasks.json');

// ============ CronStore ============

export class CronStore {
  private filePath: string;
  private initialized = false;

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = join(customPath, 'scheduled_tasks.json');
    } else {
      this.filePath = STORE_FILE;
    }
  }

  // ============ 初始化 ============

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    this.initialized = true;
  }

  // ============ 加载 ============

  /**
   * 从文件加载 durable 任务
   * JSON 损坏时返回空数组并记录警告，不抛异常
   */
  async load(): Promise<CronJob[]> {
    await this.initialize();

    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) {
        log.warn('存储文件格式无效（非数组），将使用空列表');
        return [];
      }
      return this.validateJobs(data);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // 文件不存在，正常情况
        return [];
      }
      // JSON 损坏等其他错误
      log.warn('加载定时任务文件失败，将使用空列表', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // ============ 持久化 ============

  /**
   * 将 durable 任务持久化到文件
   * 原子写入：先写 .tmp 再 rename
   */
  async persist(jobs: CronJob[]): Promise<void> {
    await this.initialize();

    const durableJobs = jobs.filter((j) => j.durable);
    const tmpPath = `${this.filePath}.tmp`;

    const data = JSON.stringify(durableJobs, null, 2);
    await writeFile(tmpPath, data, 'utf-8');
    await rename(tmpPath, this.filePath);
  }

  // ============ 工具方法 ============

  /** 生成唯一 jobId（8 位 hex） */
  static generateId(): string {
    return randomBytes(4).toString('hex');
  }

  // ============ 内部方法 ============

  /**
   * 验证并清理加载的作业数据
   * 跳过无效条目，确保必需字段存在
   */
  private validateJobs(raw: unknown[]): CronJob[] {
    const valid: CronJob[] = [];

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;

      const obj = item as Record<string, unknown>;

      // 必需字段检查
      if (typeof obj.id !== 'string' || obj.id.length === 0) continue;
      if (typeof obj.cron !== 'string' || obj.cron.length === 0) continue;
      if (typeof obj.prompt !== 'string') continue;
      if (typeof obj.createdAt !== 'number') continue;

      const job: CronJob = {
        id: obj.id,
        cron: obj.cron,
        prompt: obj.prompt,
        createdAt: obj.createdAt,
        recurring: obj.recurring === true,
        durable: obj.durable !== false, // 持久化文件中的默认都是 durable
        enabled: obj.enabled !== false,
        fireCount: typeof obj.fireCount === 'number' ? obj.fireCount : 0,
      };

      if (typeof obj.lastFiredAt === 'number') job.lastFiredAt = obj.lastFiredAt;
      if (typeof obj.lastError === 'string') job.lastError = obj.lastError;
      if (typeof obj.maxFires === 'number') job.maxFires = obj.maxFires;

      valid.push(job);
    }

    if (valid.length < (raw as unknown[]).length) {
      log.warn(`跳过 ${(raw as unknown[]).length - valid.length} 个无效任务条目`);
    }

    return valid;
  }
}

// ============ 全局单例 ============

let globalStore: CronStore | null = null;

export function getCronStore(): CronStore {
  if (!globalStore) {
    globalStore = new CronStore();
  }
  return globalStore;
}
