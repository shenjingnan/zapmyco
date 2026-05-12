/**
 * Worktree 隔离系统
 *
 * 提供 git worktree 级别的文件系统隔离能力。
 * 子 Agent 在独立 worktree 中运行，修改不影响主工作区。
 *
 * @module core/worktree
 */

export type {
  WorktreeConfig,
  WorktreeCreateOptions,
  WorktreeExecutionContext,
  WorktreeInfo,
  WorktreeRecord,
  WorktreeRecordStatus,
} from './types';
export { WorktreeError } from './types';
export {
  getWorktreeContext,
  resolveWorkdir,
  resolveWorktreePath,
  runInWorktree,
} from './worktree-context';
export {
  getWorktreeManager,
  resetWorktreeManager,
  setWorktreeManager,
  WorktreeManager,
} from './worktree-manager';
export { WorktreeStore } from './worktree-store';
