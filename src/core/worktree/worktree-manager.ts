/**
 * Worktree 管理器
 *
 * 负责 git worktree 的完整生命周期管理：
 * - 创建隔离 worktree
 * - 执行后自动清理（无变更）或保留（有变更）
 * - 过期 worktree 清理
 *
 * 通过 child_process.execFile 调用 git 命令，不引入额外依赖。
 *
 * @module core/worktree
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { logger } from '@/infra/logger';
import type { WorktreeConfig, WorktreeCreateOptions, WorktreeInfo } from './types';
import { WorktreeError } from './types';
import { WorktreeStore } from './worktree-store';

const execFileAsync = promisify(execFile);

const log = logger.child('worktree-manager');

// ============ 单例 ============

let globalWorktreeManager: WorktreeManager | null = null;

/** 获取全局 WorktreeManager 实例 */
export function getWorktreeManager(): WorktreeManager | undefined {
  return globalWorktreeManager ?? undefined;
}

/** 设置全局 WorktreeManager 实例 */
export function setWorktreeManager(manager: WorktreeManager): void {
  globalWorktreeManager = manager;
}

/** 重置全局实例（仅用于测试） */
export function resetWorktreeManager(): void {
  globalWorktreeManager = null;
}

// ============ WorktreeManager ============

export class WorktreeManager {
  private config: WorktreeConfig;
  private store: WorktreeStore;
  private activeWorktrees: Map<string, WorktreeInfo> = new Map();

  constructor(config: WorktreeConfig) {
    this.config = config;
    this.store = new WorktreeStore(config.baseDir);
    this.store.load();
  }

  // ============ 创建 ============

  /**
   * 创建新的 git worktree
   */
  async create(options: WorktreeCreateOptions): Promise<WorktreeInfo> {
    if (!this.config.enabled) {
      throw new WorktreeError('Worktree 功能未启用', 'DISABLED');
    }

    const timestamp = Date.now();
    const branchName = `zapmyco-${options.slug}-${timestamp}`;
    const dirName = `${options.slug}-${timestamp}`;
    const worktreePath = join(this.store.getBaseDir(), dirName);

    // 1. 查找项目 git 根目录
    let gitRoot: string;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        timeout: 5000,
      });
      gitRoot = stdout.trim();
    } catch {
      throw new WorktreeError('无法确定 git 仓库根目录，请确保在 git 仓库中运行', 'NOT_GIT_REPO');
    }

    // 2. 创建 worktree
    try {
      log.info('创建 worktree', { branchName, worktreePath, gitRoot });
      await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath], {
        cwd: gitRoot,
        timeout: 30000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new WorktreeError(`创建 worktree 失败: ${msg}`, 'CREATE_FAILED');
    }

    // 3. 在 worktree 中创建新分支
    try {
      await execFileAsync('git', ['checkout', '-b', branchName], {
        cwd: worktreePath,
        timeout: 10000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('创建分支失败，清理 worktree', { branchName, error: msg });
      try {
        await this.removeByPath(worktreePath, branchName, true);
      } catch {
        // 清理失败不阻塞
      }
      throw new WorktreeError(`在 worktree 中创建分支失败: ${msg}`, 'BRANCH_FAILED');
    }

    // 4. 构建 WorktreeInfo
    const info: WorktreeInfo = {
      id: `${options.slug}-${timestamp}`,
      worktreePath,
      branchName,
      originalPath: gitRoot,
      createdAt: timestamp,
      createdBy: options.createdBy,
    };

    // 5. 注册
    this.activeWorktrees.set(info.id, info);

    // 6. 持久化
    this.store.save({
      id: info.id,
      worktreePath: info.worktreePath,
      branchName: info.branchName,
      originalPath: info.originalPath,
      createdAt: info.createdAt,
      createdBy: info.createdBy,
      status: 'active',
    });

    log.info('Worktree 创建成功', { id: info.id, path: worktreePath });
    return info;
  }

  // ============ 删除 ============

  /**
   * 删除指定 worktree
   */
  async remove(id: string, discardChanges?: boolean): Promise<void> {
    const info = this.activeWorktrees.get(id);
    if (!info) {
      log.warn('尝试删除不存在的 worktree', { id });
      return;
    }

    await this.removeByPath(info.worktreePath, info.branchName, discardChanges);
    this.activeWorktrees.delete(id);
    this.store.delete(id);
    log.info('Worktree 已删除', { id });
  }

  /**
   * 通过路径删除 worktree（内部方法）
   */
  private async removeByPath(
    worktreePath: string,
    branchName: string,
    discardChanges?: boolean
  ): Promise<void> {
    if (!existsSync(worktreePath)) {
      try {
        await execFileAsync('git', ['worktree', 'prune'], { timeout: 10000 });
      } catch {
        // 忽略
      }
      return;
    }

    const args = ['worktree', 'remove'];
    if (discardChanges) {
      args.push('--force');
    }
    args.push(worktreePath);

    try {
      await execFileAsync('git', args, { timeout: 15000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('git worktree remove 失败', { worktreePath, error: msg });
    }

    try {
      await execFileAsync('git', ['branch', '-D', branchName], { timeout: 10000 });
    } catch {
      // 分支可能已被删除
    }

    try {
      await execFileAsync('git', ['worktree', 'prune'], { timeout: 10000 });
    } catch {
      // 忽略
    }
  }

  // ============ 自动清理 ============

  /**
   * 检查 worktree 是否有变更，无变更则自动清理
   */
  async autoCleanIfNoChanges(id: string): Promise<{ cleaned: boolean; worktreePath?: string }> {
    const info = this.activeWorktrees.get(id);
    if (!info) {
      return { cleaned: true };
    }

    if (!this.config.autoCleanNoChanges) {
      return { cleaned: false, worktreePath: info.worktreePath };
    }

    if (!existsSync(info.worktreePath)) {
      this.activeWorktrees.delete(id);
      this.store.delete(id);
      return { cleaned: true };
    }

    const hasChanges = await this.checkHasChanges(info.worktreePath);
    if (!hasChanges) {
      await this.remove(id, true);
      return { cleaned: true };
    }

    log.info('Worktree 有变更，保留', { id, path: info.worktreePath });
    return { cleaned: false, worktreePath: info.worktreePath };
  }

  /**
   * 检查 worktree 中是否有未提交变更
   */
  private async checkHasChanges(worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: worktreePath,
        timeout: 5000,
      });
      return stdout.trim().length > 0;
    } catch {
      return true;
    }
  }

  // ============ 过期清理 ============

  /**
   * 清理过期的 worktree
   */
  async cleanExpired(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    this.store.cleanExpired(this.config.expireAfterMs);

    const allRecords = this.store.listAll();
    for (const record of allRecords) {
      if (record.status === 'expired' || now - record.createdAt > this.config.expireAfterMs) {
        if (existsSync(record.worktreePath)) {
          try {
            await this.removeByPath(record.worktreePath, record.branchName, true);
            cleaned++;
          } catch (err) {
            log.warn('过期 worktree 清理失败', {
              id: record.id,
              path: record.worktreePath,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        this.activeWorktrees.delete(record.id);
        this.store.delete(record.id);
      }
    }

    if (cleaned > 0) {
      log.info('过期 worktree 清理完成', { cleaned });
    }

    return cleaned;
  }

  // ============ 查询 ============

  listActive(): WorktreeInfo[] {
    return Array.from(this.activeWorktrees.values());
  }

  getWorktree(id: string): WorktreeInfo | undefined {
    return this.activeWorktrees.get(id);
  }

  getConfig(): WorktreeConfig {
    return { ...this.config };
  }

  getStore(): WorktreeStore {
    return this.store;
  }
}
