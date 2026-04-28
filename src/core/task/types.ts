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
  result?: import('../result/types.js').TaskResult;
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
