/**
 * Event Bridge — AgentEvent ↔ eventBus 桥接
 *
 * 将 pi-agent-core 的 Agent 生命周期事件转换为
 * zapmyco 全局事件总线（eventBus）的事件格式。
 *
 * @module core/agent-runtime/event-bridge
 */

import type { AgentEvent } from '@/core/agent-runtime/agent-types';
import { eventBus } from '@/infra/event-bus';
import type { AdaptedAgentEvent } from './types';

// ============ 事件转换 ============

/**
 * 将 pi-agent-core AgentEvent 转换为 zapmyco 适配事件
 *
 * @param agentEvent - pi-agent-core 原始事件
 * @param taskId - 关联的任务 ID
 * @param agentId - Agent 标识
 * @returns 适配后的事件，无法识别的返回 null
 */
export function adaptAgentEvent(
  agentEvent: AgentEvent,
  taskId: string,
  agentId: string
): AdaptedAgentEvent | null {
  switch (agentEvent.type) {
    case 'agent_start':
      return { type: 'agent:start', taskId, agentId };

    case 'agent_end':
      return { type: 'agent:end', taskId, agentId };

    case 'turn_start':
      return { type: 'turn:start', taskId };

    case 'turn_end':
      return { type: 'turn:end', taskId };

    case 'message_start':
      return {
        type: 'message:start',
        taskId,
        textPreview: extractTextContent(agentEvent.message).slice(0, 100),
      };

    case 'message_update':
      // task:output 无订阅者，跳过高频率的流式 delta 处理以避免浪费 CPU
      return null;

    case 'message_end':
      return {
        type: 'message:end',
        taskId,
        fullMessage: extractTextContent(agentEvent.message),
      };

    case 'tool_execution_start':
      return {
        type: 'tool:start',
        taskId,
        toolName: agentEvent.toolName ?? 'unknown',
        toolCallId: agentEvent.toolCallId,
        args: agentEvent.args,
      };

    case 'tool_execution_update':
      return {
        type: 'tool:update',
        taskId,
        toolName: agentEvent.toolName ?? 'unknown',
      };

    case 'tool_execution_end':
      return {
        type: 'tool:end',
        taskId,
        toolName: agentEvent.toolName ?? 'unknown',
        toolCallId: agentEvent.toolCallId,
        success: !agentEvent.isError,
      };

    default:
      // 忽略未知事件类型
      return null;
  }
}

// ============ 辅助函数 ============

/**
 * 从 AgentMessage 中提取文本内容
 */
function extractTextContent(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const msg = message as Record<string, unknown>;
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(
        (block): block is { type: string; text?: string } =>
          typeof block === 'object' && block !== null && block.type === 'text'
      )
      .map((block) => block.text ?? '')
      .join('');
  }
  return '';
}

/**
 * 将工具调用参数格式化为可读字符串
 */
function formatArgsDisplay(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      const display = raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
      return `${key}="${display.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    })
    .join(', ');
}

// ============ 事件分发 ============

/**
 * 将适配后的事件分发到 zapmyco eventBus
 *
 * 映射规则：
 * - agent:start/end → agent:online/offline（带 taskId 上下文）
 * - turn:start/end → task:started/task:progress
 * - message:* → task:output
 * - tool:* → task:progress（含工具信息）
 *
 * @param event - 适配后的事件
 */
export function dispatchToEventBus(event: AdaptedAgentEvent): void {
  switch (event.type) {
    case 'agent:start':
      eventBus.emit('agent:online', { agentId: event.agentId });
      break;

    case 'agent:end':
      eventBus.emit('task:completed', {
        taskId: event.taskId,
        result: {},
      });
      break;

    case 'turn:start':
      eventBus.emit('task:started', {
        taskId: event.taskId,
        agentId: '',
      });
      break;

    case 'turn:end':
      eventBus.emit('task:progress', {
        taskId: event.taskId,
        percent: 100,
        message: 'Turn completed',
      });
      break;

    case 'message:start':
    case 'message:end': {
      const text =
        event.type === 'message:end' ? event.fullMessage : `[开始生成] ${event.textPreview}`;
      if (text) {
        eventBus.emit('task:output', { taskId: event.taskId, text });
      }
      break;
    }

    case 'tool:start':
      eventBus.emit('task:progress', {
        taskId: event.taskId,
        percent: 0,
        message: `${event.toolName}(${formatArgsDisplay(event.args)})`,
      });
      break;

    case 'tool:update':
      eventBus.emit('task:progress', {
        taskId: event.taskId,
        percent: undefined,
        message: `${event.toolName} 更新中`,
      });
      break;

    case 'tool:end':
      eventBus.emit('task:progress', {
        taskId: event.taskId,
        percent: 100,
        message: `工具 ${event.toolName} ${event.success ? '完成' : '失败'}`,
      });
      break;

    case 'error':
      eventBus.emit('task:failed', {
        taskId: event.taskId,
        error: event.error,
        retryable: false,
      });
      break;
  }
}

// ============ 订阅桥接器 ============

/**
 * 创建 Agent 事件订阅桥接器
 *
 * 返回一个订阅函数，可直接传给 pi-agent-core Agent.subscribe()。
 * 所有 Agent 事件会自动转换并分发到 zapmyco eventBus。
 *
 * @param taskId - 关联的任务 ID
 * @param agentId - Agent 标识
 * @returns 事件监听函数
 */
export function createEventBridgeListener(
  taskId: string,
  agentId: string
): (event: AgentEvent, signal: AbortSignal) => void {
  return (agentEvent: AgentEvent): void => {
    const adapted = adaptAgentEvent(agentEvent, taskId, agentId);
    if (adapted) {
      dispatchToEventBus(adapted);
    }
  };
}
