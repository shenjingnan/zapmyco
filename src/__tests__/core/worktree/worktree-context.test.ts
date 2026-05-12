/**
 * WorktreeContext 测试
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorktreeExecutionContext } from '@/core/worktree/types';
import {
  getWorktreeContext,
  resolveWorkdir,
  resolveWorktreePath,
  runInWorktree,
} from '@/core/worktree/worktree-context';

const mockCtx: WorktreeExecutionContext = {
  worktreeId: 'test-worktree-1',
  worktreePath: '/tmp/worktrees/test-1',
  originalPath: '/projects/myapp',
};

describe('WorktreeContext', () => {
  describe('getWorktreeContext', () => {
    it('在 runInWorktree 外应返回 undefined', () => {
      expect(getWorktreeContext()).toBeUndefined();
    });

    it('在 runInWorktree 内应返回上下文', async () => {
      const result = await runInWorktree(mockCtx, () => {
        const ctx = getWorktreeContext();
        return ctx;
      });

      expect(result).toBeDefined();
      expect(result?.worktreeId).toBe('test-worktree-1');
      expect(result?.worktreePath).toBe('/tmp/worktrees/test-1');
      expect(result?.originalPath).toBe('/projects/myapp');
    });

    it('嵌套 runInWorktree 应使用最内层上下文', async () => {
      const innerCtx: WorktreeExecutionContext = {
        worktreeId: 'inner',
        worktreePath: '/tmp/inner',
        originalPath: '/projects/inner',
      };

      const result = await runInWorktree(mockCtx, async () => {
        return runInWorktree(innerCtx, () => {
          return getWorktreeContext();
        });
      });

      expect(result?.worktreeId).toBe('inner');
    });
  });

  describe('resolveWorktreePath', () => {
    it('无上下文时应直接 resolve', () => {
      // 确保在上下文外
      const result = resolveWorktreePath('/some/absolute/path');
      expect(result).toBe(resolve('/some/absolute/path'));
    });

    it('相对路径应在 worktree 中解析', async () => {
      const result = await runInWorktree(mockCtx, () => {
        return resolveWorktreePath('src/index.ts');
      });

      expect(result).toBe(resolve('/tmp/worktrees/test-1', 'src/index.ts'));
    });

    it('项目内的绝对路径应映射到 worktree', async () => {
      const result = await runInWorktree(mockCtx, () => {
        return resolveWorktreePath('/projects/myapp/src/index.ts');
      });

      expect(result).toBe(resolve('/tmp/worktrees/test-1', 'src/index.ts'));
    });

    it('项目外的绝对路径应保持原样', async () => {
      const result = await runInWorktree(mockCtx, () => {
        return resolveWorktreePath('/etc/config.ini');
      });

      expect(result).toBe(resolve('/etc/config.ini'));
    });

    it('项目根目录本身应映射到 worktree 根目录', async () => {
      const result = await runInWorktree(mockCtx, () => {
        return resolveWorktreePath('/projects/myapp');
      });

      expect(result).toBe('/tmp/worktrees/test-1');
    });
  });

  describe('resolveWorkdir', () => {
    it('无上下文时应返回 process.cwd()', () => {
      expect(resolveWorkdir()).toBe(process.cwd());
    });

    it('有上下文时应返回 worktree 路径', async () => {
      const result = await runInWorktree(mockCtx, () => {
        return resolveWorkdir();
      });

      expect(result).toBe('/tmp/worktrees/test-1');
    });
  });

  describe('runInWorktree', () => {
    it('应返回回调的返回值', async () => {
      const result = await runInWorktree(mockCtx, () => 'hello');
      expect(result).toBe('hello');
    });

    it('应支持 async 回调', async () => {
      const result = await runInWorktree(mockCtx, async () => {
        return Promise.resolve(42);
      });
      expect(result).toBe(42);
    });

    it('回调抛出异常应传播', async () => {
      await expect(
        runInWorktree(mockCtx, () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');
    });
  });
});
