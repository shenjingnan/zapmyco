/**
 * zapmyco Security 模块
 *
 * 权限/安全框架核心，提供完整的工具访问控制能力。
 *
 * @module security
 */

// 审批
export { ApprovalManager } from './approval-manager';
// 审计（Phase 2）
export { AuditLogger } from './audit-logger';
// 常量
export {
  BUILTIN_DENY_RULES,
  MODE_STRATEGIES,
  RISK_DEFAULT_ACTIONS,
  TOOL_RISK_MAP,
} from './constants';
// 循环检测 (Phase 0)
export {
  createDoomLoopDetector,
  type DoomLoopConfig,
  DoomLoopDetector,
  type DoomLoopResult,
} from './doom-loop-detector';
export type { ResolvedPermissionConfig } from './permission-config';

// 配置
export {
  extractAgentConfig,
  matchParamPatterns,
  matchToolPattern,
  resolveConfig,
  resolveConfigWithAgent,
} from './permission-config';
export type { ToolInfoResolver, ToolSecurityInfo } from './permission-engine';
// 引擎
export { PermissionEngine } from './permission-engine';
// 存储
export { PermissionStore } from './permission-store';
// 沙箱策略（Phase 2）
export { validateSandboxPolicy } from './sandbox/policy-validator';
// 密钥脱敏（Phase 2）
export { SecretRedactor } from './secret-redaction';
// Skill 守卫（Phase 2）
export { SkillGuard } from './skill-guard';
// 守卫
export { createToolInfoResolver, SecurityBlockedError, ToolGuard } from './tool-guard';
// 类型
// 从 tool-bridge 重导出的类型
// Phase 2 新增类型
export type {
  AgentSecurityOverride,
  ApprovalProvider,
  ApprovalRequest,
  ApprovalResponse,
  ApprovalScope,
  AuditEntry,
  AuditLevel,
  PermissionCheckFn,
  PermissionCheckResult,
  PermissionMode,
  PermissionRule,
  RiskLevel,
  SandboxConfig,
  SandboxPolicyViolation,
  SecretRedactionConfig,
  SecurityAction,
  SecurityConfig,
  SecurityDecision,
  SecurityHealthReport,
  SkillGuardResult,
  SkillThreatLevel,
} from './types';
