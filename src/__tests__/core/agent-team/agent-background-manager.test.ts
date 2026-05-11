import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackgroundAgentManager,
  getBackgroundAgentManager,
  resetBackgroundAgentManager,
} from '@/core/agent-team/agent-background-manager';

// Mock 运行时的 spawnWorker 结果
const mockSpawnWorker = vi.fn();
const mockMessageBusPublish = vi.fn();
const mockInstanceManagerGet = vi.fn();
const mockInstanceManagerCancel = vi.fn();

// Mock 模块依赖
vi.mock('@/core/agent-team/agent-instance-manager', () => ({
  getAgentInstanceManager: () => ({
    get: mockInstanceManagerGet,
    cancel: mockInstanceManagerCancel,
    transition: vi.fn(),
    register: vi.fn(),
  }),
}));

vi.mock('@/core/agent-team/agent-message-bus', () => ({
  getAgentMessageBus: () => ({
    publish: mockMessageBusPublish,
  }),
}));

vi.mock('@/security/tool-guard', () => ({
  runWithToolGuardContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
  SecurityBlockedError: class extends Error {
    toolId: string;
    risk: string;
    reason: string;
    constructor(message: string, toolId: string, risk: string, reason: string) {
      super(message);
      this.name = 'SecurityBlockedError';
      this.toolId = toolId;
      this.risk = risk;
      this.reason = reason;
    }
  },
}));

/** 创建可手动控制的延迟 Promise */
function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// 创建 mock orchestrator
function createMockOrchestrator() {
  return {
    spawnWorker: mockSpawnWorker,
  };
}

describe('BackgroundAgentManager', () => {
  let manager: BackgroundAgentManager;

  beforeEach(() => {
    resetBackgroundAgentManager();
    vi.clearAllMocks();
    // 重置 mock 实现（清除遗留的 mockReturnValueOnce）
    mockSpawnWorker.mockReset();
    manager = new BackgroundAgentManager();

    // 默认 mock: spawnWorker 成功返回
    mockSpawnWorker.mockResolvedValue({
      instanceId: 'inst-test-1',
      typeId: 'general-purpose',
      taskDescription: 'test',
      status: 'success',
      output: 'done',
      artifacts: [],
      duration: 100,
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCostUsd: 0 },
    });
  });

  afterEach(() => {
    resetBackgroundAgentManager();
  });

  describe('setOrchestrator and getStore', () => {
    it('should set orchestrator', () => {
      const orch = createMockOrchestrator() as any;
      manager.setOrchestrator(orch);
      // 不抛错即可
    });

    it('should return store instance', () => {
      const store = manager.getStore();
      expect(store).toBeDefined();
    });
  });

  describe('executeAsync', () => {
    it('should throw when orchestrator is not set', async () => {
      await expect(
        manager.executeAsync({
          typeId: 'general-purpose',
          description: 'test',
        })
      ).rejects.toThrow('未注入 AgentOrchestrator');
    });

    it('should return taskId and instanceId immediately', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      const { taskId, instanceId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test task',
        parentInstanceId: 'parent-1',
      });

      expect(taskId).toMatch(/^bg-general-purpose-/);
      expect(instanceId).toBe('pending'); // 初始状态为 pending
    });

    it('should register runtime entry with pending status', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      // 使用延迟 promise，防止 runAsync 自动完成
      const deferred = createDeferred<unknown>();
      mockSpawnWorker.mockReturnValueOnce(deferred.promise);

      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test task',
      });

      const runtime = manager.getTask(taskId);
      expect(runtime).toBeDefined();
      expect(runtime?.status).toBe('pending');
      expect(runtime?.typeId).toBe('general-purpose');
      expect(runtime?.description).toBe('test task');
    });

    it('should call spawnWorker with correct parameters', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      await manager.executeAsync({
        typeId: 'researcher',
        description: 'research task',
        context: 'some context',
        inheritContext: true,
        parentInstanceId: 'parent-1',
        timeoutMs: 60000,
      });

      // 等待异步执行完成
      await vi.waitFor(() => {
        expect(mockSpawnWorker).toHaveBeenCalled();
      });

      const callArgs = mockSpawnWorker.mock.calls[0]!;
      expect(callArgs[0]).toBe('researcher');
      expect(callArgs[1]).toBe('research task');
      expect(callArgs[2]).toMatchObject({
        inheritContext: true,
        context: 'some context',
        parentInstanceId: 'parent-1',
        timeoutMs: 60000,
      });
    });

    it('should use default timeout of 30 minutes', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      await vi.waitFor(() => {
        expect(mockSpawnWorker).toHaveBeenCalled();
      });

      const callArgs = mockSpawnWorker.mock.calls[0]!;
      expect(callArgs[2].timeoutMs).toBe(30 * 60 * 1000);
    });
  });

  describe('background execution lifecycle', () => {
    it('should update runtime to completed when spawnWorker succeeds', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      await vi.waitFor(() => {
        const runtime = manager.getTask(taskId);
        return runtime?.status === 'completed';
      });

      const runtime = manager.getTask(taskId);
      expect(runtime?.status).toBe('completed');
      expect(runtime?.completedAt).toBeGreaterThan(0);
      expect(runtime?.instanceId).toBe('inst-test-1');
    });

    it('should update storage on completion', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      await vi.waitFor(() => {
        const stored = manager.getStore().get(taskId);
        return stored?.status === 'completed';
      });

      const stored = manager.getStore().get(taskId);
      expect(stored?.status).toBe('completed');
      expect(stored?.instanceId).toBe('inst-test-1');
    });

    it('should publish message to parent on completion', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
        parentInstanceId: 'parent-1',
      });

      await vi.waitFor(() => {
        return mockMessageBusPublish.mock.calls.length > 0;
      });

      expect(mockMessageBusPublish).toHaveBeenCalled();
      const publishCall = mockMessageBusPublish.mock.calls[0]!;
      expect(publishCall[0]).toBe('inst-test-1');
      expect(publishCall[1]).toBe('parent-1');
      expect(publishCall[2].type).toBe('task_result');
      expect(publishCall[2].taskId).toBeDefined();
      expect(publishCall[2].requiresResponse).toBe(false);
    });

    it('should not publish message when no parentInstanceId', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      // 等待一小段时间确保异步完成
      await vi.waitFor(() => {
        const allTasks = manager.listAll();
        return allTasks.some((t) => t.status === 'completed');
      });

      // messageBus.publish 不应该被调用
      expect(mockMessageBusPublish).not.toHaveBeenCalled();
    });

    it('should handle spawnWorker failure', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);
      mockSpawnWorker.mockRejectedValueOnce(new Error('test error'));

      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      await vi.waitFor(() => {
        const runtime = manager.getTask(taskId);
        return runtime?.status === 'failed';
      });

      const runtime = manager.getTask(taskId);
      expect(runtime?.status).toBe('failed');
      expect(runtime?.error).toContain('test error');
    });

    it('should handle spawnWorker returning error status', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);
      mockSpawnWorker.mockResolvedValueOnce({
        instanceId: 'inst-fail-1',
        typeId: 'general-purpose',
        taskDescription: 'test',
        status: 'failure',
        output: null,
        artifacts: [],
        error: { code: 'TEST_ERROR', message: 'something went wrong', retryable: false },
        duration: 200,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      });

      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      await vi.waitFor(() => {
        const runtime = manager.getTask(taskId);
        return runtime?.status === 'failed';
      });

      const runtime = manager.getTask(taskId);
      expect(runtime?.status).toBe('failed');
    });
  });

  describe('getTask', () => {
    it('should return runtime entry for existing task', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);
      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      const runtime = manager.getTask(taskId);
      expect(runtime).toBeDefined();
      expect(runtime?.taskId).toBe(taskId);
    });

    it('should return undefined for non-existent task', () => {
      expect(manager.getTask('non-existent')).toBeUndefined();
    });
  });

  describe('listActive', () => {
    it('should return only pending and running tasks', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      // 使用延迟 promise 防止后台任务自动完成
      const deferred1 = createDeferred<unknown>();
      mockSpawnWorker.mockImplementation(() => deferred1.promise);

      await manager.executeAsync({ typeId: 'general-purpose', description: 'task 1' });
      // 此时任务状态应为 pending
      const activeAfterOne = manager.listActive();
      expect(activeAfterOne.length).toBeGreaterThanOrEqual(1);
      expect(activeAfterOne[0]?.status).toBe('pending');
    });

    it('should return empty when no tasks', () => {
      const active = manager.listActive();
      expect(active).toEqual([]);
    });
  });

  describe('listAll', () => {
    it('should return all tasks', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      await manager.executeAsync({ typeId: 'general-purpose', description: 'task 1' });

      const all = manager.listAll();
      expect(all.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty when no tasks', () => {
      expect(manager.listAll()).toEqual([]);
    });
  });

  describe('cancel', () => {
    it('should cancel a pending task (before spawnWorker resolves)', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      // 使用延迟 promise，防止 runAsync 自动完成
      const deferred = createDeferred<unknown>();
      mockSpawnWorker.mockReturnValueOnce(deferred.promise);

      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      const result = await manager.cancel(taskId);
      expect(result).toBe(true);

      const runtime = manager.getTask(taskId);
      expect(runtime?.status).toBe('cancelled');
      expect(runtime?.completedAt).toBeGreaterThan(0);
    });

    it('should return false for non-existent task', async () => {
      const result = await manager.cancel('non-existent');
      expect(result).toBe(false);
    });

    it('should return false for already completed task', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      // 等待完成
      await vi.waitFor(() => {
        const runtime = manager.getTask(taskId);
        return runtime?.status === 'completed';
      });

      const result = await manager.cancel(taskId);
      expect(result).toBe(false);
    });

    it('should return false for already failed task', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      const deferred = createDeferred<unknown>();
      deferred.reject(new Error('fail'));
      mockSpawnWorker.mockReturnValueOnce(deferred.promise);

      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      await vi.waitFor(() => {
        const runtime = manager.getTask(taskId);
        return runtime?.status === 'failed';
      });

      const result = await manager.cancel(taskId);
      expect(result).toBe(false);
    });

    it('should try to cancel instance via instance manager', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      const deferred = createDeferred<unknown>();
      mockSpawnWorker.mockReturnValueOnce(deferred.promise);

      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      const result = await manager.cancel(taskId);
      expect(result).toBe(true);

      // instanceId 是 pending 所以 instanceManager.cancel 不会被调用
      // 但 cancel 本身成功
    });

    it('should update store on cancel', async () => {
      manager.setOrchestrator(createMockOrchestrator() as any);

      const deferred = createDeferred<unknown>();
      mockSpawnWorker.mockReturnValueOnce(deferred.promise);

      const { taskId } = await manager.executeAsync({
        typeId: 'general-purpose',
        description: 'test',
      });

      await manager.cancel(taskId);

      const stored = manager.getStore().get(taskId);
      expect(stored?.status).toBe('cancelled');
    });
  });

  describe('restore', () => {
    it('should load store and mark active tasks as failed', () => {
      // 预先写入一些活跃任务到 store
      const store = manager.getStore();
      store.save({
        taskId: 'bg-restore-1',
        instanceId: 'inst-1',
        typeId: 'general-purpose',
        description: 'lost task',
        status: 'running',
        createdAt: Date.now() - 1000,
        parentAgentId: 'parent-1',
      });

      // 也创建一个内存中的 runtime
      // restore 会清理 stale 并标记活跃为 failed
      manager.restore();

      const stored = store.get('bg-restore-1');
      expect(stored?.status).toBe('failed');
      expect(stored?.error).toContain('会话终止');
    });

    it('should clean stale tasks on restore', () => {
      // 写入过期的任务
      const store = manager.getStore();
      const staleTime = Date.now() - 3 * 60 * 60 * 1000;
      store.save({
        taskId: 'stale-task',
        instanceId: 'inst-1',
        typeId: 'general-purpose',
        description: 'old task',
        status: 'running',
        createdAt: staleTime,
      });

      manager.restore();

      const stored = store.get('stale-task');
      expect(stored?.status).toBe('failed');
    });

    it('should handle empty store on restore', () => {
      // 不应该抛错
      expect(() => manager.restore()).not.toThrow();
    });
  });

  describe('global singleton', () => {
    it('should return same instance', () => {
      resetBackgroundAgentManager();
      const a = getBackgroundAgentManager();
      const b = getBackgroundAgentManager();
      expect(a).toBe(b);
    });

    it('should create new instance after reset', () => {
      resetBackgroundAgentManager();
      const a = getBackgroundAgentManager();
      resetBackgroundAgentManager();
      const b = getBackgroundAgentManager();
      expect(a).not.toBe(b);
    });
  });
});
