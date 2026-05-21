/**
 * 后台 Agent 管理器
 *
 * 管理后台异步 Agent 的完整生命周期：
 * - fire-and-forget 启动（立即返回 taskId，Agent 在后台执行）
 * - 进度跟踪
 * - 结果收集
 * - 完成后通过 AgentMessageBus 通知父 Agent
 * - 超时自动取消
 *
 * @module core/agent-team
 */

import { logger } from '@/infra/logger';
import { runWithToolGuardContext } from '@/security/tool-guard';
import { BackgroundTaskStore } from './agent-background-store';
import { getAgentInstanceManager } from './agent-instance-manager';
import { getAgentMessageBus } from './agent-message-bus';
import type { AgentOrchestrator, SpawnWorkerOptions } from './agent-orchestrator';

const log = logger.child('background-agent-manager');

/** 创建异步 Agent 的参数 */
export interface AsyncAgentParams {
  /** Agent 类型 ID */
  typeId: string;
  /** 任务描述 */
  description: string;
  /** 可选的背景上下文 */
  context?: string | undefined;
  /** 是否继承父级上下文 */
  inheritContext?: boolean | undefined;
  /** 父 Agent 实例 ID（用于完成通知） */
  parentInstanceId?: string | undefined;
  /** 超时（毫秒），默认 30 分钟 */
  timeoutMs?: number;
  /** 隔离模式 */
  isolation?: 'worktree';
}

/** 后台任务运行时条目 */
export interface BackgroundTaskRuntime {
  taskId: string;
  instanceId: string;
  typeId: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: string | undefined;
  createdAt: number;
  completedAt?: number | undefined;
  error?: string | undefined;
  abortController: AbortController;
  parentInstanceId?: string | undefined;
}

/**
 * 后台 Agent 管理器（单例）
 */
export class BackgroundAgentManager {
  private runtime: Map<string, BackgroundTaskRuntime> = new Map();
  private store: BackgroundTaskStore;
  private orchestrator: AgentOrchestrator | null = null;
  private defaultTimeoutMs: number = 30 * 60 * 1000;

  constructor() {
    this.store = new BackgroundTaskStore();
  }

  /** 注入 AgentOrchestrator（用于创建 Agent） */
  setOrchestrator(orchestrator: AgentOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  /** 获取持久化存储（供外部查询） */
  getStore(): BackgroundTaskStore {
    return this.store;
  }

  /**
   * 异步启动一个 Agent
   *
   * fire-and-forget 模式：
   * 1. 立即返回 { taskId, instanceId }
   * 2. Agent 在后台执行
   * 3. 完成后自动通过 AgentMessageBus 通知父 Agent
   *
   * @param params - 异步 Agent 参数
   * @returns 任务标识
   */
  async executeAsync(params: AsyncAgentParams): Promise<{ taskId: string; instanceId: string }> {
    if (!this.orchestrator) {
      throw new Error('BackgroundAgentManager 未注入 AgentOrchestrator');
    }

    const taskId = `bg-${params.typeId}-${Date.now()}`;
    const abortController = new AbortController();
    const timeoutMs = params.timeoutMs ?? this.defaultTimeoutMs;

    // 注册运行时条目
    const runtime: BackgroundTaskRuntime = {
      taskId,
      instanceId: '', // 将在 orchestrator 创建后填充
      typeId: params.typeId,
      description: params.description,
      status: 'pending',
      createdAt: Date.now(),
      abortController,
      parentInstanceId: params.parentInstanceId,
    };
    this.runtime.set(taskId, runtime);

    // 持久化初始状态
    this.store.save({
      taskId,
      instanceId: '',
      typeId: params.typeId,
      description: params.description,
      status: 'pending',
      createdAt: runtime.createdAt,
      parentAgentId: params.parentInstanceId,
    });

    // fire-and-forget 启动
    this.runAsync(taskId, params, abortController, timeoutMs).catch((err) => {
      log.error('后台 Agent 意外崩溃', { taskId, error: String(err) });
      this.failTask(taskId, `意外错误: ${err instanceof Error ? err.message : String(err)}`);
    });

    // 等待 orchestrator 创建 Agent 后更新 instanceId
    // runAsync 会在第一步填充 instanceId
    return { taskId, instanceId: runtime.instanceId || 'pending' };
  }

  /**
   * 实际执行后台 Agent 的逻辑
   */
  private async runAsync(
    taskId: string,
    params: AsyncAgentParams,
    abortController: AbortController,
    timeoutMs: number
  ): Promise<void> {
    const runtime = this.runtime.get(taskId);
    if (!runtime) return;

    const orchestrator = this.orchestrator;
    if (!orchestrator) {
      log.error('后台 Agent 执行时 Orchestrator 未注入', { taskId });
      this.failTask(taskId, 'Orchestrator 未注入');
      return;
    }
    const messageBus = getAgentMessageBus();

    // 超时定时器
    const timeoutHandle = setTimeout(() => {
      log.warn('后台 Agent 超时，自动取消', { taskId, timeoutMs });
      abortController.abort();
    }, timeoutMs);

    try {
      // 使用 spawnWorker 创建并注册 Agent（复用编排器的所有逻辑）
      const workerOptions: SpawnWorkerOptions = {
        taskId,
        timeoutMs,
        inheritContext: params.inheritContext ?? false,
        context: params.context,
        parentInstanceId: params.parentInstanceId,
        isolation: params.isolation,
        // 注入 ToolGuardContext，使后台 Agent 遇 ASK 自动降级为 DENY
        wrapExecute: (execute) =>
          runWithToolGuardContext({ isBackgroundAgent: true }, () => execute()),
      };

      // 注意：spawnWorker 会阻塞等待执行完毕
      // 但我们把它包装在异步 Promise 中 runAsync 本身不会被 await
      const result = await orchestrator.spawnWorker(
        params.typeId,
        params.description,
        workerOptions
      );

      // 更新 runtime 状态
      runtime.instanceId = result.instanceId;
      runtime.status = result.status === 'success' ? 'completed' : 'failed';
      runtime.completedAt = Date.now();
      if (result.error) {
        runtime.error = result.error.message;
      }

      // 持久化
      this.store.updateStatus(taskId, runtime.status, {
        instanceId: result.instanceId,
        completedAt: runtime.completedAt,
        result: result.output ?? undefined,
        error: runtime.error,
      });

      // 通过 MessageBus 通知父 Agent
      if (params.parentInstanceId) {
        const payload = JSON.stringify({
          taskId,
          instanceId: result.instanceId,
          typeId: params.typeId,
          status: result.status,
          summary: result.output,
          duration: result.duration,
          tokenUsage: result.tokenUsage,
          error: result.error,
        });

        messageBus.publish(result.instanceId, params.parentInstanceId, {
          type: 'task_result',
          payload,
          taskId,
          requiresResponse: false,
        });

        log.info('后台 Agent 完成通知已发送', {
          taskId,
          instanceId: result.instanceId,
          parentId: params.parentInstanceId,
          status: result.status,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // 检查是否是超时
      if (abortController.signal.aborted) {
        this.failTask(taskId, `任务超时（${timeoutMs / 1000}秒）`);
      } else {
        this.failTask(taskId, message);
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /** 标记任务失败 */
  private failTask(taskId: string, error: string): void {
    const runtime = this.runtime.get(taskId);
    if (runtime) {
      runtime.status = 'failed';
      runtime.error = error;
      runtime.completedAt = Date.now();
    }

    this.store.updateStatus(taskId, 'failed', {
      completedAt: Date.now(),
      error,
    });

    log.warn('后台 Agent 失败', { taskId, error });
  }

  /**
   * 获取后台任务状态
   */
  getTask(taskId: string): BackgroundTaskRuntime | undefined {
    return this.runtime.get(taskId);
  }

  /**
   * 列出所有活跃（未完结）的后台任务
   */
  listActive(): BackgroundTaskRuntime[] {
    return Array.from(this.runtime.values()).filter(
      (t) => t.status === 'pending' || t.status === 'running'
    );
  }

  /**
   * 列出所有后台任务
   */
  listAll(): BackgroundTaskRuntime[] {
    return Array.from(this.runtime.values());
  }

  /**
   * 取消后台任务
   */
  async cancel(taskId: string): Promise<boolean> {
    const runtime = this.runtime.get(taskId);
    if (!runtime) return false;

    if (
      runtime.status === 'completed' ||
      runtime.status === 'failed' ||
      runtime.status === 'cancelled'
    ) {
      return false;
    }

    runtime.abortController.abort();
    runtime.status = 'cancelled';
    runtime.completedAt = Date.now();
    this.store.updateStatus(taskId, 'cancelled', { completedAt: runtime.completedAt });

    // 尝试取消 Agent 实例
    if (runtime.instanceId) {
      try {
        const instanceManager = getAgentInstanceManager();
        await instanceManager.cancel(runtime.instanceId);
      } catch {
        // 取消失败非致命
      }
    }

    log.info('后台 Agent 已取消', { taskId });
    return true;
  }

  /**
   * 从持久化存储恢复（跨会话）
   */
  restore(): void {
    this.store.load();
    const stale = this.store.cleanStale();
    if (stale > 0) {
      log.info('跨会话恢复：清理了过期后台任务', { count: stale });
    }

    // 活跃任务无法恢复执行（进程已丢失）
    const active = this.store.listActive();
    for (const entry of active) {
      this.store.updateStatus(entry.taskId, 'failed', {
        completedAt: Date.now(),
        error: '会话终止导致任务丢失',
      });
    }

    if (active.length > 0) {
      log.info('跨会话恢复：标记活跃任务为 failed', { count: active.length });
    }
  }
}

/** 全局单例 */
let globalBackgroundManager: BackgroundAgentManager | null = null;

/** 获取 BackgroundAgentManager 单例 */
export function getBackgroundAgentManager(): BackgroundAgentManager {
  if (!globalBackgroundManager) {
    globalBackgroundManager = new BackgroundAgentManager();
  }
  return globalBackgroundManager;
}

/** 重置单例（仅用于测试） */
export function resetBackgroundAgentManager(): void {
  globalBackgroundManager = null;
}
