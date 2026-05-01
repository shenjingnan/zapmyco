/**
 * Shell 执行工具共享类型定义
 *
 * @module cli/repl/tools/shell-types
 */

// ============ exec 参数与返回类型 ============

/** exec 工具参数 */
export interface ExecParams {
  /** 要执行的 shell 命令 */
  command: string;
  /** 工作目录（默认项目根目录） */
  workdir?: string;
  /** 超时时间（秒），默认 180，最大 600 */
  timeout?: number;
  /** 是否后台运行 */
  background?: boolean;
  /** PTY 模式（交互式命令） */
  pty?: boolean;
}

/** exec 执行状态 */
export type ExecStatus =
  | 'completed'
  | 'failed'
  | 'running'
  | 'timeout'
  | 'killed'
  | 'blocked'
  | 'approval_required'
  | 'error';

/** exec 执行详情 */
export interface ExecDetails {
  command: string;
  status: ExecStatus;
  exitCode?: number | null;
  signal?: string | null;
  durationMs: number;
  workdir?: string;
  pid?: number;
  sessionId?: string;
}

// ============ Process Registry 类型 ============

/** 后台进程状态 */
export type ProcessStatus = 'running' | 'exited' | 'killed' | 'timeout' | 'errored';

/** 后台进程会话 */
export interface ProcessSession {
  sessionId: string;
  command: string;
  pid: number;
  status: ProcessStatus;
  startTime: number;
  endTime?: number;
  exitCode?: number | null;
  signal?: string | null;
  workdir?: string;
}

/** process 工具 action 参数 */
export type ProcessAction = 'list' | 'poll' | 'log' | 'wait' | 'kill' | 'write' | 'submit';

/** process 工具参数 */
export interface ProcessParams {
  /** 操作类型 */
  action: ProcessAction;
  /** 进程 session ID（除 list 外必需） */
  sessionId?: string;
  /** write/submit 时写入的数据 */
  data?: string;
  /** log 时的偏移量 */
  offset?: number;
  /** log 时的最大行数 */
  limit?: number;
  /** wait 时的超时（毫秒） */
  waitTimeout?: number;
}

/** process 执行详情 */
export interface ProcessDetails {
  action: ProcessAction;
  sessionId?: string;
  sessions?: ProcessSession[];
  processCount?: number;
}

// ============ 安全检查类型 ============

/** 安全检查结果 */
export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  /** 是否被硬性阻断 */
  blocked?: boolean;
  /** 是否需要审批 */
  requiresApproval?: boolean;
  /** 风险等级 */
  risk?: 'low' | 'medium' | 'high' | 'critical';
  /** 匹配的阻断规则 */
  matchedRule?: string;
}

/** 阻断规则 */
export interface BlockRule {
  /** 规则名称 */
  name: string;
  /** 匹配模式（正则） */
  pattern: RegExp;
  /** 风险等级 */
  risk: 'critical' | 'high';
  /** 阻断原因描述 */
  reason: string;
}

/** 审批规则 */
export interface ApprovalRule {
  /** 规则名称 */
  name: string;
  /** 匹配模式（正则） */
  pattern: RegExp;
  /** 风险等级 */
  risk: 'medium' | 'high';
  /** 审批提示信息 */
  message: string;
}
