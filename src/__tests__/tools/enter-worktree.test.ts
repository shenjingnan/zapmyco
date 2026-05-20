/**
 * EnterWorktree 工具测试
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEnterWorktreeTool } from '@/cli/repl/tools/enter-worktree';
import type { WorktreeInfo } from '@/core/worktree/types';
import { WorktreeError } from '@/core/worktree/types';
import type { WorktreeManager } from '@/core/worktree/worktree-manager';

// Mock process.chdir — EnterWorktree 在创建成功后切换工作目录
vi.spyOn(process, 'chdir').mockImplementation(() => undefined);

function makeWorktreeInfo(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id: overrides.id ?? 'manual-1715000000',
    worktreePath: overrides.worktreePath ?? '/tmp/worktrees/manual-1715000000',
    branchName: overrides.branchName ?? 'zapmyco-manual-1715000000',
    originalPath: overrides.originalPath ?? '/projects/myapp',
    createdAt: overrides.createdAt ?? 1715000000,
    createdBy: overrides.createdBy ?? 'user',
  };
}

function createMockManager(): WorktreeManager {
  return {
    create: vi.fn(),
    remove: vi.fn(),
    autoCleanIfNoChanges: vi.fn(),
    cleanExpired: vi.fn(),
    listActive: vi.fn(),
    getWorktree: vi.fn(),
    getConfig: vi.fn(),
    getStore: vi.fn(),
  } as unknown as WorktreeManager;
}

describe('EnterWorktree 工具', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('工具定义', () => {
    it('应该有正确的 id', () => {
      const tool = createEnterWorktreeTool(createMockManager());
      expect(tool.id).toBe('EnterWorktree');
    });

    it('应该有正确的 label', () => {
      const tool = createEnterWorktreeTool(createMockManager());
      expect(tool.label).toBe('进入工作树');
    });

    it('defaultRisk 应为 high', () => {
      const tool = createEnterWorktreeTool(createMockManager());
      expect(tool.defaultRisk).toBe('high');
    });

    it('应该包含 name 参数', () => {
      const tool = createEnterWorktreeTool(createMockManager());
      const params = tool.parameters as Record<string, unknown>;
      expect(params.properties).toHaveProperty('name');
    });
  });

  describe('execute', () => {
    it('成功创建 worktree 应返回信息', async () => {
      const manager = createMockManager();
      const info = makeWorktreeInfo();
      (manager.create as ReturnType<typeof vi.fn>).mockResolvedValue(info);

      const tool = createEnterWorktreeTool(manager);
      const result: any = await tool.execute('test-1', { name: 'my-worktree' });

      expect(manager.create).toHaveBeenCalledWith({
        slug: 'my-worktree',
        createdBy: 'user',
      });
      expect(result.content[0].text).toContain('已进入 worktree 隔离环境');
      expect(result.content[0].text).toContain(info.worktreePath);
      expect(result.details.worktreeId).toBe(info.id);
    });

    it('不传 name 时应自动生成 slug', async () => {
      const manager = createMockManager();
      const info = makeWorktreeInfo();
      (manager.create as ReturnType<typeof vi.fn>).mockResolvedValue(info);

      const tool = createEnterWorktreeTool(manager);
      // fire and forget — 只验证 create 被调用
      await tool.execute('test-2', {});

      expect(manager.create).toHaveBeenCalled();
      const callArgs = (manager.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(callArgs.slug).toContain('manual-');
    });

    it('创建失败应返回错误信息', async () => {
      const manager = createMockManager();
      (manager.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new WorktreeError('test error', 'TEST_ERROR')
      );

      const tool = createEnterWorktreeTool(manager);
      const result: any = await tool.execute('test-3', { name: 'fail' });

      expect(result.content[0].text).toContain('创建 worktree 失败');
      expect(result.content[0].text).toContain('test error');
      expect(result.details.error).toBe('test error');
    });

    it('非 WorktreeError 也应返回错误信息', async () => {
      const manager = createMockManager();
      (manager.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('generic error'));

      const tool = createEnterWorktreeTool(manager);
      const result: any = await tool.execute('test-4', {});

      expect(result.content[0].text).toContain('创建 worktree 失败');
      expect(result.content[0].text).toContain('generic error');
    });
  });
});
