/**
 * Worktree 运行时上下文
 *
 * 基于 AsyncLocalStorage 在整个工具调用链中传递 worktree 上下文。
 * 文件操作和 Shell 工具通过 resolveWorktreePath() 自动映射路径到 worktree。
 *
 * @module core/worktree
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { isAbsolute, relative, resolve } from 'node:path';
import type { WorktreeExecutionContext } from './types';

// ============ AsyncLocalStorage ============

const worktreeStorage = new AsyncLocalStorage<WorktreeExecutionContext>();

// ============ 上下文访问 ============

/** 获取当前 worktree 上下文 */
export function getWorktreeContext(): WorktreeExecutionContext | undefined {
  return worktreeStorage.getStore();
}

/** 在 worktree 上下文中执行回调 */
export async function runInWorktree<T>(
  context: WorktreeExecutionContext,
  fn: () => T | Promise<T>
): Promise<T> {
  return worktreeStorage.run(context, fn);
}

// ============ 路径解析 ============

/**
 * 将路径解析到当前 worktree
 *
 * 解析规则：
 * - 无 worktree 上下文 → 直接 resolve 返回
 * - 相对路径 → 在 worktree 根目录下解析
 * - 绝对路径（属于原项目目录） → 映射到 worktree 对应路径
 * - 绝对路径（不在项目目录内） → 保持原样
 */
export function resolveWorktreePath(originalPath: string): string {
  const ctx = worktreeStorage.getStore();
  if (!ctx) return resolve(originalPath);

  // 相对路径 → 在 worktree 中解析
  if (!isAbsolute(originalPath)) {
    return resolve(ctx.worktreePath, originalPath);
  }

  // 绝对路径 → 如果属于原项目目录，映射到 worktree
  const normalizedOriginal = resolve(originalPath);
  const normalizedProjectRoot = resolve(ctx.originalPath);

  if (normalizedOriginal.startsWith(normalizedProjectRoot)) {
    const relPath = relative(normalizedProjectRoot, normalizedOriginal);
    return resolve(ctx.worktreePath, relPath);
  }

  // 不在项目目录内 → 保持原样
  return normalizedOriginal;
}

/**
 * 获取当前有效的工作目录
 *
 * 在 worktree 上下文中返回 worktree 路径，否则返回 process.cwd()
 */
export function resolveWorkdir(): string {
  const ctx = worktreeStorage.getStore();
  return ctx?.worktreePath ?? process.cwd();
}
