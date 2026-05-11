/**
 * 后台任务持久化存储
 *
 * 复用 TaskStore 的内存+JSON 双写模式。
 * 存储路径：~/.zapmyco/background-tasks/<cwd-hash>.json
 *
 * @module core/agent-team
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@/infra/logger';

const log = logger.child('background-store');

/** 后台任务持久化条目 */
export interface BackgroundTaskEntry {
  taskId: string;
  instanceId: string;
  typeId: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: string | undefined;
  createdAt: number;
  completedAt?: number | undefined;
  result?: string | undefined;
  error?: string | undefined;
  parentAgentId?: string | undefined;
}

/**
 * 后台任务持久化存储
 *
 * 提供跨会话的后台任务状态持久化。
 * 内存 Map + JSON 文件双写，每次变更自动同步到磁盘。
 */
export class BackgroundTaskStore {
  private tasks: Map<string, BackgroundTaskEntry> = new Map();
  private filePath: string;

  constructor(cwd?: string) {
    const dir = join(homedir(), '.zapmyco', 'background-tasks');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const hash = createHash('md5')
      .update(cwd ?? process.cwd())
      .digest('hex')
      .slice(0, 16);
    this.filePath = join(dir, `${hash}.json`);
  }

  /** 获取存储文件路径 */
  get storagePath(): string {
    return this.filePath;
  }

  /**
   * 从磁盘加载（覆盖内存）
   */
  load(): BackgroundTaskEntry[] {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const entries: BackgroundTaskEntry[] = JSON.parse(raw);
        this.tasks.clear();
        for (const entry of entries) {
          this.tasks.set(entry.taskId, entry);
        }
        log.debug('后台任务已加载', { count: entries.length, path: this.filePath });
        return entries;
      }
    } catch (err) {
      log.warn('后台任务加载失败', { error: String(err), path: this.filePath });
    }
    return [];
  }

  /**
   * 获取指定任务
   */
  get(taskId: string): BackgroundTaskEntry | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  listAll(): BackgroundTaskEntry[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取活跃（未完结）的任务
   */
  listActive(): BackgroundTaskEntry[] {
    return this.listAll().filter((t) => t.status === 'pending' || t.status === 'running');
  }

  /**
   * 保存或更新任务
   */
  save(entry: BackgroundTaskEntry): void {
    this.tasks.set(entry.taskId, entry);
    this.persist();
  }

  /**
   * 更新任务状态
   */
  updateStatus(
    taskId: string,
    status: BackgroundTaskEntry['status'],
    extra?: Partial<BackgroundTaskEntry>
  ): boolean {
    const entry = this.tasks.get(taskId);
    if (!entry) return false;

    Object.assign(entry, { status, ...extra });
    this.persist();
    return true;
  }

  /**
   * 删除任务
   */
  remove(taskId: string): boolean {
    const deleted = this.tasks.delete(taskId);
    if (deleted) this.persist();
    return deleted;
  }

  /** 同步到磁盘 */
  private persist(): void {
    try {
      const entries = Array.from(this.tasks.values());
      writeFileSync(this.filePath, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (err) {
      log.error('后台任务持久化失败', { error: String(err), path: this.filePath });
    }
  }

  /** 恢复时清理卡死的 running 任务 */
  cleanStale(maxRunningMs: number = 2 * 60 * 60 * 1000): number {
    let cleaned = 0;
    const now = Date.now();
    const stale: string[] = [];

    for (const [id, entry] of this.tasks) {
      if (entry.status === 'running' && now - entry.createdAt > maxRunningMs) {
        stale.push(id);
      }
      if (entry.status === 'pending' && now - entry.createdAt > maxRunningMs) {
        stale.push(id);
      }
    }

    for (const id of stale) {
      const entry = this.tasks.get(id);
      if (entry) {
        entry.status = entry.status === 'running' ? 'failed' : 'cancelled';
        entry.error =
          entry.status === 'failed'
            ? '任务超时丢失（跨会话恢复）'
            : '任务在 pending 状态超时，无法恢复';
        entry.completedAt = now;
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.persist();
      log.info('清理过期后台任务', { cleaned });
    }

    return cleaned;
  }
}
