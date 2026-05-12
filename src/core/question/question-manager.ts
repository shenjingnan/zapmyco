/**
 * 问题管理器
 *
 * 基于 Provider 模式实现异步阻塞提问。
 * TUI 层通过 setProvider() 注入提问 UI 实现，
 * Agent 工具执行流通过 ask() 被阻塞等待用户回答。
 *
 * 在 headless 模式（无 provider）下自动报错。
 *
 * @module core/question/question-manager
 */

import { eventBus } from '@/infra/event-bus';
import { logger } from '@/infra/logger';
import type {
  AskUserQuestionParams,
  AskUserQuestionResult,
  PendingQuestionRequest,
  QuestionProvider,
} from './types';
import { createDeferred } from './types';

const log = logger.child('question-manager');

/** 问题超时时间（5 分钟） */
const QUESTION_TIMEOUT_MS = 5 * 60 * 1000;

// ============ QuestionManager ============

export class QuestionManager {
  private provider: QuestionProvider | null = null;
  private pending: Map<string, PendingQuestionRequest> = new Map();

  constructor(provider?: QuestionProvider) {
    if (provider) {
      this.provider = provider;
    }
  }

  /**
   * 设置问题提供者（由 TUI 层注入）
   */
  setProvider(provider: QuestionProvider): void {
    this.provider = provider;
  }

  /**
   * 检查是否有问题提供者
   */
  hasProvider(): boolean {
    return this.provider !== null;
  }

  /**
   * 向用户提问并等待回答
   *
   * 阻塞当前执行流，等待用户通过 TUI 做出回答。
   * 如果无 provider（headless 模式），抛出错误。
   *
   * @param params - 问题参数
   * @returns 用户回答结果
   */
  async ask(params: AskUserQuestionParams): Promise<AskUserQuestionResult> {
    if (!this.provider) {
      throw new Error('当前环境不支持交互式提问（headless 模式）');
    }

    const requestId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const deferred = createDeferred<AskUserQuestionResult>();

    // 防止未处理的 Promise rejection（deferred 可能因超时/取消被 reject 但无人 await）
    deferred.promise.catch(() => {});

    const entry: PendingQuestionRequest = {
      requestId,
      questions: params.questions,
      deferred,
      createdAt: Date.now(),
    };
    this.pending.set(requestId, entry);

    // 发出提问事件
    eventBus.emit('question:asked', {
      requestId,
      questionCount: params.questions.length,
    });

    log.debug('提问已发出', {
      requestId,
      questionCount: params.questions.length,
    });

    // 设置超时
    const timeout = setTimeout(() => {
      if (!deferred.isSettled) {
        log.warn('提问超时，自动取消', { requestId });
        deferred.reject(new Error('提问超时，用户未在 5 分钟内回答'));
        this.pending.delete(requestId);
        eventBus.emit('question:timeout', { requestId });
      }
    }, QUESTION_TIMEOUT_MS);

    try {
      const result = await this.provider.showQuestions(params);
      clearTimeout(timeout);
      deferred.resolve(result);

      eventBus.emit('question:answered', {
        requestId,
        answerCount: Object.keys(result.answers).length,
      });
      log.debug('提问已回答', { requestId });

      return result;
    } catch (err) {
      clearTimeout(timeout);

      if (!deferred.isSettled) {
        deferred.reject(err instanceof Error ? err : new Error(String(err)));
      }

      eventBus.emit('question:cancelled', {
        requestId,
        reason: err instanceof Error ? err.message : String(err),
      });
      log.debug('提问已取消', {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    } finally {
      this.pending.delete(requestId);
    }
  }

  /**
   * 获取待处理的问题请求
   */
  getPending(requestId: string): PendingQuestionRequest | undefined {
    return this.pending.get(requestId);
  }

  /**
   * 拒绝所有待处理的问题（用于 session 关闭时清理）
   */
  rejectAll(error: Error): void {
    const count = this.pending.size;
    for (const [, entry] of this.pending) {
      if (!entry.deferred.isSettled) {
        entry.deferred.reject(error);
      }
    }
    this.pending.clear();
    if (count > 0) {
      log.debug('已清理所有待处理问题', { count });
    }
  }
}

// ============ 全局单例 ============

let globalQuestionManager: QuestionManager | null = null;

/**
 * 获取全局 QuestionManager 单例
 */
export function getQuestionManager(): QuestionManager {
  if (!globalQuestionManager) {
    globalQuestionManager = new QuestionManager();
  }
  return globalQuestionManager;
}

/**
 * 重置全局 QuestionManager（用于测试）
 */
export function resetQuestionManager(): void {
  if (globalQuestionManager) {
    globalQuestionManager.rejectAll(new Error('QuestionManager 已重置'));
  }
  globalQuestionManager = null;
}
