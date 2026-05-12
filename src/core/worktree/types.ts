/**
 * Worktree 隔离系统类型定义
 *
 * @module core/worktree
 */

// ============ Worktree 信息 ============

/** Worktree 运行时信息 */
export interface WorktreeInfo {
  /** 唯一标识 */
  id: string;
  /** worktree 文件系统路径 */
  worktreePath: string;
  /** worktree 对应的 git 分支名 */
  branchName: string;
  /** 原始项目根路径 */
  originalPath: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 创建者（agent instance id 或 'user'） */
  createdBy: string;
}

// ============ 创建选项 ============

/** Worktree 创建选项 */
export interface WorktreeCreateOptions {
  /** 用于生成分支名和目录名的标识 */
  slug: string;
  /** 创建者标识 */
  createdBy: string;
}

// ============ 配置 ============

/** Worktree 系统配置 */
export interface WorktreeConfig {
  /** 是否启用（默认 true） */
  enabled: boolean;
  /** worktree 存放根目录（默认 ~/.zapmyco/worktrees） */
  baseDir?: string;
  /** 无变更时自动清理（默认 true） */
  autoCleanNoChanges: boolean;
  /** 过期时间（毫秒，默认 24h） */
  expireAfterMs: number;
}

// ============ 持久化记录 ============

/** Worktree 持久化记录状态 */
export type WorktreeRecordStatus = 'active' | 'cleaned' | 'expired';

/** Worktree 持久化记录 */
export interface WorktreeRecord {
  id: string;
  worktreePath: string;
  branchName: string;
  originalPath: string;
  createdAt: number;
  createdBy: string;
  status: WorktreeRecordStatus;
}

// ============ 运行时上下文 ============

/** Worktree 执行上下文（通过 AsyncLocalStorage 传递） */
export interface WorktreeExecutionContext {
  /** worktree ID */
  worktreeId: string;
  /** worktree 文件系统路径 */
  worktreePath: string;
  /** 原始项目根路径 */
  originalPath: string;
}

// ============ 错误类型 ============

/** Worktree 操作错误 */
export class WorktreeError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'WorktreeError';
    this.code = code;
  }
}
