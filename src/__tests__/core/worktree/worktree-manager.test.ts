/**
 * WorktreeManager 测试
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorktreeConfig } from '@/core/worktree/types';
import { WorktreeError } from '@/core/worktree/types';
import {
  getWorktreeManager,
  resetWorktreeManager,
  setWorktreeManager,
  WorktreeManager,
} from '@/core/worktree/worktree-manager';
import { WorktreeStore } from '@/core/worktree/worktree-store';

// 使用 vi.hoisted 使 mock 变量在 vi.mock 被 hoisted 之前定义
const { mockExecFile, mockExistsSync } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(false),
}));

// Mock execFile
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      err: Error | null,
      result?: { stdout: string; stderr: string }
    ) => void;
    return mockExecFile(...args) ?? cb?.(null, { stdout: '', stderr: '' });
  },
}));

// Mock util.promisify to return controlled mock
vi.mock('node:util', async () => {
  const actual = await vi.importActual('node:util');
  return {
    ...actual,
    promisify: () => mockExecFile,
  };
});

// Mock fs — 对于 WorktreeStore 需要的函数使用 mock 避免实际文件操作
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    default: actual,
    ...actual,
    existsSync: mockExistsSync,
    mkdirSync: actual.mkdirSync, // 保留真 mkdirSync 因为 worktree-manager 也需要用
    writeFileSync: actual.writeFileSync, // 测试环境写入临时目录
    unlinkSync: actual.unlinkSync,
  };
});

// Mock logger
vi.mock('@/infra/logger', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

const baseDefaults: WorktreeConfig = {
  enabled: true,
  baseDir: '',
  autoCleanNoChanges: true,
  expireAfterMs: 24 * 60 * 60 * 1000,
};

function createManager(
  configOverrides?: Partial<WorktreeConfig>,
  baseDir?: string
): WorktreeManager {
  const config = { ...baseDefaults, ...configOverrides, baseDir: baseDir ?? '/tmp/zapmyco-wt' };
  return new WorktreeManager(config);
}

describe('WorktreeManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-wt-mgr-'));
    vi.clearAllMocks();
    resetWorktreeManager();
    mockExecFile.mockReset();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    resetWorktreeManager();
  });

  describe('constructor', () => {
    it('应该初始化并加载 store', () => {
      const manager = createManager({}, tmpDir);
      expect(manager).toBeDefined();
      expect(manager.listActive()).toEqual([]);
    });
  });

  describe('create', () => {
    it('禁用时应抛出 WorktreeError', async () => {
      const manager = createManager({ enabled: false }, tmpDir);
      await expect(manager.create({ slug: 'test', createdBy: 'user' })).rejects.toThrow(
        WorktreeError
      );
      await expect(manager.create({ slug: 'test', createdBy: 'user' })).rejects.toThrow(
        'Worktree 功能未启用'
      );
    });

    it('config 中 baseDir 为空字符串时应使用 store 的默认 baseDir', async () => {
      // 模拟 baseDir 为空字符串的场景（修复前会导致 mkdir '' 报错）
      // 直接构造 config，绕过 createManager 的 baseDir 强制覆盖
      const config: WorktreeConfig = {
        enabled: true,
        baseDir: '',
        autoCleanNoChanges: true,
        expireAfterMs: 24 * 60 * 60 * 1000,
      };
      const manager = new WorktreeManager(config);
      // git rev-parse
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      // git worktree add
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // git checkout -b
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const info = await manager.create({ slug: 'test-bc', createdBy: 'agent-coder' });
      expect(info).toBeDefined();
      // worktreePath 应包含 store 解析后的默认 baseDir（而非空字符串）
      expect(info.worktreePath).toContain('.zapmyco');
      expect(info.worktreePath).toContain('test-bc');
    });

    it('config 中不设置 baseDir 时应使用 store 的默认 baseDir', async () => {
      const config: WorktreeConfig = {
        enabled: true,
        autoCleanNoChanges: true,
        expireAfterMs: 24 * 60 * 60 * 1000,
      };
      const manager = new WorktreeManager(config);
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const info = await manager.create({ slug: 'test-ud', createdBy: 'agent-coder' });
      expect(info).toBeDefined();
      expect(info.worktreePath).toContain('.zapmyco');
    });

    it('不在 git 仓库中应抛出 WorktreeError', async () => {
      const manager = createManager({}, tmpDir);
      // git rev-parse 失败
      mockExecFile.mockRejectedValueOnce(new Error('not a git repository'));

      await expect(manager.create({ slug: 'test', createdBy: 'user' })).rejects.toThrow(
        WorktreeError
      );
    });

    it('git worktree add 失败应抛出 WorktreeError', async () => {
      const manager = createManager({}, tmpDir);
      // git rev-parse 成功
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      // git worktree add 失败
      mockExecFile.mockRejectedValueOnce(new Error('failed to add worktree'));

      await expect(manager.create({ slug: 'test', createdBy: 'user' })).rejects.toThrow(
        '创建 worktree 失败'
      );
    });

    it('git checkout -b 失败应清理并抛出 WorktreeError', async () => {
      const manager = createManager({}, tmpDir);
      // git rev-parse 成功
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      // git worktree add 成功
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // git checkout -b 失败
      mockExecFile.mockRejectedValueOnce(new Error('failed to create branch'));

      await expect(manager.create({ slug: 'test', createdBy: 'user' })).rejects.toThrow(
        '在 worktree 中创建分支失败'
      );
    });

    it('成功创建应返回 WorktreeInfo 并加入活跃列表', async () => {
      const manager = createManager({}, tmpDir);
      // git rev-parse
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      // git worktree add
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // git checkout -b
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const info = await manager.create({ slug: 'test-abc', createdBy: 'agent-coder' });

      expect(info).toBeDefined();
      expect(info.id).toContain('test-abc');
      expect(info.worktreePath).toContain(tmpDir);
      expect(info.originalPath).toBe('/projects/myapp');
      expect(info.createdBy).toBe('agent-coder');

      // 应该在活跃列表中
      expect(manager.listActive()).toHaveLength(1);
      expect(manager.getWorktree(info.id)).toBeDefined();
    });
  });

  describe('remove', () => {
    it('应删除存在的 worktree', async () => {
      const manager = createManager({}, tmpDir);
      // Mock 成功创建
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const info = await manager.create({ slug: 'to-remove', createdBy: 'user' });
      expect(manager.listActive()).toHaveLength(1);

      // 删除时 mock git 命令成功
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // worktree remove
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // branch -D
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // prune

      await manager.remove(info.id);
      expect(manager.listActive()).toHaveLength(0);
    });

    it('删除不存在的 worktree 不应抛异常', async () => {
      const manager = createManager({}, tmpDir);
      await expect(manager.remove('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('autoCleanIfNoChanges', () => {
    it('无变更应自动清理', async () => {
      const manager = createManager({}, tmpDir);
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const info = await manager.create({ slug: 'clean', createdBy: 'user' });
      expect(manager.listActive()).toHaveLength(1);

      // git status --porcelain 返回空 = 无变更
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // git worktree remove
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // git branch -D
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // git worktree prune
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await manager.autoCleanIfNoChanges(info.id);
      expect(result.cleaned).toBe(true);
      expect(manager.listActive()).toHaveLength(0);
    });

    it('有变更应保留', async () => {
      const manager = createManager({}, tmpDir);
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const info = await manager.create({ slug: 'dirty', createdBy: 'user' });
      expect(manager.listActive()).toHaveLength(1);

      // git status --porcelain 返回有内容 = 有变更
      mockExecFile.mockResolvedValueOnce({ stdout: ' M src/file.ts\n', stderr: '' });

      const result = await manager.autoCleanIfNoChanges(info.id);
      expect(result.cleaned).toBe(false);
      expect(result.worktreePath).toBe(info.worktreePath);
      expect(manager.listActive()).toHaveLength(1);
    });

    it('配置禁用时不自动清理', async () => {
      const manager = createManager({ autoCleanNoChanges: false }, tmpDir);
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const info = await manager.create({ slug: 'keep', createdBy: 'user' });

      const result = await manager.autoCleanIfNoChanges(info.id);
      expect(result.cleaned).toBe(false);
      expect(manager.listActive()).toHaveLength(1);
    });

    it('worktree 信息不存在时应返回已清理', async () => {
      const manager = createManager({}, tmpDir);
      const result = await manager.autoCleanIfNoChanges('nonexistent');
      expect(result.cleaned).toBe(true);
    });

    it('worktree 目录不存在时应清理记录', async () => {
      const manager = createManager({}, tmpDir);
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const info = await manager.create({ slug: 'gone', createdBy: 'user' });
      // 模拟目录已不存在
      mockExistsSync.mockReturnValueOnce(false);

      const result = await manager.autoCleanIfNoChanges(info.id);
      expect(result.cleaned).toBe(true);
      expect(manager.listActive()).toHaveLength(0);
    });
  });

  describe('cleanExpired', () => {
    it('应清理过期 worktree', async () => {
      // 使用 1ms 过期时间的配置
      const manager = createManager({ expireAfterMs: 1 }, tmpDir);
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      await manager.create({ slug: 'old', createdBy: 'user' });
      expect(manager.listActive()).toHaveLength(1);

      // 等待超过 1ms
      await new Promise((r) => setTimeout(r, 10));

      // git worktree remove
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // git branch -D
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // git worktree prune
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const cleaned = await manager.cleanExpired();
      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(manager.listActive()).toHaveLength(0);
    });

    it('无过期 worktree 时应返回 0', async () => {
      const manager = createManager({}, tmpDir);

      const cleaned = await manager.cleanExpired();
      expect(cleaned).toBe(0);
    });
  });

  describe('查询方法', () => {
    it('getWorktree 应返回指定 worktree', async () => {
      const manager = createManager({}, tmpDir);
      mockExecFile.mockResolvedValueOnce({ stdout: '/projects/myapp\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const info = await manager.create({ slug: 'query', createdBy: 'user' });

      const found = manager.getWorktree(info.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(info.id);
    });

    it('getWorktree 不存在的应返回 undefined', () => {
      const manager = createManager({}, tmpDir);
      expect(manager.getWorktree('nonexistent')).toBeUndefined();
    });

    it('getConfig 应返回配置副本', () => {
      const manager = createManager({}, tmpDir);
      const cfg = manager.getConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.autoCleanNoChanges).toBe(true);
    });

    it('getStore 应返回 WorktreeStore 实例', () => {
      const manager = createManager({}, tmpDir);
      const store = manager.getStore();
      expect(store).toBeInstanceOf(WorktreeStore);
    });
  });

  describe('全局单例', () => {
    it('setWorktreeManager 后 getWorktreeManager 应返回同一实例', () => {
      resetWorktreeManager();
      const manager = createManager({}, tmpDir);
      setWorktreeManager(manager);
      expect(getWorktreeManager()).toBe(manager);
    });

    it('resetWorktreeManager 后应返回 undefined', () => {
      resetWorktreeManager();
      const manager = createManager({}, tmpDir);
      setWorktreeManager(manager);
      expect(getWorktreeManager()).toBe(manager);

      resetWorktreeManager();
      expect(getWorktreeManager()).toBeUndefined();
    });

    it('未设置时应返回 undefined', () => {
      resetWorktreeManager();
      expect(getWorktreeManager()).toBeUndefined();
    });
  });
});
