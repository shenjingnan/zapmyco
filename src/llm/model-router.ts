/**
 * ModelRouter — 模型路由与故障转移
 *
 * 基于 ProviderRegistry 和 CredentialPoolManager，
 * 提供智能模型选择、Key 获取和故障转移链执行。
 */

import type { TaskType } from '@/config/types';
import { logger } from '@/infra/logger';
import { maskApiKey } from '@/llm/key-utils';
import type { ModelInfo, ProviderRegistry } from '@/llm/provider-registry';

// ============ 类型定义 ============

/** 路由上下文 */
export interface RoutingContext {
  /** 显式指定模型 */
  model?: string;
  /** 任务类型（影响模型推荐） */
  taskType?: TaskType;
  /** 成本限制 */
  maxCostTier?: 'low' | 'medium' | 'high' | 'premium';
  /** 需要视觉能力 */
  requireVision?: boolean;
  /** 需要推理能力 */
  requireReasoning?: boolean;
}

/** 路由决策 */
export interface RoutingDecision {
  /** 选中的模型信息 */
  model: ModelInfo;
  /** 完整的 API Key（内部使用，不暴露到日志） */
  apiKey: string;
  /** 被遮蔽的 API Key（安全暴露，仅显示后 4 位） */
  apiKeyMasked: string;
  /** 故障转移链（不含当前模型） */
  fallbackChain: ModelInfo[];
}

/** 路由统计 */
export interface RoutingStats {
  attempts: number;
  successes: number;
  failures: number;
  fallbacks: number;
  /** 每个提供商的失败次数 */
  providerFailures: Record<string, number>;
}

/** 错误类型分类 */
type ErrorCategory =
  | 'rate_limit' // 429
  | 'server_error' // 5xx
  | 'auth_error' // 401/403
  | 'network' // 连接/超时
  | 'other';

// ============ ModelRouter ============

export class ModelRouter {
  private registry: ProviderRegistry;
  private stats: RoutingStats;

  constructor(registry: ProviderRegistry) {
    this.registry = registry;
    this.stats = {
      attempts: 0,
      successes: 0,
      failures: 0,
      fallbacks: 0,
      providerFailures: {},
    };
  }

  /**
   * 为给定的上下文选择最佳模型和 Key
   */
  route(context?: RoutingContext): RoutingDecision | null {
    const modelInfo = this.selectModel(context);
    if (!modelInfo) {
      logger.error('ModelRouter: 无法找到合适的模型');
      return null;
    }

    const apiKey = this.registry.credentialManager.getKey(modelInfo.provider);
    if (!apiKey) {
      logger.warn(`ModelRouter: 提供商 [${modelInfo.provider}] 没有可用的 Key，尝试故障转移`);
      // 尝试在 fallbackChain 中找到第一个有可用 Key 的模型
      const fallbackChain = this.registry.getFallbackChain(modelInfo.key);
      for (const fallback of fallbackChain) {
        const fallbackKey = this.registry.credentialManager.getKey(fallback.provider);
        if (fallbackKey) {
          return {
            model: fallback,
            apiKey: fallbackKey,
            apiKeyMasked: maskApiKey(fallbackKey),
            fallbackChain: fallbackChain.filter((m) => m.key !== fallback.key),
          };
        }
      }
      return null;
    }

    this.stats.attempts++;

    return {
      model: modelInfo,
      apiKey,
      apiKeyMasked: maskApiKey(apiKey),
      fallbackChain: this.registry.getFallbackChain(modelInfo.key),
    };
  }

  /**
   * 报告失败并获取故障转移决策
   *
   * 故障转移策略：
   * 1. 标记当前 Key 失败
   * 2. 尝试同提供商下一个 Key
   * 3. 同提供商所有 Key 耗尽 → 切换到 fallbackChain 中的下一个厂商
   */
  async fallback(previousDecision: RoutingDecision, error: Error): Promise<RoutingDecision | null> {
    const category = this.classifyError(error);
    const provider = previousDecision.model.provider;

    // 记录失败
    this.stats.failures++;
    this.stats.fallbacks++;
    this.stats.providerFailures[provider] = (this.stats.providerFailures[provider] ?? 0) + 1;

    // 标记当前 Key 失败
    this.registry.credentialManager.reportKeyResult(
      provider,
      previousDecision.apiKey,
      false,
      error
    );

    logger.warn(
      `ModelRouter: 模型 [${previousDecision.model.key}] Key ${previousDecision.apiKeyMasked} 失败 (${category}), 尝试故障转移`
    );

    // 认证错误不可恢复，直接跳过此提供商
    if (category === 'auth_error') {
      logger.error(`ModelRouter: 提供商 [${provider}] 认证错误，跳过该提供商所有模型`);
      // 过滤掉此提供商的所有模型
      const remainingChain = previousDecision.fallbackChain.filter((m) => m.provider !== provider);
      return this.tryNextProvider(remainingChain);
    }

    // 先尝试同提供商下一个 Key
    const sameProviderKey = this.registry.credentialManager.getKey(provider);
    if (sameProviderKey && sameProviderKey !== previousDecision.apiKey) {
      logger.debug(`ModelRouter: 同提供商 [${provider}] Key 切换`);
      this.stats.attempts++;
      return {
        model: previousDecision.model,
        apiKey: sameProviderKey,
        apiKeyMasked: maskApiKey(sameProviderKey),
        fallbackChain: previousDecision.fallbackChain,
      };
    }

    // 同提供商 Key 耗尽，切换到下一个厂商
    return this.tryNextProvider(previousDecision.fallbackChain);
  }

  /** 获取路由统计 */
  getRoutingStats(): RoutingStats {
    return { ...this.stats };
  }

  /** 重置统计 */
  resetStats(): void {
    this.stats = {
      attempts: 0,
      successes: 0,
      failures: 0,
      fallbacks: 0,
      providerFailures: {},
    };
  }

  // ============ 内部方法 ============

  /** 选择模型 */
  private selectModel(context?: RoutingContext): ModelInfo | undefined {
    // 1. 显式指定模型
    if (context?.model) {
      const model = this.registry.resolveModel(context.model);
      if (model) return model;
      logger.warn(`ModelRouter: 指定的模型 [${context.model}] 未注册，回退到默认`);
    }

    // 2. 基于任务类型的路由
    if (context?.taskType) {
      const routing = this.registry.getRoutingConfig();
      if (routing?.taskBasedModels) {
        const mapped = routing.taskBasedModels[context.taskType];
        if (mapped) {
          const model = this.registry.resolveModel(mapped);
          if (model) return model;
        }
      }
    }

    // 3. 默认模型
    return this.registry.getDefaultModel();
  }

  /** 在 fallbackChain 中尝试找到有可用 Key 的模型 */
  private tryNextProvider(fallbackChain: ModelInfo[]): RoutingDecision | null {
    for (const modelInfo of fallbackChain) {
      const apiKey = this.registry.credentialManager.getKey(modelInfo.provider);
      if (apiKey) {
        this.stats.attempts++;
        logger.debug(`ModelRouter: 故障转移到 [${modelInfo.key}]`);
        return {
          model: modelInfo,
          apiKey,
          apiKeyMasked: maskApiKey(apiKey),
          fallbackChain: fallbackChain.filter((m) => m.key !== modelInfo.key),
        };
      }
    }

    logger.error('ModelRouter: 故障转移链已耗尽，所有提供商都不可用');
    return null;
  }

  /** 错误分类 */
  private classifyError(error: Error): ErrorCategory {
    const msg = error.message.toLowerCase();

    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
      return 'rate_limit';
    }

    if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')) {
      return 'auth_error';
    }

    if (
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('internal server error')
    ) {
      return 'server_error';
    }

    if (
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('network')
    ) {
      return 'network';
    }

    return 'other';
  }
}
