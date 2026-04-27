/**
 * 进度聚合器类型定义
 *
 * 实时收集各 Agent 的进度事件，统一推送给 UI 层。
 */

/** 进度事件类型 */
export type ProgressEventType =
  | 'task:started'
  | 'task:progress' // 进度更新（百分比）
  | 'task:output' // 文本输出（日志流）
  | 'task:completed'
  | 'task:failed'
  | 'task:retrying';

/** 进度事件载荷 */
export interface ProgressPayload {
  /** 当前进度 0-100 */
  percent?: number;
  /** 当前步骤描述 */
  message?: string;
  /** 流式文本片段 */
  textChunk?: string;
  /** 错误信息 */
  error?: string;
  /** 制品引用（如 PR URL） */
  artifactUrl?: string;
}

/**
 * 进度事件
 *
 * Agent 在执行过程中发出的结构化进度信息。
 */
export interface ProgressEvent {
  /** 事件 ID */
  eventId: string;
  /** 关联的任务 ID */
  taskId: string;
  /** 关联的 Agent ID */
  agentId: string;
  /** 事件类型 */
  type: ProgressEventType;
  /** 事件时间戳 */
  timestamp: number;
  /** 事件载荷 */
  payload: ProgressPayload;
}
