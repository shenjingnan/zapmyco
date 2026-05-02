/**
 * 任务拆分器类型定义
 *
 * 将一个 Goal 拆分为多个可并行的 SubTask，组成 DAG（有向无环图）。
 */

import type { Capability } from '@/protocol/capability';

/** 子任务状态 */
export type TaskStatus =
  | 'pending' // 等待中
  | 'ready' // 就绪（依赖已满足）
  | 'running' // 执行中
  | 'succeeded' // 成功
  | 'failed' // 失败
  | 'skipped' // 跳过
  | 'cancelled'; // 已取消

/**
 * 子任务定义
 *
 * 任务拆分器的输出单元，代表一个可独立执行的原子工作。
 */
export interface SubTask {
  /** 任务 ID */
  id: string;
  /** 任务名称（简短，用于显示） */
  name: string;
  /** 任务详细描述（发给 Agent 的具体指令） */
  description: string;
  /** 所需的 Agent 能力 */
  requiredCapability: Capability;
  /** 依赖的任务 ID 列表 */
  dependencies: string[];
  /** 任务优先级（数值越小优先级越高） */
  priority: number;
  /** 预估 token 消耗（用于成本估算） */
  estimatedTokens?: number;
  /** 当前状态 */
  status: TaskStatus;
  /** 执行结果（完成后填充） */
  result?: import('@/core/result/types').TaskResult;
}

/**
 * 任务图（DAG）
 *
 * 描述子任务之间的依赖关系和执行拓扑。
 */
export interface TaskGraph {
  /** 图 ID（关联到 Goal） */
  goalId: string;
  /** 所有节点 */
  nodes: Map<string, SubTask>;
  /** 有向边：依赖关系（from 依赖 to） */
  edges: Array<{ from: string; to: string }>;
  /** 入口节点（无依赖的任务） */
  entryNodes: string[];
  /** 拓扑排序后的执行层级（同层可并行） */
  layers: string[][];
}

// ============ Agent 任务管理工具类型 ============

/** Agent 任务项状态 */
export type TaskItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Agent 任务项
 *
 * Agent 通过 task_manage 工具创建和维护的任务单元。
 * 与 SubTask 不同，TaskItem 是 Agent 面向用户的"任务跟踪层"，
 * 而 SubTask 是系统内部的"任务执行层"。
 */
export interface TaskItem {
  /** 任务唯一标识（Agent 自选，如 "1", "2", "search-files"） */
  id: string;
  /** 简短标题（祈使句，如 "搜索相关文件"） */
  subject: string;
  /** 详细描述（可选） */
  description?: string;
  /** 当前状态 */
  status: TaskItemStatus;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
  /** 依赖的任务 ID 列表（Phase 2 启用） */
  dependencies?: string[];
  /** 所有者 Agent ID（Phase 2 启用） */
  owner?: string;
}

/** task_manage 工具操作类型 */
export type TaskManageAction = 'read' | 'write' | 'update';

/** task_manage write/update 时传入的任务项 */
export interface TaskManageInputItem {
  id: string;
  subject: string;
  description?: string;
  status: TaskItemStatus;
}

/** task_manage 工具参数 */
export interface TaskManageParams {
  action: TaskManageAction;
  tasks?: TaskManageInputItem[];
  merge?: boolean;
}

/** task_manage 工具返回的任务摘要统计 */
export interface TaskManageSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
}

/** task_manage 工具返回详情 */
export interface TaskManageDetails {
  action: TaskManageAction;
  tasks: TaskItem[];
  summary: TaskManageSummary;
  error?: string;
}
