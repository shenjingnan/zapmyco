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
  /** 审计配置 */
  audit?: {
    /** 是否启用审计日志（默认 true） */
    enabled?: boolean;
    /** 审计级别（默认 'normal'） */
    level?: 'silent' | 'normal' | 'verbose';
  };
  /** Agent 级别安全覆盖（优先级高于全局配置） */
  agentOverrides?: Record<string, AgentSecurityOverride>;
  /** 密钥脱敏配置 */
  secretRedaction?: SecretRedactionConfig;
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
  /** 工具/技能的详细描述（用于在审批对话框中展示给用户） */
  description?: string;
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

// ============ 审计日志（Phase 2）============

/** 审计日志级别 */
export type AuditLevel = 'silent' | 'normal' | 'verbose';

/** 审计事件动作 */
export type AuditAction =
  | 'BLOCK'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_DENIED'
  | 'ALLOW'
  | 'VIOLATION'
  | 'DOOM_LOOP'
  | 'SKILL_THREAT'
  | 'EXECUTED';

/** 单条审计日志条目（JSONL 格式） */
export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  action: AuditAction;
  toolId: string;
  risk?: string;
  reason?: string;
  matchedRule?: string;
  /** 已脱敏的参数 */
  params?: Record<string, unknown>;
  scope?: string;
  metadata?: Record<string, unknown>;
  /** 关联 LLM 工具调用 ID */
  toolCallId?: string;
  /** 执行耗时（毫秒） */
  durationMs?: number;
  /** 结果摘要（截断至 500 字符） */
  result?: string;
  /** 是否执行成功 */
  success?: boolean;
  /** 执行操作的 agentId */
  agentId?: string;
}

// ============ 密钥脱敏（Phase 2）============

/** 密钥脱敏配置 */
export interface SecretRedactionConfig {
  enabled: boolean;
  /** 额外的自定义 regex 模式 */
  extraPatterns?: string[];
  /** 替换占位符（默认 '****REDACTED****'） */
  placeholder?: string;
}

// ============ Skill 守卫（Phase 2）============

/** Skill 威胁等级 */
export type SkillThreatLevel = 'safe' | 'warning' | 'danger';

/** Skill 守卫检测规则 */
export interface SkillGuardRule {
  id: string;
  description: string;
  threatLevel: SkillThreatLevel;
  /** 检测函数，返回 null 表示无威胁，返回字符串表示威胁原因 */
  check: (frontmatter: Record<string, unknown>, body: string) => string | null;
}

/** Skill 守卫扫描结果 */
export interface SkillGuardResult {
  skillName: string;
  skillPath: string;
  threatLevel: SkillThreatLevel;
  violations: Array<{ ruleId: string; reason: string; threatLevel: SkillThreatLevel }>;
  passed: boolean;
}

// ============ 沙箱（Phase 2）============

/** 沙箱后端类型（Docker backend 延后到 Phase 3） */
export type SandboxBackend = 'docker' | 'bubblewrap' | 'none';

/** 沙箱文件系统挂载配置 */
export interface SandboxMountConfig {
  projectMount: 'readonly' | 'readwrite' | 'none';
  blockedHostPaths: string[];
}

/** 沙箱网络配置 */
export interface SandboxNetworkConfig {
  mode: 'none' | 'restricted';
  allowedDomains?: string[];
}

/** 沙箱配置 */
export interface SandboxConfig {
  enabled: boolean;
  backend: SandboxBackend;
  filesystem: SandboxMountConfig;
  network: SandboxNetworkConfig;
  maxLifetimeSec: number;
}

/** 沙箱策略违规 */
export interface SandboxPolicyViolation {
  field: string;
  reason: string;
  severity: 'error' | 'warning';
}

// ============ Agent 级别覆盖（Phase 2）============

/** Per-agent 安全配置覆盖（所有字段可选，仅覆盖非 undefined 的字段） */
export type AgentSecurityOverride = Partial<
  Pick<SecurityConfig, 'mode' | 'denyRules' | 'allowRules' | 'defaultAction'>
>;

// ============ 安全健康报告（Phase 2）============

/** 安全健康报告（供 /audit 命令使用） */
export interface SecurityHealthReport {
  overallScore: number;
  scores: {
    permissions: number;
    shell: number;
    filesystem: number;
    ssrf: number;
    secrets: number;
    sandbox: number;
  };
  recentBlocks: Array<{
    toolId: string;
    reason: string;
    timestamp: string;
  }>;
  stats: {
    totalDecisions: number;
    blockedCount: number;
    approvedCount: number;
    deniedCount: number;
    doomLoopTriggers: number;
  };
  recommendations: string[];
}
