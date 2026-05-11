/**
 * Agent 实例管理器
 *
 * 管理所有 AgentInstance 的生命周期：创建、注册、状态转换、取消、清理。
 * 全局实例注册表，支持按 team/type/depth/status 查询。
 *
 * @module core/agent-team
 */

import type { LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import type {
  AgentInstance,
  AgentInstanceState,
  AgentTaskSpec,
  AgentTypeDefinition,
} from '@/core/agent-team/types';
import { logger } from '@/infra/logger';

const log = logger.child('agent-instance-manager');

/**
 * Agent 实例状态转换表
 *
 * idle → running / cancelled
 * running → completed / failed / paused / cancelled
 * paused → running / cancelled
 * completed / failed / cancelled → 终态（不可变更）
 */
const VALID_TRANSITIONS: Record<AgentInstanceState, AgentInstanceState[]> = {
  idle: ['running', 'cancelled'],
  running: ['completed', 'failed', 'paused', 'cancelled'],
  paused: ['running', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const TERMINAL_STATES: AgentInstanceState[] = ['completed', 'failed', 'cancelled'];

/**
 * Agent 实例管理器
 *
 * 单例模式，全局唯一。
 * 维护所有活跃和已完成的 Agent 实例的运行状态。
 */
export class AgentInstanceManager {
  /** 实例注册表（按 instanceId 索引） */
  private instances: Map<string, AgentInstance> = new Map();

  // ============ 创建与注册 ============

  /**
   * 注册新 Agent 实例
   *
   * @param definition - Agent 类型定义
   * @param agent - 底层 LlmBasedAgent
   * @param task - 任务规格
   * @param parentInstanceId - 父实例 ID（null 表示 root）
   * @param depth - 当前深度
   * @returns AgentInstance
   */
  register(
    definition: AgentTypeDefinition,
    agent: LlmBasedAgent,
    task: AgentTaskSpec,
    parentInstanceId: string | null,
    depth: number
  ): AgentInstance {
    const instance: AgentInstance = {
      instanceId: agent.agentId,
      typeId: definition.typeId,
      depth,
      parentInstanceId,
      childInstanceIds: [],
      status: 'idle',
      agent,
      inbox: [],
      task,
      createdAt: Date.now(),
    };

    this.instances.set(instance.instanceId, instance);

    // 建立父子关联
    if (parentInstanceId) {
      const parent = this.instances.get(parentInstanceId);
      if (parent) {
        parent.childInstanceIds.push(instance.instanceId);
      }
    }

    log.debug('注册 Agent 实例', {
      instanceId: instance.instanceId,
      typeId: definition.typeId,
      depth,
      parentInstanceId,
    });

    return instance;
  }

  // ============ 状态管理 ============

  /**
   * 更新实例状态（含状态转换验证）
   *
   * @param instanceId - 实例 ID
   * @param newStatus - 新状态
   * @returns 是否更新成功
   */
  transition(instanceId: string, newStatus: AgentInstanceState): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      log.warn('状态转换失败：实例不存在', { instanceId });
      return false;
    }

    const allowed = VALID_TRANSITIONS[instance.status];
    if (!allowed.includes(newStatus)) {
      log.warn('状态转换拒绝', {
        instanceId,
        from: instance.status,
        to: newStatus,
        allowed,
      });
      return false;
    }

    instance.status = newStatus;
    log.debug('Agent 实例状态转换', {
      instanceId,
      typeId: instance.typeId,
      from: instance.status,
      to: newStatus,
    });

    return true;
  }

  // ============ 查询 ============

  /**
   * 获取指定实例
   *
   * @param instanceId - 实例 ID
   */
  get(instanceId: string): AgentInstance | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * 列出所有实例
   */
  listAll(): AgentInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * 列出所有活跃（非终态）的实例
   */
  listActive(): AgentInstance[] {
    return this.listAll().filter((i) => !TERMINAL_STATES.includes(i.status));
  }

  /**
   * 列出指定父实例的所有子实例
   *
   * @param parentInstanceId - 父实例 ID
   */
  listChildren(parentInstanceId: string): AgentInstance[] {
    const parent = this.instances.get(parentInstanceId);
    if (!parent) return [];
    return parent.childInstanceIds
      .map((id) => this.instances.get(id))
      .filter((i): i is AgentInstance => i != null);
  }

  /**
   * 列出指定深度的所有实例
   *
   * @param depth - 深度层级
   */
  listByDepth(depth: number): AgentInstance[] {
    return this.listAll().filter((i) => i.depth === depth);
  }

  // ============ 取消 ============

  /**
   * 取消指定实例（并递归取消其所有子实例）
   *
   * @param instanceId - 实例 ID
   * @returns 被取消的实例 ID 列表
   */
  async cancel(instanceId: string): Promise<string[]> {
    const instance = this.instances.get(instanceId);
    if (!instance) return [];

    const cancelled: string[] = [];

    // 先递归取消所有子实例
    for (const childId of [...instance.childInstanceIds]) {
      const childCancelled = await this.cancel(childId);
      cancelled.push(...childCancelled);
    }

    // 取消自身
    if (!TERMINAL_STATES.includes(instance.status)) {
      try {
        await instance.agent.cancel(instance.task.taskId);
      } catch {
        // 取消失败非致命
      }
      this.transition(instanceId, 'cancelled');
      cancelled.push(instanceId);
    }

    return cancelled;
  }

  /**
   * 取消指定深度的所有活跃实例
   *
   * @param depth - 深度层级
   */
  async cancelByDepth(depth: number): Promise<string[]> {
    const targets = this.listByDepth(depth).filter((i) => !TERMINAL_STATES.includes(i.status));
    const allCancelled: string[] = [];
    for (const target of targets) {
      const cancelled = await this.cancel(target.instanceId);
      allCancelled.push(...cancelled);
    }
    return allCancelled;
  }

  // ============ 清理 ============

  /**
   * 清理实例资源并注销
   *
   * 从注册表中移除实例，并解除事件监听。
   *
   * @param instanceId - 实例 ID
   */
  cleanup(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    // 先递归清理子实例
    for (const childId of [...instance.childInstanceIds]) {
      this.cleanup(childId);
    }

    // 从父实例的 children 列表中移除
    if (instance.parentInstanceId) {
      const parent = this.instances.get(instance.parentInstanceId);
      if (parent) {
        parent.childInstanceIds = parent.childInstanceIds.filter((id) => id !== instanceId);
      }
    }

    // 清理 Agent 事件监听器
    instance.agent.removeAllListeners();
    instance.agent.systemPromptOverride = null;

    // 从注册表中移除
    this.instances.delete(instanceId);
    log.debug('Agent 实例已清理', { instanceId });
  }

  /**
   * 清理所有终态的实例
   *
   * @returns 清理的实例数量
   */
  cleanupTerminated(): number {
    const terminated = this.listAll().filter((i) => TERMINAL_STATES.includes(i.status));
    for (const instance of terminated) {
      this.cleanup(instance.instanceId);
    }
    return terminated.length;
  }

  // ============ 统计 ============

  /** 总实例数 */
  get totalCount(): number {
    return this.instances.size;
  }

  /** 活跃实例数 */
  get activeCount(): number {
    return this.listActive().length;
  }

  /** 按状态统计 */
  stats(): Record<AgentInstanceState, number> {
    const counts: Record<AgentInstanceState, number> = {
      idle: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const instance of this.instances.values()) {
      counts[instance.status]++;
    }
    return counts;
  }
}

/**
 * 全局单例
 */
let globalInstanceManager: AgentInstanceManager | null = null;

/** 获取全局 AgentInstanceManager 实例 */
export function getAgentInstanceManager(): AgentInstanceManager {
  if (!globalInstanceManager) {
    globalInstanceManager = new AgentInstanceManager();
  }
  return globalInstanceManager;
}

/** 重置全局实例（仅用于测试） */
export function resetAgentInstanceManager(): void {
  globalInstanceManager = null;
}
