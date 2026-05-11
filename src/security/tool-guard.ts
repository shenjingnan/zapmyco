/**
 * 工具守卫 — 代理模式包装 ToolRegistration
 *
 * 为每个 ToolRegistration 的 execute 函数添加安全管道：
 *   1. PermissionEngine.evaluate() → 获取安全决策
 *   2. DENY → 抛出 SecurityBlockedError
 *   3. ASK → ApprovalManager.requestApproval()
 *   4. ALLOW → 执行原 execute()
 *
 * 代理模式：保留原 ToolRegistration 所有属性，
 * 仅替换 execute 函数为带安全检查的版本。
 *
 * @module security/tool-guard
 */

import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { ToolExecuteFn, ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import { eventBus } from '@/infra/event-bus';
import { logger } from '@/infra/logger';
import type { ApprovalManager } from './approval-manager';
import type { PermissionEngine, ToolInfoResolver } from './permission-engine';
import type { PermissionStore } from './permission-store';

const log = logger.child('tool-guard');

// ============ SecurityBlockedError ============

/**
 * 安全阻止错误
 *
 * 当工具调用被权限引擎拒绝时抛出。
 * 调用方（agent-adapter / session）应捕获此错误
 * 并转换为 LLM 友好的错误反馈。
 */
export class SecurityBlockedError extends Error {
  public readonly toolId: string;
  public readonly risk: string;
  public readonly reason: string | undefined;

  constructor(message: string, toolId: string, risk: string, reason: string | undefined) {
    super(message);
    this.name = 'SecurityBlockedError';
    this.toolId = toolId;
    this.risk = risk;
    this.reason = reason;
  }
}

// ============ ToolGuard ============

export class ToolGuard {
  private engine: PermissionEngine;
  private approvalManager: ApprovalManager;
  private store: PermissionStore;
  private sessionId: string;

  constructor(
    engine: PermissionEngine,
    approvalManager: ApprovalManager,
    store: PermissionStore,
    sessionId?: string
  ) {
    this.engine = engine;
    this.approvalManager = approvalManager;
    this.store = store;
    this.sessionId = sessionId ?? `session-${Date.now()}`;
  }

  /**
   * 包装单个 ToolRegistration
   *
   * 返回新 ToolRegistration，原对象不变。
   * execute 被替换为带安全检查的版本。
   */
  wrap(registration: ToolRegistration): ToolRegistration {
    const originalExecute = registration.execute;
    const toolId = registration.id;
    const toolLabel = registration.label;

    const guardedExecute: ToolExecuteFn = async (
      toolCallId,
      params,
      signal?,
      onUpdate?
    ): Promise<AgentToolResult<unknown>> => {
      // Step 1: 评估权限
      const decision = this.engine.evaluate(toolId, params as Record<string, unknown>);

      // Step 2: DENY → 阻止
      if (decision.action === 'deny') {
        const reason = decision.reason ?? `工具 ${toolId} 已被安全策略阻止`;
        log.warn('工具调用被阻止', { toolId, risk: decision.risk, reason });

        eventBus.emit('security:blocked', {
          toolId,
          risk: decision.risk,
          reason,
          params: params as Record<string, unknown>,
        });

        throw new SecurityBlockedError(reason, toolId, decision.risk, reason);
      }

      // Step 3: ASK → 请求审批
      if (decision.action === 'ask') {
        const approvalResponse = await this.approvalManager.requestApproval({
          toolId,
          toolLabel,
          params: params as Record<string, unknown>,
          risk: decision.risk,
          reason: decision.reason ?? `工具 ${toolId} 需要审批`,
          sessionId: this.sessionId,
        });

        if (!approvalResponse.approved) {
          const reason = `用户拒绝了工具 ${toolId} 的执行请求`;
          log.info('用户拒绝工具执行', { toolId });

          throw new SecurityBlockedError(reason, toolId, decision.risk, reason);
        }

        // 根据审批范围存储决策
        if (approvalResponse.scope === 'session') {
          this.store.addSessionApproval(toolId);
        } else if (approvalResponse.scope === 'always') {
          this.store.addPersistentApproval(toolId);
        }

        log.debug('审批通过，执行工具', { toolId, scope: approvalResponse.scope });
      }

      // Step 4: 执行原工具
      return originalExecute(toolCallId, params, signal, onUpdate);
    };

    return {
      ...registration,
      execute: guardedExecute,
    };
  }

  /**
   * 批量包装所有工具
   */
  wrapAll(registrations: ToolRegistration[]): ToolRegistration[] {
    return registrations.map((reg) => this.wrap(reg));
  }
}

// ============ 工具函数 ============

/**
 * 从 ToolRegistration 数组构建 ToolInfoResolver
 *
 * 供 PermissionEngine 使用，将 toolId 映射到其安全信息。
 */
export function createToolInfoResolver(registrations: ToolRegistration[]): ToolInfoResolver {
  const map = new Map<string, ToolRegistration>();
  for (const reg of registrations) {
    map.set(reg.id, reg);
  }

  return (toolId: string) => {
    const reg = map.get(toolId);
    if (!reg) return undefined;
    return {
      checkPermission: reg.checkPermission,
      defaultRisk: reg.defaultRisk,
    };
  };
}
