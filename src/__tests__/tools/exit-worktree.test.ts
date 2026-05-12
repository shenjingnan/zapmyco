/**
 * ExitWorktree 工具测试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExitWorktreeTool } from '@/cli/repl/tools/exit-worktree';
import type { WorktreeExecutionContext } from '@/core/worktree/types';
import type { WorktreeManager } from '@/core/worktree/worktree-manager';

// 使用 vi.hoisted 解决 mock 变量在 vi.mock 之前定义的问题
const { mockGetWorktreeContext } = vi.hoisted(() => ({
  mockGetWorktreeContext: vi.fn(),
}));

// Mock worktree-context 和 process.chdir
vi.mock('@/core/worktree/worktree-context', () => ({
  getWorktreeContext: () => mockGetWorktreeContext(),
}));

// ExitWorktree keep/remove 都会调用 process.chdir
vi.spyOn(process, 'chdir').mockImplementation(() => undefined);

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

const mockCtx: WorktreeExecutionContext = {
  worktreeId: 'test-1715000000',
  worktreePath: '/tmp/worktrees/test-1715000000',
  originalPath: '/projects/myapp',
};

describe('ExitWorktree 工具', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorktreeContext.mockReturnValue(mockCtx);
  });

  afterEach(() => {
    mockGetWorktreeContext.mockReset();
  });

  describe('工具定义', () => {
    it('应该有正确的 id', () => {
      const tool = createExitWorktreeTool(createMockManager());
      expect(tool.id).toBe('ExitWorktree');
    });

    it('应该有正确的 label', () => {
      const tool = createExitWorktreeTool(createMockManager());
      expect(tool.label).toBe('退出工作树');
    });

    it('defaultRisk 应为 high', () => {
      const tool = createExitWorktreeTool(createMockManager());
      expect(tool.defaultRisk).toBe('high');
    });

    it('action 参数应有 keep 和 remove 枚举值', () => {
      const tool = createExitWorktreeTool(createMockManager());
      const params = tool.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, unknown>;

      expect(props.action).toBeDefined();
      const actionProp = props.action as Record<string, unknown>;
      expect(actionProp.enum).toEqual(['keep', 'remove']);
    });
  });

  describe('execute - 无 worktree 上下文', () => {
    it('应返回提示信息', async () => {
      mockGetWorktreeContext.mockReturnValue(undefined);

      const tool = createExitWorktreeTool(createMockManager());
      const result: any = await tool.execute('test-1', { action: 'keep' });

      expect(result.content[0].text).toContain('不处于 worktree 隔离环境');
    });
  });

  describe('execute - action="keep"', () => {
    it('应返回保留 worktree 的信息', async () => {
      const tool = createExitWorktreeTool(createMockManager());
      const result: any = await tool.execute('test-2', { action: 'keep' });

      expect(result.content[0].text).toContain('已退出 worktree 隔离环境');
      expect(result.content[0].text).toContain('保留 worktree');
      expect(result.content[0].text).toContain(mockCtx.worktreePath);
      expect(result.details.action).toBe('keep');
    });
  });

  describe('execute - action="remove"', () => {
    it('成功删除应返回信息', async () => {
      const manager = createMockManager();
      (manager.remove as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const tool = createExitWorktreeTool(manager);
      const result: any = await tool.execute('test-3', { action: 'remove' });

      expect(manager.remove).toHaveBeenCalledWith(mockCtx.worktreeId, undefined);
      expect(result.content[0].text).toContain('已退出 worktree 隔离环境');
      expect(result.content[0].text).toContain('已删除 worktree');
      expect(result.details.action).toBe('remove');
    });

    it('discard_changes=true 应传递参数', async () => {
      const manager = createMockManager();
      (manager.remove as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const tool = createExitWorktreeTool(manager);
      await tool.execute('test-4', { action: 'remove', discard_changes: true });

      expect(manager.remove).toHaveBeenCalledWith(mockCtx.worktreeId, true);
    });

    it('删除失败应返回错误', async () => {
      const manager = createMockManager();
      (manager.remove as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('remove failed'));

      const tool = createExitWorktreeTool(manager);
      const result: any = await tool.execute('test-5', { action: 'remove' });

      expect(result.content[0].text).toContain('退出 worktree 失败');
      expect(result.content[0].text).toContain('remove failed');
      expect(result.details.error).toBe('remove failed');
    });
  });
});
