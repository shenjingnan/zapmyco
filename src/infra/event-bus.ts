/**
 * zapmyco 事件总线
 *
 * 基于 EventEmitter3 的类型安全事件总线，
 * 用于模块间解耦通信。
 *
 * 内部事件命名规范：`module:action`
 * 例如：`task:started`, `agent:progress`, `goal:completed`
 */

import { EventEmitter } from 'eventemitter3';

/** 事件映射类型 */
interface EventMap {
  // Goal 生命周期
  'goal:submitted': { goalId: string; rawInput: string };
  'goal:intent-resolved': { goalId: string };
  'goal:decomposed': { goalId: string; taskCount: number };
  'goal:completed': { goalId: string; result: unknown };
  'goal:failed': { goalId: string; error: Error };

  // Task 生命周期
  'task:scheduled': { taskId: string; agentId: string };
  'task:started': { taskId: string; agentId: string };
  'task:progress': { taskId: string; percent: number; message?: string };
  'task:output': { taskId: string; text: string };
  'task:completed': { taskId: string; result: unknown };
  'task:failed': { taskId: string; error: Error; retryable: boolean };
  'task:retrying': { taskId: string; attempt: number; maxRetries: number };
  'task:cancelled': { taskId: string };

  // Agent 生命周期
  'agent:registered': { agentId: string };
  'agent:unregistered': { agentId: string };
  'agent:online': { agentId: string };
  'agent:offline': { agentId: string };

  // 系统
  'system:shutdown': { reason?: string };
}

/**
 * 全局事件总线实例
 *
 * 使用方式：
 * ```typescript
 * import { eventBus } from '../infra/event-bus.js';
 *
 * eventBus.on('task:started', ({ taskId, agentId }) => {
 *   console.log(`任务 ${taskId} 已在 ${agentId} 上启动`);
 * });
 *
 * eventBus.emit('task:started', { taskId: 'abc', agentId: 'code-1' });
 * ```
 */
export const eventBus = new EventEmitter<EventMap>();

/** 事件映射类型导出（用于创建独立实例的场景） */
export type { EventMap };
export { EventEmitter };
