/**
 * Security 模块类型定义
 *
 * 定义权限系统的核心类型：配置、决策、审批请求/响应。
 * 从 tool-bridge.ts 重导出 PermissionCheckFn、PermissionCheckResult、RiskLevel。
 *
 * @module security/types
 */

// ============ 从 tool-bridge 重导出（不重复定义）============

export type {
  PermissionCheckFn,
  PermissionCheckResult,
  RiskLevel,
} from '@/core/agent-runtime/tool-bridge';

import type { RiskLevel } from '@/core/agent-runtime/tool-bridge';

// ============ 权限模式 ============

/** 权限模式：strict（严格）/ normal（标准）/ permissive（宽松） */
export type PermissionMode = 'strict' | 'normal' | 'permissive';

// ============ 权限规则 ============

/** 单条权限规则 */
export interface PermissionRule {
  /** 规则 ID（可选，用于日志和调试） */
  id?: string;
  /** 动作：allow / deny / ask */
  action: 'allow' | 'deny' | 'ask';
  /** 工具 ID 匹配模式（glob 风格：* 通配符，如 'Read*'、'*'） */
  toolPattern: string;
  /** 参数匹配（可选，所有键值对必须匹配才命中） */
  paramPatterns?: Record<string, string>;
  /** 最大自动允许的风险等级（默认依据 mode 策略） */
  maxRisk?: RiskLevel;
  /** 规则描述 */
  description?: string;
}

// ============ Security 配置 ============

/** 安全框架顶层配置 */
export interface SecurityConfig {
  /** 是否启用安全框架（默认 true） */
  enabled?: boolean;
  /** 权限模式（默认 'normal'） */
  mode?: PermissionMode;
  /** 全局拒绝规则（优先级最高，不可被 override） */
  denyRules?: PermissionRule[];
  /** 全局允许规则 */
  allowRules?: PermissionRule[];
  /** 所有规则未命中时的默认动作（默认 'ask'） */
  defaultAction?: 'allow' | 'deny' | 'ask';
  /** 持久化配置 */
  persistence?: {
    /** 是否启用持久化（默认 true） */
    enabled?: boolean;
    /** 最大条目数（默认 500） */
    maxEntries?: number;
    /** 过期天数（默认 30） */
    expireAfterDays?: number;
  };
  /** 审计配置（Phase 2 实施） */
  audit?: {
    /** 是否启用审计日志（默认 true） */
    enabled?: boolean;
    /** 审计级别（默认 'normal'） */
    level?: 'silent' | 'normal' | 'verbose';
  };
}

// ============ 权限动作 ============

/** 安全动作：允许 / 拒绝 / 询问 */
export type SecurityAction = 'allow' | 'deny' | 'ask';

// ============ 安全决策 ============

/** 权限引擎评估后的安全决策 */
export interface SecurityDecision {
  /** 最终动作 */
  action: SecurityAction;
  /** 关联风险等级 */
  risk: RiskLevel;
  /** 原因描述 */
  reason?: string;
  /** 命中的规则 ID（用于审计） */
  matchedRule?: string;
  /** 是否需要审批（action === 'ask' 时为 true） */
  requiresApproval: boolean;
}

// ============ 审批流 ============

/** 审批请求 */
export interface ApprovalRequest {
  /** 工具 ID */
  toolId: string;
  /** 工具显示名称 */
  toolLabel: string;
  /** 调用参数（用于展示） */
  params: Record<string, unknown>;
  /** 风险等级 */
  risk: RiskLevel;
  /** 审批原因 */
  reason: string;
  /** 会话 ID */
  sessionId: string;
}

/** 审批范围 */
export type ApprovalScope = 'once' | 'session' | 'always';

/** 审批响应 */
export interface ApprovalResponse {
  /** 是否批准 */
  approved: boolean;
  /** 批准范围（仅 approved 时有效） */
  scope?: ApprovalScope;
}

/**
 * 审批提供者接口
 *
 * 由 TUI 层实现，注入到 ApprovalManager。
 * 在 headless 模式下可注入一个总是拒绝的 mock provider。
 */
export interface ApprovalProvider {
  /** 请求用户审批，返回审批结果 */
  requestApproval(request: ApprovalRequest): Promise<ApprovalResponse>;
}
