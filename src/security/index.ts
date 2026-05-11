/**
 * zapmyco Security 模块
 *
 * 权限/安全框架核心，提供完整的工具访问控制能力。
 *
 * @module security
 */

// 审批
export { ApprovalManager } from './approval-manager';
// 常量
export {
  BUILTIN_DENY_RULES,
  MODE_STRATEGIES,
  RISK_DEFAULT_ACTIONS,
  TOOL_RISK_MAP,
} from './constants';
export type { ResolvedPermissionConfig } from './permission-config';

// 配置
export { matchParamPatterns, matchToolPattern, resolveConfig } from './permission-config';
export type { ToolInfoResolver, ToolSecurityInfo } from './permission-engine';
// 引擎
export { PermissionEngine } from './permission-engine';
// 存储
export { PermissionStore } from './permission-store';
// 守卫
export { createToolInfoResolver, SecurityBlockedError, ToolGuard } from './tool-guard';
// 类型
// 从 tool-bridge 重导出的类型
export type {
  ApprovalProvider,
  ApprovalRequest,
  ApprovalResponse,
  ApprovalScope,
  PermissionCheckFn,
  PermissionCheckResult,
  PermissionMode,
  PermissionRule,
  RiskLevel,
  SecurityAction,
  SecurityConfig,
  SecurityDecision,
} from './types';
