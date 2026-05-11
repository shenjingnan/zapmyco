/**
 * 权限评估引擎
 *
 * 实现 7 步评估级联，参考 claude-code 的权限决策流程。
 * 每一步都可能产生最终决策（DENY / ALLOW / ASK），
 * 后续步骤仅在前面未决出时执行。
 *
 * 级联顺序：
 *   1. 内置拒绝规则（BUILTIN_DENY_RULES，不可绕过）
 *   2. 用户拒绝规则（denyRules，模式匹配）
 *   3. 工具自身 checkPermission()（如 checkExecPermission）
 *   4. 用户允许规则（allowRules，模式匹配）
 *   5. 会话存储检查（"本次会话始终允许"）
 *   6. 持久化存储检查（"始终允许"）
 *   7. Mode 策略回退（根据 risk level + mode 决定）
 *
 * @module security/permission-engine
 */

import type {
  PermissionCheckFn,
  PermissionCheckResult,
  RiskLevel,
} from '@/core/agent-runtime/tool-bridge';
import { logger } from '@/infra/logger';
import { BUILTIN_DENY_RULES, TOOL_RISK_MAP } from './constants';
import type { ResolvedPermissionConfig } from './permission-config';
import { matchParamPatterns, matchToolPattern } from './permission-config';
import type { PermissionStore } from './permission-store';
import type { SecurityDecision } from './types';

const log = logger.child('permission-engine');

// ============ 工具信息解析器 ============

/** 工具安全信息（由 ToolGuard 注入） */
export interface ToolSecurityInfo {
  /** 权限检查函数 */
  checkPermission: PermissionCheckFn | undefined;
  /** 默认风险等级 */
  defaultRisk: RiskLevel | undefined;
}

/** 工具信息解析器：根据 toolId 返回安全信息 */
export type ToolInfoResolver = (toolId: string) => ToolSecurityInfo | undefined;

// ============ PermissionEngine ============

export class PermissionEngine {
  private config: ResolvedPermissionConfig;
  private store: PermissionStore;
  private resolveToolInfo: ToolInfoResolver;

  constructor(
    config: ResolvedPermissionConfig,
    store: PermissionStore,
    resolveToolInfo: ToolInfoResolver
  ) {
    this.config = config;
    this.store = store;
    this.resolveToolInfo = resolveToolInfo;
  }

  // ============ 核心方法 ============

  /**
   * 评估工具的权限决策
   *
   * @param toolId - 工具 ID
   * @param params - 工具调用参数
   * @returns 安全决策（allow / deny / ask）
   */
  evaluate(toolId: string, params: Record<string, unknown>): SecurityDecision {
    // 如果安全框架禁用，全部放行
    if (!this.config.enabled) {
      return { action: 'allow', risk: 'low', requiresApproval: false };
    }

    const toolInfo = this.resolveToolInfo(toolId);

    // ====== Step 1: 内置拒绝规则 ======
    for (const rule of BUILTIN_DENY_RULES) {
      if (matchToolPattern(rule.toolPattern, toolId)) {
        log.debug('命中内置拒绝规则', { toolId, rule: rule.toolPattern });
        return {
          action: 'deny',
          risk: 'critical',
          reason: rule.reason,
          matchedRule: `builtin:${rule.toolPattern}`,
          requiresApproval: false,
        };
      }
    }

    // ====== Step 2: 用户拒绝规则 ======
    for (const rule of this.config.denyRules) {
      if (
        matchToolPattern(rule.toolPattern, toolId) &&
        matchParamPatterns(rule.paramPatterns, params)
      ) {
        log.debug('命中用户拒绝规则', { toolId, ruleId: rule.id ?? rule.toolPattern });
        return {
          action: 'deny',
          risk: rule.maxRisk ?? 'critical',
          reason: rule.description ?? `工具 ${toolId} 被拒绝规则阻止`,
          matchedRule: rule.id ?? rule.toolPattern,
          requiresApproval: false,
        };
      }
    }

    // ====== Step 3: 工具自身 checkPermission() ======
    const toolCheckResult = this.runToolCheck(toolId, toolInfo, params);
    if (toolCheckResult) {
      const risk = toolCheckResult.risk;

      // critical 风险在所有非 permissive 模式下直接 deny（即使 requiresApproval）
      if (risk === 'critical' && this.config.mode !== 'permissive') {
        return {
          action: 'deny',
          risk,
          reason: toolCheckResult.reason ?? `工具 ${toolId} 风险等级为 critical，已被阻止`,
          requiresApproval: false,
        };
      }

      // 工具自身判定需要审批
      if (toolCheckResult.requiresApproval) {
        return {
          action: 'ask',
          risk,
          reason: toolCheckResult.reason ?? `工具 ${toolId} 需要审批`,
          requiresApproval: true,
        };
      }
    }

    // ====== Step 4: 用户允许规则 ======
    for (const rule of this.config.allowRules) {
      if (
        matchToolPattern(rule.toolPattern, toolId) &&
        matchParamPatterns(rule.paramPatterns, params)
      ) {
        log.debug('命中用户允许规则', { toolId, ruleId: rule.id ?? rule.toolPattern });
        return {
          action: 'allow',
          risk: rule.maxRisk ?? 'low',
          reason: rule.description ?? `工具 ${toolId} 被允许规则放行`,
          matchedRule: rule.id ?? rule.toolPattern,
          requiresApproval: false,
        };
      }
    }

    // ====== Step 5: 会话存储检查 ======
    if (this.store.hasSessionApproval(toolId)) {
      log.debug('命中会话级审批', { toolId });
      return { action: 'allow', risk: 'low', requiresApproval: false };
    }

    // ====== Step 6: 持久化存储检查 ======
    if (this.store.hasPersistentApproval(toolId)) {
      log.debug('命中持久化审批', { toolId });
      return { action: 'allow', risk: 'low', requiresApproval: false };
    }

    // ====== Step 7: Mode 策略回退 ======
    return this.evaluateByMode(toolId, toolInfo, toolCheckResult, params);
  }

  /**
   * 判断工具是否被拒绝（便捷方法）
   */
  isDenied(toolId: string, params: Record<string, unknown>): boolean {
    return this.evaluate(toolId, params).action === 'deny';
  }

  /**
   * 获取工具需要的动作（便捷方法）
   */
  getRequiredAction(toolId: string, params: Record<string, unknown>): SecurityDecision {
    return this.evaluate(toolId, params);
  }

  // ============ 配置热更新 ============

  /**
   * 更新配置（运行时热更新）
   */
  updateConfig(config: Partial<ResolvedPermissionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 更新工具信息解析器
   *
   * 在工具注册完成后调用，使 PermissionEngine 能够查询每个工具的安全信息。
   */
  setToolInfoResolver(resolver: ToolInfoResolver): void {
    this.resolveToolInfo = resolver;
  }

  // ============ 私有方法 ============

  /**
   * 执行工具自身的 checkPermission（如果存在）
   */
  private runToolCheck(
    toolId: string,
    toolInfo: ToolSecurityInfo | undefined,
    params: Record<string, unknown>
  ): PermissionCheckResult | null {
    if (!toolInfo?.checkPermission) return null;

    try {
      return toolInfo.checkPermission(params);
    } catch (err) {
      log.warn('工具 checkPermission 执行异常', {
        toolId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * 根据 mode 策略 + 风险等级决定最终动作
   */
  private evaluateByMode(
    toolId: string,
    toolInfo: ToolSecurityInfo | undefined,
    toolCheckResult: PermissionCheckResult | null,
    _params: Record<string, unknown>
  ): SecurityDecision {
    const strategy = this.config.modeStrategy;

    // 确定风险等级
    const risk = this.resolveRiskLevel(toolId, toolInfo, toolCheckResult);
    const defaultAction = this.config.defaultAction;

    // critical 在所有模式下都 deny（permissive 也不例外）
    if (risk === 'critical') {
      return {
        action: 'deny',
        risk,
        reason: `工具 ${toolId} 风险等级为 critical，已自动阻止`,
        requiresApproval: false,
      };
    }

    // 风险等级在 maxAutoAllow 范围内 → 直接允许
    if (this.riskLevelCompare(risk, strategy.maxAutoAllow) <= 0) {
      return { action: 'allow', risk, requiresApproval: false };
    }

    // 默认动作
    if (defaultAction === 'allow') {
      return { action: 'allow', risk, requiresApproval: false };
    }

    if (defaultAction === 'deny') {
      return {
        action: 'deny',
        risk,
        reason: `工具 ${toolId} 在 ${this.config.mode} 模式下被默认拒绝`,
        requiresApproval: false,
      };
    }

    // defaultAction === 'ask'
    return {
      action: 'ask',
      risk,
      reason: `工具 ${toolId} 风险等级为 ${risk}，需要用户审批`,
      requiresApproval: true,
    };
  }

  /**
   * 解析工具的风险等级
   *
   * 优先级: checkPermission 结果 > defaultRisk > TOOL_RISK_MAP > 'medium'
   */
  private resolveRiskLevel(
    toolId: string,
    toolInfo: ToolSecurityInfo | undefined,
    toolCheckResult: PermissionCheckResult | null
  ): RiskLevel {
    // 1. checkPermission 返回值
    if (toolCheckResult?.risk) return toolCheckResult.risk;

    // 2. ToolRegistration.defaultRisk
    if (toolInfo?.defaultRisk) return toolInfo.defaultRisk;

    // 3. TOOL_RISK_MAP 映射表
    const mapped = TOOL_RISK_MAP[toolId];
    if (mapped) return mapped as RiskLevel;

    // 4. 默认
    return 'medium';
  }

  /**
   * 风险等级比较
   *
   * @returns -1 (a < b), 0 (a == b), 1 (a > b)
   */
  private riskLevelCompare(a: string, b: string): number {
    const order: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    const aVal = order[a] ?? 2;
    const bVal = order[b] ?? 2;
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
    return 0;
  }
}
