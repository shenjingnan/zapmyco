/**
 * Token 追踪器
 *
 * 从 pi-agent-core 的 turn_end 事件中提取实际 token 用量，
 * 维护累积计数，提供 token 使用状态查询。
 *
 * @module core/context
 */

import type { Usage } from '@earendil-works/pi-ai';
import type { TokenUsageSnapshot } from './types';

/**
 * 粗略 token 估算（字符数 / bytesPerToken）
 *
 * 用于在无法获取实际 token 数时快速估算，
 * 以及估算当前消息列表的 token 占用。
 *
 * @param text - 待估算的文本
 * @param bytesPerToken - 每 token 平均字节数（默认 4）
 * @returns 估算 token 数
 */
export function roughTokenEstimate(text: string, bytesPerToken = 4): number {
  if (!text) return 0;
  return Math.ceil(text.length / bytesPerToken);
}

/**
 * 估算消息列表的 token 数
 *
 * 遍历所有消息的 content 字段，进行粗略字符估算。
 * 包含 10% 的开销用于消息结构、工具调用参数等。
 */
export function estimateMessagesTokens(messages: readonly unknown[]): number {
  if (!messages?.length) return 0;

  let totalChars = 0;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Record<string, unknown>;

    // 跳过摘要消息（自定义类型）
    if (m.role === 'summary') {
      totalChars += typeof m.text === 'string' ? m.text.length : 0;
      continue;
    }

    // 标准消息：content 可能是 string 或 content blocks 数组
    if (typeof m.content === 'string') {
      totalChars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' || block.type === 'thinking') {
          const text =
            (block as Record<string, unknown>).text || (block as Record<string, unknown>).thinking;
          if (typeof text === 'string') totalChars += text.length;
        } else if (block.type === 'toolCall') {
          // JSON arguments
          const args = (block as Record<string, unknown>).arguments;
          if (typeof args === 'string') totalChars += args.length;
          else if (args) totalChars += JSON.stringify(args).length;
        }
      }
    }
  }

  const baseTokens = Math.ceil(totalChars / 4);
  const overhead = Math.ceil(baseTokens * 0.1);
  return baseTokens + overhead;
}

/**
 * Token 追踪器
 *
 * 维护会话级别的 token 用量状态。
 */
export class TokenTracker {
  /** 累积的 input tokens */
  private _inputTokens = 0;
  /** 累积的 output tokens */
  private _outputTokens = 0;
  /** 累积的 cache read tokens */
  private _cacheReadTokens = 0;
  /** 累积的 cache write tokens */
  private _cacheWriteTokens = 0;
  /** 累积的预估费用（美元） */
  private _totalCostUsd = 0;

  /** 原始用法记录（用于调试） */
  private _usageHistory: Usage[] = [];

  /** 每次调用的缓存指标（用于计算缓存命中率） */
  private _callMetrics: Array<{
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    timestamp: number;
  }> = [];

  /** 是否已初始化 */
  private _initialized = false;

  /**
   * 从 API 返回的 Usage 记录 token 用量
   */
  recordUsage(usage: Usage): void {
    this._inputTokens += usage.input;
    this._outputTokens += usage.output;
    this._cacheReadTokens += usage.cacheRead;
    this._cacheWriteTokens += usage.cacheWrite;
    this._totalCostUsd += usage.cost?.total ?? 0;
    this._usageHistory.push(usage);
    this._callMetrics.push({
      inputTokens: usage.input,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      timestamp: Date.now(),
    });
    this._initialized = true;
  }

  /**
   * 获取当前快照
   */
  getSnapshot(messageCount: number): TokenUsageSnapshot {
    return {
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens,
      totalTokens: this._inputTokens + this._outputTokens,
      cacheReadTokens: this._cacheReadTokens,
      cacheWriteTokens: this._cacheWriteTokens,
      messageCount,
      timestamp: Date.now(),
    };
  }

  /**
   * 获取累积的 TokenUsage（用于 TaskResult.tokenUsage）
   */
  getUsage(): import('@/core/result/types').TokenUsage {
    return {
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens,
      totalTokens: this._inputTokens + this._outputTokens,
      cacheReadTokens: this._cacheReadTokens,
      cacheWriteTokens: this._cacheWriteTokens,
      estimatedCostUsd: this._totalCostUsd,
    };
  }

  /**
   * 获取最近 N 次调用的缓存命中率
   *
   * 命中率 = cache_read_tokens / input_tokens
   * > 80% 为优秀，< 50% 需要优化
   */
  getCacheHitRate(windowSize = 5): number {
    const window = this._callMetrics.slice(-windowSize);
    if (window.length === 0) return 0;
    const totalInput = window.reduce((sum, m) => sum + m.inputTokens, 0);
    const totalCacheRead = window.reduce((sum, m) => sum + m.cacheReadTokens, 0);
    if (totalInput === 0) return 0;
    return totalCacheRead / totalInput;
  }

  /**
   * 检测缓存断裂
   *
   * 当 cache_read 骤降超过 50% 且此前有大量缓存读取时，判定为缓存断裂。
   */
  detectCacheBreak(): { broken: boolean; previousRead: number; currentRead: number } | null {
    if (this._callMetrics.length < 2) return null;
    const prev = this._callMetrics[this._callMetrics.length - 2];
    const curr = this._callMetrics[this._callMetrics.length - 1];
    if (prev.cacheReadTokens > 2000 && curr.cacheReadTokens < prev.cacheReadTokens * 0.5) {
      return { broken: true, previousRead: prev.cacheReadTokens, currentRead: curr.cacheReadTokens };
    }
    return { broken: false, previousRead: prev.cacheReadTokens, currentRead: curr.cacheReadTokens };
  }

  /**
   * 获取最近 N 次调用的平均缓存读取比例
   */
  getAverageCacheRatio(windowSize = 5): number {
    const window = this._callMetrics.slice(-windowSize);
    if (window.length === 0) return 0;
    const validCalls = window.filter((m) => m.inputTokens > 0);
    if (validCalls.length === 0) return 0;
    const totalRatio = validCalls.reduce((sum, m) => sum + m.cacheReadTokens / m.inputTokens, 0);
    return totalRatio / validCalls.length;
  }

  /**
   * 重置追踪器（压缩后调用）
   */
  reset(): void {
    this._inputTokens = 0;
    this._outputTokens = 0;
    this._cacheReadTokens = 0;
    this._cacheWriteTokens = 0;
    this._totalCostUsd = 0;
    this._callMetrics = [];
  }

  /** 是否已初始化 */
  get initialized(): boolean {
    return this._initialized;
  }

  /** input tokens 累积值 */
  get inputTokens(): number {
    return this._inputTokens;
  }

  /** output tokens 累积值 */
  get outputTokens(): number {
    return this._outputTokens;
  }

  /** 总 tokens 累积值 */
  get totalTokens(): number {
    return this._inputTokens + this._outputTokens;
  }

  /** 用法历史记录数 */
  get turnCount(): number {
    return this._usageHistory.length;
  }
}
