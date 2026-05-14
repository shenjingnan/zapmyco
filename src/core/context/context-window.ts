/**
 * 上下文窗口解析
 *
 * 从 pi-ai Model 对象中获取上下文窗口大小，
 * 计算有效可用窗口。
 *
 * @module core/context
 */

import type { Model } from '@earendil-works/pi-ai';
import type { ContextWindowInfo } from './types';

/** 默认上下文窗口大小（当无法从模型获取时） */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** 默认输出预留空间（tokens） */
export const DEFAULT_OUTPUT_RESERVE = 20_000;

/** 已知模型的上下文窗口（后备映射） */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-20250514': 200_000,
  'claude-opus-4-20250514': 200_000,
  'claude-opus-4-20250514-1m': 1_000_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'deepseek-v3': 128_000,
  'deepseek-r1': 128_000,
};

/**
 * 从 pi-ai Model 对象解析上下文窗口信息
 *
 * @param model - pi-ai Model 实例
 * @returns 上下文窗口信息
 */
// biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束
export function resolveContextWindow(model: Model<any>): ContextWindowInfo {
  const contextWindow =
    model.contextWindow || KNOWN_CONTEXT_WINDOWS[model.id] || DEFAULT_CONTEXT_WINDOW;

  const outputReserve = Math.min(model.maxTokens || DEFAULT_OUTPUT_RESERVE, DEFAULT_OUTPUT_RESERVE);
  const effectiveWindow = contextWindow - outputReserve;

  return {
    contextWindow,
    outputReserve,
    effectiveWindow,
    modelId: model.id,
    provider: model.provider,
  };
}

/**
 * 根据模型 Key 查找已知上下文窗口
 *
 * @param modelKey - 模型标识（如 anthropic/claude-sonnet-4-20250514）
 * @returns 上下文窗口大小，未知时返回默认值
 */
export function getKnownContextWindow(modelKey: string): number {
  const modelId = modelKey.split('/').pop() || '';
  return KNOWN_CONTEXT_WINDOWS[modelId] || DEFAULT_CONTEXT_WINDOW;
}

/**
 * 计算有效上下文窗口
 *
 * @param contextWindow - 总上下文窗口（tokens）
 * @param maxOutputTokens - 最大输出 tokens
 * @returns 有效上下文窗口
 */
export function getEffectiveContextWindow(contextWindow: number, maxOutputTokens?: number): number {
  const reserve = Math.min(maxOutputTokens || DEFAULT_OUTPUT_RESERVE, DEFAULT_OUTPUT_RESERVE);
  return contextWindow - reserve;
}

/**
 * 计算当前用量占有效窗口的百分比
 *
 * @param usedTokens - 已使用 tokens
 * @param effectiveWindow - 有效窗口大小
 * @returns 百分比（0-1）
 */
export function getUsagePercent(usedTokens: number, effectiveWindow: number): number {
  if (effectiveWindow <= 0) return 1;
  return Math.min(usedTokens / effectiveWindow, 1);
}

/**
 * 判断是否应该触发压缩
 *
 * @param estimatedTokens - 当前估算 tokens
 * @param effectiveWindow - 有效窗口大小
 * @param thresholdPercent - 触发阈值（默认 0.70）
 * @returns 是否应压缩
 */
export function shouldTriggerCompaction(
  estimatedTokens: number,
  effectiveWindow: number,
  thresholdPercent = 0.7
): boolean {
  return getUsagePercent(estimatedTokens, effectiveWindow) >= thresholdPercent;
}
