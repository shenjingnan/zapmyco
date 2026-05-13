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
 * ## ToolGuardContext
 *
 * 通过 AsyncLocalStorage 传递运行时上下文，控制特殊场景下的行为：
 * - isBackgroundAgent: 后台 Agent 遇 ASK 自动降级为 DENY（无用户可交互）
 * - planMode: Plan Mode 下限制工具可用性
 * - worktreePath: 工作树上下文
 *
 * @module security/tool-guard
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentToolResult } from '@/core/agent-runtime/agent-types';
import type { ToolExecuteFn, ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import { eventBus } from '@/infra/event-bus';
import { logger } from '@/infra/logger';
import type { ApprovalManager } from './approval-manager';
import type { AuditLogger } from './audit-logger';
import type { PermissionEngine, ToolInfoResolver } from './permission-engine';
import type { PermissionStore } from './permission-store';

const log = logger.child('tool-guard');

// ============ ToolGuardContext ============

/**
 * 工具守卫运行时上下文
 *
 * 通过 AsyncLocalStorage 在整个工具调用链中传递。
 * 不同场景（后台 Agent / Plan Mode / Worktree）注入不同上下文。
 */
export interface ToolGuardContext {
  /** 是否为后台 Agent（后台不能弹交互式审批对话框） */
  isBackgroundAgent?: boolean;
  /** 是否处于计划模式（只读约束） */
  planMode?: boolean;
  /** 当前 worktree 路径 */
  worktreePath?: string;
}

const toolGuardCtxStore = new AsyncLocalStorage<ToolGuardContext>();

/**
 * 获取当前 ToolGuard 上下文
 */
export function getToolGuardContext(): ToolGuardContext | undefined {
  return toolGuardCtxStore.getStore();
}

/**
 * 在指定上下文中执行回调
 *
 * 用于在后台 Agent / Plan Mode 等场景下包装工具执行。
 */
export async function runWithToolGuardContext<T>(
  context: ToolGuardContext,
  fn: () => T | Promise<T>
): Promise<T> {
  return toolGuardCtxStore.run(context, fn);
}

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
  private auditLogger: AuditLogger | undefined;
  private _agentId: string | undefined;

  constructor(
    engine: PermissionEngine,
    approvalManager: ApprovalManager,
    store: PermissionStore,
    sessionId?: string,
    auditLogger?: AuditLogger,
    agentId?: string
  ) {
    this.engine = engine;
    this.approvalManager = approvalManager;
    this.store = store;
    this.sessionId = sessionId ?? `session-${Date.now()}`;
    this.auditLogger = auditLogger;
    this._agentId = agentId;
  }

  /** 获取或设置 agentId */
  get agentId(): string | undefined {
    return this._agentId;
  }

  set agentId(id: string | undefined) {
    this._agentId = id;
  }

  /** 结果摘要截断最大长度 */
  private static readonly RESULT_SUMMARY_MAX_LENGTH = 500;

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

        this.auditLogger?.log({
          action: 'BLOCK',
          toolId,
          risk: decision.risk,
          reason,
          params: params as Record<string, unknown>,
          ...(decision.matchedRule ? { matchedRule: decision.matchedRule } : {}),
        });

        throw new SecurityBlockedError(reason, toolId, decision.risk, reason);
      }

      // Step 3: ASK → 请求审批
      if (decision.action === 'ask') {
        // 后台 Agent 不能弹交互式对话框，自动降级为 DENY
        const guardCtx = getToolGuardContext();
        if (guardCtx?.isBackgroundAgent) {
          const reason = `后台 Agent 不允许交互式审批，工具 ${toolId} 被自动拒绝`;
          log.info('后台 Agent ASK 降级为 DENY', { toolId, risk: decision.risk });

          eventBus.emit('security:blocked', {
            toolId,
            risk: decision.risk,
            reason,
            params: params as Record<string, unknown>,
          });

          this.auditLogger?.log({
            action: 'BLOCK',
            toolId,
            risk: decision.risk,
            reason,
            params: params as Record<string, unknown>,
          });

          throw new SecurityBlockedError(reason, toolId, decision.risk, reason);
        }

        this.auditLogger?.log({
          action: 'APPROVAL_REQUESTED',
          toolId,
          risk: decision.risk,
          params: params as Record<string, unknown>,
          ...(decision.reason ? { reason: decision.reason } : {}),
        });

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

          this.auditLogger?.log({
            action: 'APPROVAL_DENIED',
            toolId,
            risk: decision.risk,
            reason,
          });

          throw new SecurityBlockedError(reason, toolId, decision.risk, reason);
        }

        // 根据审批范围存储决策
        if (approvalResponse.scope === 'session') {
          this.store.addSessionApproval(toolId);
        } else if (approvalResponse.scope === 'always') {
          this.store.addPersistentApproval(toolId);
        }

        this.auditLogger?.log({
          action: 'APPROVAL_GRANTED',
          toolId,
          risk: decision.risk,
          ...(approvalResponse.scope ? { scope: approvalResponse.scope } : {}),
          ...(decision.reason ? { reason: decision.reason } : {}),
        });

        log.debug('审批通过，执行工具', { toolId, scope: approvalResponse.scope });
      } else {
        // ALLOW → 直接放行
        this.auditLogger?.log({
          action: 'ALLOW',
          toolId,
          risk: decision.risk,
          params: params as Record<string, unknown>,
          ...(decision.matchedRule ? { matchedRule: decision.matchedRule } : {}),
        });
      }

      // Step 4: 执行原工具并记录 EXECUTED 审计事件
      const execStart = Date.now();
      try {
        const result = await originalExecute(toolCallId, params, signal, onUpdate);
        const durationMs = Date.now() - execStart;

        // 提取结果摘要
        const resultStr = result != null ? String(result) : '';
        const resultSummary =
          resultStr.length > ToolGuard.RESULT_SUMMARY_MAX_LENGTH
            ? `${resultStr.slice(0, ToolGuard.RESULT_SUMMARY_MAX_LENGTH)}...`
            : resultStr;

        this.auditLogger?.log({
          action: 'EXECUTED',
          toolId,
          toolCallId,
          params: params as Record<string, unknown>,
          durationMs,
          ...(resultSummary ? { result: resultSummary } : {}),
          success: true,
          ...(this._agentId ? { agentId: this._agentId } : {}),
        });

        return result;
      } catch (execError) {
        const durationMs = Date.now() - execStart;
        const errMsg = execError instanceof Error ? execError.message : String(execError);

        this.auditLogger?.log({
          action: 'EXECUTED',
          toolId,
          toolCallId,
          params: params as Record<string, unknown>,
          durationMs,
          success: false,
          reason: errMsg,
          ...(this._agentId ? { agentId: this._agentId } : {}),
        });

        throw execError;
      }
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
