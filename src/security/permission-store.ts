/**
 * 权限决策存储
 *
 * 维护两级存储：
 * 1. 会话级（内存 Map）—— 进程存活期间有效
 * 2. 持久化级（JSON 文件）—— 跨会话持久化
 *
 * 存储路径: ~/.zapmyco/permissions.json
 *
 * @module security/permission-store
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@/infra/logger';

const log = logger.child('permission-store');

// ============ 类型定义 ============

/** 单条持久化审批记录 */
interface StoredApproval {
  /** 工具 ID */
  toolId: string;
  /** 匹配模式（用于参数匹配，预留） */
  pattern: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 过期时间戳（毫秒，0 表示永不过期） */
  expiresAt: number;
}

/** 持久化文件格式 */
interface PermissionFile {
  approvals: StoredApproval[];
}

/** 持久化配置 */
interface PersistenceConfig {
  enabled: boolean;
  maxEntries: number;
  expireAfterDays: number;
}

// ============ 存储路径 ============

function getStoragePath(): string {
  return join(homedir(), '.zapmyco', 'permissions.json');
}

// ============ PermissionStore ============

export class PermissionStore {
  /** 会话级审批（toolId → pattern） */
  private sessionApprovals = new Map<string, string>();

  /** 持久化审批记录（内存缓存 + 文件同步） */
  private persistentApprovals: StoredApproval[] = [];

  private readonly config: PersistenceConfig;
  private loaded = false;

  constructor(config: Partial<PersistenceConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxEntries: config.maxEntries ?? 500,
      expireAfterDays: config.expireAfterDays ?? 30,
    };
  }

  // ============ 会话级 ============

  /**
   * 添加会话级审批
   */
  addSessionApproval(toolId: string, pattern?: string): void {
    this.sessionApprovals.set(toolId, pattern ?? toolId);
  }

  /**
   * 检查是否存在会话级审批
   */
  hasSessionApproval(toolId: string): boolean {
    return this.sessionApprovals.has(toolId);
  }

  // ============ 持久化级 ============

  /**
   * 添加持久化审批（写入文件）
   */
  addPersistentApproval(toolId: string, pattern?: string): void {
    if (!this.config.enabled) return;

    this.ensureLoaded();

    // 去重
    this.persistentApprovals = this.persistentApprovals.filter((a) => a.toolId !== toolId);

    // 计算过期时间
    const expiresAt =
      this.config.expireAfterDays > 0
        ? Date.now() + this.config.expireAfterDays * 24 * 60 * 60 * 1000
        : 0;

    this.persistentApprovals.push({
      toolId,
      pattern: pattern ?? toolId,
      createdAt: Date.now(),
      expiresAt,
    });

    // 限制条目数
    if (this.persistentApprovals.length > this.config.maxEntries) {
      this.persistentApprovals = this.persistentApprovals.slice(-this.config.maxEntries);
    }

    this.saveToFile();
  }

  /**
   * 检查是否存在持久化审批（自动清理过期条目）
   */
  hasPersistentApproval(toolId: string): boolean {
    if (!this.config.enabled) return false;

    this.ensureLoaded();
    this.removeExpired();

    return this.persistentApprovals.some((a) => a.toolId === toolId);
  }

  /**
   * 检查工具是否有任何级别的审批
   */
  hasApproval(toolId: string): boolean {
    return this.hasSessionApproval(toolId) || this.hasPersistentApproval(toolId);
  }

  // ============ 维护 ============

  /**
   * 清理过期条目
   */
  removeExpired(): void {
    if (this.config.expireAfterDays <= 0) return;

    const now = Date.now();
    const before = this.persistentApprovals.length;
    this.persistentApprovals = this.persistentApprovals.filter(
      (a) => a.expiresAt === 0 || a.expiresAt > now
    );

    if (this.persistentApprovals.length < before) {
      log.debug('清理过期审批条目', {
        removed: before - this.persistentApprovals.length,
      });
      this.saveToFile();
    }
  }

  /**
   * 清除所有存储
   */
  clear(): void {
    this.sessionApprovals.clear();
    this.persistentApprovals = [];
    this.saveToFile();
  }

  /**
   * 获取统计信息
   */
  getStats(): { sessionCount: number; persistentCount: number } {
    this.ensureLoaded();
    return {
      sessionCount: this.sessionApprovals.size,
      persistentCount: this.persistentApprovals.length,
    };
  }

  // ============ 文件 I/O ============

  /**
   * 确保已从文件加载（懒加载）
   */
  private ensureLoaded(): void {
    if (this.loaded) return;

    try {
      const raw = readFileSync(getStoragePath(), 'utf-8');
      const data = JSON.parse(raw) as PermissionFile;
      this.persistentApprovals = Array.isArray(data.approvals) ? data.approvals : [];
      log.debug('已加载持久化审批记录', { count: this.persistentApprovals.length });
    } catch {
      // 文件不存在或解析失败，使用空列表
      this.persistentApprovals = [];
    }

    this.loaded = true;
  }

  /**
   * 保存到文件
   */
  private saveToFile(): void {
    if (!this.config.enabled) return;

    try {
      const dir = join(homedir(), '.zapmyco');
      mkdirSync(dir, { recursive: true });

      const data: PermissionFile = { approvals: this.persistentApprovals };
      writeFileSync(getStoragePath(), JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      log.warn('保存权限持久化文件失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
