/**
 * Worktree 持久化存储
 *
 * 将 worktree 记录持久化到磁盘（~/.zapmyco/worktrees/ 目录），
 * 支持跨会话恢复和过期清理。
 *
 * @module core/worktree
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { WorktreeRecord, WorktreeRecordStatus } from './types';

/** 获取默认存储目录 */
function getDefaultBaseDir(): string {
  const os = require('node:os');
  return join(os.homedir(), '.zapmyco', 'worktrees');
}

/**
 * Worktree 持久化存储
 */
export class WorktreeStore {
  private baseDir: string;
  private cache: Map<string, WorktreeRecord> = new Map();
  private loaded = false;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || getDefaultBaseDir();
  }

  /** 获取存储目录 */
  getBaseDir(): string {
    return this.baseDir;
  }

  // ============ 读写操作 ============

  /** 保存记录到磁盘 */
  save(record: WorktreeRecord): void {
    this.ensureDir();
    this.cache.set(record.id, record);

    const filePath = this.getFilePath(record.id);
    writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  }

  /** 更新记录状态 */
  updateStatus(id: string, status: WorktreeRecordStatus): void {
    const record = this.cache.get(id);
    if (record) {
      record.status = status;
      this.cache.set(id, record);
      this.save(record);
    }
  }

  /** 删除记录（从缓存和磁盘） */
  delete(id: string): void {
    this.cache.delete(id);
    const filePath = this.getFilePath(id);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // 删除失败不阻塞
    }
  }

  /** 获取单个记录 */
  get(id: string): WorktreeRecord | undefined {
    this.ensureLoaded();
    return this.cache.get(id);
  }

  // ============ 查询操作 ============

  /** 列出所有活跃记录 */
  listActive(): WorktreeRecord[] {
    this.ensureLoaded();
    return Array.from(this.cache.values()).filter((r) => r.status === 'active');
  }

  /** 列出所有记录 */
  listAll(): WorktreeRecord[] {
    this.ensureLoaded();
    return Array.from(this.cache.values());
  }

  // ============ 批量操作 ============

  /** 从磁盘加载所有记录 */
  load(): WorktreeRecord[] {
    this.ensureDir();
    this.cache.clear();

    try {
      const files = readdirSync(this.baseDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = readFileSync(join(this.baseDir, file), 'utf-8');
          const record = JSON.parse(content) as WorktreeRecord;
          if (record.id && record.worktreePath) {
            this.cache.set(record.id, record);
          }
        } catch {
          // 跳过损坏的文件
        }
      }
    } catch {
      // 目录不存在或无法读取
    }

    this.loaded = true;
    return Array.from(this.cache.values());
  }

  /** 清理过期记录文件 */
  cleanExpired(expireAfterMs: number): number {
    this.ensureLoaded();
    let cleaned = 0;
    const now = Date.now();

    for (const [id, record] of this.cache) {
      if (record.status === 'expired') {
        this.delete(id);
        cleaned++;
      } else if (record.status === 'active' && now - record.createdAt > expireAfterMs) {
        // 标记为过期
        record.status = 'expired';
        this.save(record);
        cleaned++;
      }
    }

    return cleaned;
  }

  // ============ 内部方法 ============

  /** 确保目录存在 */
  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /** 确保已加载 */
  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }

  /** 获取记录文件路径 */
  private getFilePath(id: string): string {
    // 清理 id 中的特殊字符防止路径遍历
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.baseDir, `${safeId}.json`);
  }
}
