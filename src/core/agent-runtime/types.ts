/**
 * Agent Runtime 适配层类型定义
 *
 * 本层作为 zapmyco 核心抽象与 pi-agent-core 之间的隔离边界。
 * 所有 pi-agent-core 的类型依赖都限制在此文件内，不向外暴露。
 *
 * @module core/agent-runtime
 */

import type { Static, TSchema } from 'typebox';
import type { SubTask } from '@/core/task/types';
import type { AgentExecuteRequest } from '@/protocol/agent';
import type { Capability } from '@/protocol/capability';

// ============ pi-agent-core 类型导入（仅限本文件使用） ============

import type {
  AgentEvent,
  AgentOptions,
  AgentState,
  AgentTool,
  Agent as PiAgent,
} from '@mariozechner/pi-agent-core';

/** 重新导出供适配层内部使用（不通过 index.ts 暴露） */
export type { AgentEvent, AgentOptions, AgentState, AgentTool, PiAgent, Static, TSchema };

// ============ 适配层自有类型 ============

/** 工具执行模式 */
export type ToolExecutionMode = 'sequential' | 'parallel';

/**
 * Agent Runtime 配置
 *
 * 控制基于 pi-agent-core 的 Agent 运行时行为。
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
 *
 * 创建 LlmBasedAgent 实例时的配置。
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
   *
   * 每个 Capability 可以映射为一个或多个可执行工具。
   */
  toolFactory?: (capability: Capability) => AgentTool[];
}

/**
 * 子任务执行上下文
 *
 * 将 zapmyco 的 SubTask + AgentExecuteRequest 转换为
 * pi-agent-core Agent 可消费的格式。
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
 * 桥接 pi-agent-core AgentEvent 与 zapmyco eventBus 的中间类型。
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
