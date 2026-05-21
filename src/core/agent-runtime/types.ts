/**
 * Agent Runtime 适配层类型定义
 *
 * 本层作为 zapmyco 核心抽象与底层 Agent 循环之间的隔离边界。
 *
 * @module core/agent-runtime
 */

import type { SubTask } from '@/core/task/types';
import type { AgentExecuteRequest } from '@/protocol/agent';
import type { Capability } from '@/protocol/capability';
import type { AgentTool } from './agent-types';

// ============ 重新导出内部 Agent 类型的别名 ============

/**
 * 重新导出内部 Agent 循环的类型供适配层其他文件使用。
 * 这些类型不通过 index.ts 暴露给外部。
 */

// Agent 运行相关
export type { Agent } from './agent';
// Tool 相关
// Event 相关
export type {
  AgentEvent,
  AgentMessage,
  AgentState,
  AgentTool,
  AgentToolResult,
  StreamFn,
} from './agent-types';

// ============ 适配层自有类型 ============

/** 工具执行模式 */
export type ToolExecutionMode = 'sequential' | 'parallel';

/**
 * Agent Runtime 配置
 */
export interface AgentRuntimeConfig {
  /** 是否启用 Agent 运行时 */
  enabled: boolean;
  /** 工具执行策略 */
  toolExecution?: ToolExecutionMode;
  /** agentLoop 最大轮次（防止无限循环） */
  maxTurns?: number;
  /** 推理级别 */
  thinkingLevel?: string;
}

/**
 * Agent 适配器选项
 */
export interface AgentAdapterOptions {
  /** Agent 唯一标识 */
  agentId: string;
  /** 显示名称 */
  displayName: string;
  /** 声明的能力列表 */
  capabilities: Capability[];
  /** 运行时配置 */
  runtimeConfig?: Partial<AgentRuntimeConfig>;
  /**
   * 将 Capability 转换为 AgentTool 的工厂函数
   */
  toolFactory?: (capability: Capability) => AgentTool[];
}

/**
 * 子任务执行上下文
 */
export interface SubTaskExecutionContext {
  /** 原始子任务 */
  subTask: SubTask;
  /** 执行请求 */
  request: AgentExecuteRequest;
  /** 上游任务结果（已转换为消息格式） */
  upstreamContext?: string[];
}

/**
 * Agent 生命周期事件（适配层自定义）
 *
 * 桥接 AgentEvent 与 zapmyco eventBus 的中间类型。
 */
export type AdaptedAgentEvent =
  | { type: 'agent:start'; taskId: string; agentId: string }
  | { type: 'agent:end'; taskId: string; agentId: string }
  | { type: 'turn:start'; taskId: string }
  | { type: 'turn:end'; taskId: string }
  | {
      type: 'message:start';
      taskId: string;
      textPreview: string;
    }
  | { type: 'message:update'; taskId: string; delta: string }
  | { type: 'message:end'; taskId: string; fullMessage: string }
  | {
      type: 'tool:start';
      taskId: string;
      toolName: string;
      toolCallId: string;
      args: unknown;
    }
  | {
      type: 'tool:update';
      taskId: string;
      toolName: string;
    }
  | {
      type: 'tool:end';
      taskId: string;
      toolName: string;
      toolCallId: string;
      success: boolean;
    }
  | { type: 'error'; taskId: string; error: Error };
