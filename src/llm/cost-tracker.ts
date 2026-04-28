/**
 * Token / Cost 追踪器
 *
 * 实时跟踪所有 LLM 调用的 Token 消耗和预估费用，
 * 用于成本控制和用户展示。
 */

import type { TokenUsage } from '@/core/result/types';
import { logger } from '@/infra/logger';

/** 模型定价信息（每百万 token 的美元价格） */
interface ModelPricing {
  inputPricePer1M: number;
  outputPricePer1M: number;
}

/** 已知模型的定价表 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude
  'claude-haiku-4-5-20251001': { inputPricePer1M: 0.8, outputPricePer1M: 4 },
  'claude-sonnet-4-20250514': { inputPricePer1M: 3, outputPricePer1M: 15 },
  'claude-opus-4-20250514': { inputPricePer1M: 15, outputPricePer1M: 75 },

  // OpenAI
  'gpt-4o': { inputPricePer1M: 2.5, outputPricePer1M: 10 },
  'gpt-4o-mini': { inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
};

/**
 * CostTracker 实例
 *
 * 使用方式：
 * ```typescript
 * import { costTracker } from '@/llm/cost-tracker';
 *
 * costTracker.record({ inputTokens: 1000, outputTokens: 500 }, 'claude-sonnet-4');
 * const summary = costTracker.getSummary();
 * console.log(`总花费: $${summary.totalCostUsd}`);
 * ```
 */
export class CostTracker {
  private records: Array<{ usage: TokenUsage; model: string; timestamp: number }> = [];

  /** 记录一次 LLM 调用的 Token 消耗 */
  record(usage: Omit<TokenUsage, 'estimatedCostUsd'>, model: string): void {
    const pricing = MODEL_PRICING[model] ?? { inputPricePer1M: 0, outputPricePer1M: 0 };
    const estimatedCostUsd =
      (usage.inputTokens / 1_000_000) * pricing.inputPricePer1M +
      (usage.outputTokens / 1_000_000) * pricing.outputPricePer1M;

    const fullUsage: TokenUsage = {
      ...usage,
      totalTokens: usage.inputTokens + usage.outputTokens,
      estimatedCostUsd,
    };

    this.records.push({
      usage: fullUsage,
      model,
      timestamp: Date.now(),
    });

    logger.debug('Token 消耗记录', {
      model,
      tokens: fullUsage.totalTokens,
      cost: `$${estimatedCostUsd.toFixed(4)}`,
    });
  }

  /** 获取累计摘要 */
  getSummary(): {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    callCount: number;
  } {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;

    for (const record of this.records) {
      totalInputTokens += record.usage.inputTokens;
      totalOutputTokens += record.usage.outputTokens;
      totalCostUsd += record.usage.estimatedCostUsd;
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCostUsd,
      callCount: this.records.length,
    };
  }

  /** 重置所有记录 */
  reset(): void {
    this.records = [];
  }

  /** 获取记录数 */
  get count(): number {
    return this.records.length;
  }
}

/** 全局默认 CostTracker 实例 */
export const costTracker = new CostTracker();
