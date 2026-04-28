/**
 * Zapmyco Agent Protocol v1.0
 *
 * 所有 Agent 必须实现的统一接口。
 * 协议采用 "请求-响应 + 流式回调" 双通道模式。
 */

import type { EventEmitter } from 'node:events';
import type { Capability } from './capability.js';

// ============ 导出类型 ============

export type {
  ProgressEvent,
  ProgressEventType,
  ProgressPayload,
} from '@/core/aggregator/types';

export type {
  Goal,
  GoalConstraints,
  GoalType,
  ProjectContext,
} from '@/core/intent/types';
export type {
  Artifact,
  FinalResult,
  TaskResult,
  TokenUsage,
} from '@/core/result/types';
export type {
  SubTask,
  TaskGraph,
  TaskStatus,
} from '@/core/task/types';
export type {
  AgentRegistration,
  AgentRegistrationStatus,
  Capability,
  CapabilityCategory,
} from './capability.js';

// ============ Agent 接口 ============

/** Agent 执行选项 */
export interface AgentExecuteOptions {
  /** 超时时间（毫秒） */
  timeout: number;
  /** 是否启用详细日志 */
  verbose: boolean;
  /** 自定义参数 */
  params?: Record<string, unknown>;
}

/** Agent 执行请求 */
export interface AgentExecuteRequest {
  /** 任务 ID */
  taskId: string;
  /** 任务描述（来自 TaskDecomposer 的具体指令） */
  taskDescription: string;
  /** 上游任务的结果（作为上下文，有依赖时传入） */
  upstreamResults?: import('@/core/result/types').TaskResult[];
  /** 项目工作目录 */
  workdir: string;
  /** 执行配置 */
  options: AgentExecuteOptions;
}

/** Agent 状态 */
export type AgentStatus = 'online' | 'offline' | 'busy' | 'degraded';

/** 健康检查结果 */
export interface AgentHealthStatus {
  是否健康: boolean;
  latencyMs: number;
  version: string;
  details?: Record<string, unknown>;
}

/**
 * Agent 统一接口 -- 所有 Agent 的契约
 */
export interface IAgent {
  readonly agentId: string;
  readonly displayName: string;
  readonly capabilities: readonly Capability[];
  readonly status: AgentStatus;
  readonly currentLoad: number;

  execute(request: AgentExecuteRequest): Promise<import('@/core/result/types').TaskResult>;

  cancel(taskId: string): Promise<void>;

  healthCheck(): Promise<AgentHealthStatus>;
}

/**
 * 支持流式事件的 Agent 接口（推荐实现）
 */
export interface IStreamingAgent extends IAgent, EventEmitter {
  readonly EVENT_PROGRESS: 'progress';
  readonly EVENT_OUTPUT: 'output';
  readonly EVENT_ERROR: 'error';
}
