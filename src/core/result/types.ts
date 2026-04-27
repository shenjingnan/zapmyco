/**
 * 结果整合器类型定义
 *
 * 定义 Agent 执行结果的数据结构和最终输出格式。
 */

/** 制品类型 */
export type ArtifactType = 'pull-request' | 'file' | 'report' | 'comment' | 'url';

/**
 * 制品（Agent 执行产生的有价值的产出）
 *
 * 例如：创建的 PR、生成的文件、分析报告等。
 */
export interface Artifact {
  /** 制品类型 */
  type: ArtifactType;
  /** 制品引用（URL 或文件路径） */
  reference: string;
  /** 制品描述 */
  description: string;
}

/** Token 使用量统计 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 估算成本（美元） */
  estimatedCostUsd: number;
}

/** 任务错误信息 */
export interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * 单个子任务的执行结果
 *
 * 每个 Agent 完成任务后返回此对象。
 */
export interface TaskResult {
  /** 任务 ID */
  taskId: string;
  /** 执行状态 */
  status: 'success' | 'failure' | 'partial';
  /** 结构化输出 */
  output: unknown;
  /** 产生的制品列表 */
  artifacts: Artifact[];
  /** 执行耗时（毫秒） */
  duration: number;
  /** Token 消耗统计 */
  tokenUsage: TokenUsage;
  /** 错误信息（如果失败） */
  error?: TaskError;
}

/**
 * 最终整合结果
 *
 * 结果整合器将所有子任务的 TaskResult 合并为用户可理解的最终输出。
 */
export interface FinalResult {
  /** 关联的 Goal ID */
  goalId: string;
  /** 整体状态 */
  overallStatus: 'success' | 'partial-failure' | 'failure';
  /** 人类可读的摘要（LLM 生成或模板化拼接） */
  summary: string;
  /** 各子任务结果 */
  taskResults: TaskResult[];
  /** 所有制品汇总 */
  allArtifacts: Artifact[];
  /** 总耗时（毫秒） */
  totalDuration: number;
  /** 总 Token 消耗 */
  totalTokenUsage: TokenUsage;
  /** 后续建议操作 */
  nextSteps?: string[];
}
