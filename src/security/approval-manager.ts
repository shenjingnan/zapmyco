/**
 * 审批管理器
 *
 * 基于 Provider 模式实现异步阻塞审批。
 * TUI 层通过 setProvider() 注入审批 UI 实现，
 * 工具执行流通过 requestApproval() 被阻塞等待用户决策。
 *
 * 在 headless 模式（无 provider）下自动拒绝所有审批请求。
 *
 * @module security/approval-manager
 */

import { eventBus } from '@/infra/event-bus';
import { logger } from '@/infra/logger';
import type { ApprovalProvider, ApprovalRequest, ApprovalResponse } from './types';

const log = logger.child('approval-manager');

// ============ ApprovalManager ============

export class ApprovalManager {
  private provider: ApprovalProvider | null = null;

  constructor(provider?: ApprovalProvider) {
    if (provider) {
      this.provider = provider;
    }
  }

  /**
   * 设置审批提供者（由 TUI 层注入）
   */
  setProvider(provider: ApprovalProvider): void {
    this.provider = provider;
  }

  /**
   * 检查是否有审批提供者
   */
  hasProvider(): boolean {
    return this.provider !== null;
  }

  /**
   * 请求用户审批
   *
   * 阻塞当前执行流，等待用户通过 TUI 做出决策。
   * 如果无 provider（headless 模式），自动拒绝并记录警告。
   *
   * @param request - 审批请求
   * @returns 审批响应
   */
  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    // 无 provider：自动拒绝
    if (!this.provider) {
      log.warn('无审批提供者，自动拒绝审批请求', {
        toolId: request.toolId,
        risk: request.risk,
      });
      eventBus.emit('security:approval-denied', {
        toolId: request.toolId,
        reason: 'headless 模式下自动拒绝',
      });
      return { approved: false };
    }

    // 发出审批请求事件（用于日志/审计）
    eventBus.emit('security:approval-requested', {
      toolId: request.toolId,
      toolLabel: request.toolLabel,
      risk: request.risk,
      reason: request.reason,
    });

    try {
      const response = await this.provider.requestApproval(request);

      if (response.approved) {
        eventBus.emit('security:approval-granted', {
          toolId: request.toolId,
          scope: response.scope ?? 'once',
        });
        log.debug('审批通过', {
          toolId: request.toolId,
          scope: response.scope,
        });
      } else {
        eventBus.emit('security:approval-denied', {
          toolId: request.toolId,
          reason: '用户拒绝',
        });
        log.debug('审批被拒绝', { toolId: request.toolId });
      }

      return response;
    } catch (err) {
      // Provider 异常 → 自动拒绝
      log.error('审批提供者异常，自动拒绝', {
        toolId: request.toolId,
        error: err instanceof Error ? err.message : String(err),
      });
      eventBus.emit('security:approval-denied', {
        toolId: request.toolId,
        reason: '审批提供者异常',
      });
      return { approved: false };
    }
  }
}
