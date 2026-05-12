/**
 * Security 模块内置常量
 *
 * 定义不可被用户覆盖的 deny 规则、风险等级默认动作、
 * 权限模式策略、以及各工具的默认风险等级映射。
 *
 * @module security/constants
 */

import type { PermissionMode, SecurityAction } from './types';

// ============ 内置 Deny 规则（始终生效，不可被 override）============

// 当前无内置 deny 规则，SpawnSubAgents 的审批由风险等级机制处理。
// 此列表为未来扩展预留，例如阻止直接访问系统工具等场景。
export const BUILTIN_DENY_RULES: Array<{
  toolPattern: string;
  reason: string;
}> = [];

// ============ 风险等级 → 默认动作 ============

/** 各风险等级的默认安全动作 */
export const RISK_DEFAULT_ACTIONS: Record<string, SecurityAction> = {
  low: 'allow',
  medium: 'ask',
  high: 'ask',
  critical: 'deny',
};

// ============ 权限模式策略 ============

/** 各权限模式的行为策略 */
export const MODE_STRATEGIES: Record<
  PermissionMode,
  { defaultAction: SecurityAction; maxAutoAllow: string }
> = {
  /** strict: 只允许 low risk，其余全部 deny */
  strict: { defaultAction: 'deny', maxAutoAllow: 'low' },
  /** normal: low 直接 allow，medium+ 需要 ask，critical deny */
  normal: { defaultAction: 'ask', maxAutoAllow: 'low' },
  /** permissive: low/medium 直接 allow，high ask，critical deny */
  permissive: { defaultAction: 'allow', maxAutoAllow: 'medium' },
};

// ============ 工具默认风险等级 ============

/**
 * 各工具的默认风险等级
 *
 * 工具未设置 checkPermission 时，PermissionEngine 使用此映射确定风险等级。
 * 如果工具不在此映射中，默认使用 'medium'。
 */
export const TOOL_RISK_MAP: Record<string, string> = {
  // ---- 只读工具 ----
  GetCurrentTime: 'low',
  GetWorkdirInfo: 'low',
  ReadFile: 'low',
  Glob: 'low',
  Grep: 'low',

  // ---- Web 工具（有 SSRF 风险）----
  WebFetch: 'medium',
  WebSearch: 'medium',

  // ---- 文件写入工具 ----
  WriteFile: 'medium',
  EditFile: 'medium',

  // ---- Shell 执行 ----
  Exec: 'medium',
  Process: 'medium',

  // ---- 系统工具 ----
  Memory: 'medium',
  Skill: 'medium',
  TaskManage: 'medium',
  ScheduledTask: 'medium',

  // ---- LSP 代码智能（只读分析）----
  LSP: 'low',

  // ---- 子代理（最高风险）----
  SpawnSubAgents: 'high',
};
