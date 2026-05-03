/**
 * 定时任务（Cron）系统类型定义
 *
 * 参考 Claude Code 的 CronTask 类型和 OpenClaw 的 CronJob 设计，
 * 结合 zapmyco CLI 工具的特性做简化。
 *
 * @module cli/repl/cron/types
 */

// ============ CronJob ============

/** 调度任务定义 */
export interface CronJob {
  /** 唯一标识（8 位 hex 随机数） */
  id: string;

  /** 5-field cron 表达式: "minute hour day-of-month month day-of-week" */
  cron: string;

  /** 触发时发送给 Agent 的 prompt */
  prompt: string;

  /** 创建时间戳（毫秒） */
  createdAt: number;

  /** 上次触发时间戳（毫秒），未触发过为 undefined */
  lastFiredAt?: number;

  /** 上次执行错误信息 */
  lastError?: string;

  /** 是否循环执行（false = 一次性触发后自动删除） */
  recurring: boolean;

  /** 是否持久化到文件（false = 仅内存，会话结束即消失） */
  durable: boolean;

  /** 是否启用（可被 pause/resume 控制） */
  enabled: boolean;

  /** 已触发次数 */
  fireCount: number;

  /** 执行次数上限（不设置则无限制，recurring=false 时自动为 1） */
  maxFires?: number;
}

// ============ 工具参数 ============

export type CronAction =
  | 'create'
  | 'list'
  | 'update'
  | 'remove'
  | 'pause'
  | 'resume'
  | 'run'
  | 'status';

export interface CronToolParams {
  action: CronAction;
  // create/update 参数
  cron?: string;
  prompt?: string;
  recurring?: boolean;
  durable?: boolean;
  max_fires?: number;
  // update/remove/pause/resume/run 参数
  job_id?: string;
  // update 参数
  enabled?: boolean;
  new_cron?: string;
  new_prompt?: string;
}

// ============ 调度器状态 ============

export interface SchedulerStatus {
  /** 调度器是否在运行 */
  running: boolean;
  /** 总任务数 */
  jobCount: number;
  /** 启用的任务数 */
  enabledCount: number;
  /** durable 任务数 */
  durableCount: number;
  /** 会话级（仅内存）任务数 */
  sessionCount: number;
}

// ============ 常量 ============

export const CRON_CONSTANTS = {
  /** 最大任务数 */
  MAX_JOBS: 50,
  /** prompt 最大长度 */
  MAX_PROMPT_LENGTH: 2000,
  /** 调度检查间隔（毫秒） */
  CHECK_INTERVAL_MS: 1000,
  /** recurring 任务自动过期天数 */
  AUTO_EXPIRE_DAYS: 7,
  /** 最大过期天数上限 */
  MAX_AUTO_EXPIRE_DAYS: 30,
  /** 一次性错过任务最多补发次数 */
  MAX_ONESHOT_MISSED_FIRE_COUNT: 5,
  /** 补发任务间隔（毫秒） */
  MISSED_FIRE_STAGGER_MS: 5000,
} as const;
