import { beforeEach, describe, expect, it } from 'vitest';
import { TokenTracker } from '@/core/context/token-tracker';

describe('TokenTracker', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  describe('getLatestMetrics', () => {
    it('should return zeros when no usage recorded', () => {
      const metrics = tracker.getLatestMetrics();
      expect(metrics.hitRate).toBe(0);
      expect(metrics.averageCacheRatio).toBe(0);
      expect(metrics.totalCalls).toBe(0);
      expect(metrics.totalInputTokens).toBe(0);
      expect(metrics.totalCacheReadTokens).toBe(0);
      expect(metrics.totalCacheWriteTokens).toBe(0);
      expect(metrics.lastBreak).toBeNull();
    });

    it('should return correct metrics after single usage', () => {
      tracker.recordUsage({ input: 1000, cacheRead: 800, cacheWrite: 200, output: 500 });
      const metrics = tracker.getLatestMetrics();
      expect(metrics.hitRate).toBe(0.8);
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.totalInputTokens).toBe(1000);
      expect(metrics.totalCacheReadTokens).toBe(800);
      expect(metrics.totalCacheWriteTokens).toBe(200);
    });

    it('should accumulate totals across multiple calls', () => {
      tracker.recordUsage({ input: 1000, cacheRead: 800, cacheWrite: 200, output: 500 });
      tracker.recordUsage({ input: 2000, cacheRead: 1500, cacheWrite: 0, output: 300 });
      const metrics = tracker.getLatestMetrics();
      expect(metrics.totalCalls).toBe(2);
      expect(metrics.totalInputTokens).toBe(3000);
      expect(metrics.totalCacheReadTokens).toBe(2300);
    });

    it('should detect cache break for sharp drop', () => {
      tracker.recordUsage({ input: 5000, cacheRead: 4500, cacheWrite: 0, output: 200 });
      tracker.recordUsage({ input: 5000, cacheRead: 500, cacheWrite: 0, output: 200 });
      const metrics = tracker.getLatestMetrics();
      expect(metrics.lastBreak).not.toBeNull();
      expect(metrics.lastBreak?.broken).toBe(true);
    });

    it('should handle DeepSeek format (cacheWrite=0, input=total)', () => {
      // DeepSeek 返回 prompt_cache_hit_tokens 映射到 cacheRead
      // 而没有 cache_creation_input_tokens（即 cacheWrite=0）
      // input = 总输入 token，cacheRead = 命中的 token
      // 命中率 = cacheRead / input = 700/1000 = 0.7
      tracker.recordUsage({ input: 1000, cacheRead: 700, cacheWrite: 0, output: 200 });
      expect(tracker.getCacheHitRate()).toBe(0.7);
      expect(tracker.getCacheHitRate()).toBeCloseTo(0.7, 2);
    });

    it('should handle DeepSeek multi-turn accumulating cache hits', () => {
      // 模拟多轮对话：随着对话增长，每轮都有部分 cache 命中
      tracker.recordUsage({ input: 5000, cacheRead: 4000, cacheWrite: 0, output: 200 });
      tracker.recordUsage({ input: 5200, cacheRead: 4500, cacheWrite: 0, output: 250 });
      const metrics = tracker.getLatestMetrics();
      // (4000 + 4500) / (5000 + 5200) = 8500 / 10200 ≈ 0.833
      expect(metrics.hitRate).toBeCloseTo(0.833, 2);
    });

    it('should return meaningful cache ratio for DeepSeek format', () => {
      // DeepSeek 的平均缓存比例 = 各轮 cacheRead/input 的平均值
      tracker.recordUsage({ input: 1000, cacheRead: 700, cacheWrite: 0, output: 100 });
      tracker.recordUsage({ input: 1000, cacheRead: 850, cacheWrite: 0, output: 100 });
      // call 1: 700/1000 = 0.7, call 2: 850/1000 = 0.85
      // average = (0.7 + 0.85) / 2 = 0.775
      expect(tracker.getAverageCacheRatio()).toBeCloseTo(0.775, 2);
    });
  });

  describe('getHitRateChange', () => {
    it('should return 0 when less than 2 data points', () => {
      expect(tracker.getHitRateChange()).toBe(0);
    });

    it('should return 0 with single record', () => {
      tracker.recordUsage({ input: 1000, cacheRead: 800, cacheWrite: 0, output: 500 });
      expect(tracker.getHitRateChange()).toBe(0);
    });

    it('should return positive value when hit rate improves', () => {
      tracker.recordUsage({ input: 1000, cacheRead: 200, cacheWrite: 0, output: 500 });
      tracker.recordUsage({ input: 1000, cacheRead: 900, cacheWrite: 0, output: 500 });
      expect(tracker.getHitRateChange()).toBeGreaterThan(0);
    });

    it('should return negative value when hit rate degrades', () => {
      tracker.recordUsage({ input: 1000, cacheRead: 900, cacheWrite: 0, output: 500 });
      tracker.recordUsage({ input: 1000, cacheRead: 200, cacheWrite: 0, output: 500 });
      expect(tracker.getHitRateChange()).toBeLessThan(0);
    });
  });

  describe('getHitRateTrend', () => {
    it('should return empty array when no data', () => {
      expect(tracker.getHitRateTrend()).toEqual([]);
    });

    it('should return empty array for count=0', () => {
      tracker.recordUsage({ input: 1000, cacheRead: 800, cacheWrite: 0, output: 500 });
      expect(tracker.getHitRateTrend(0)).toEqual([]);
    });

    it('should return single data point after one record', () => {
      tracker.recordUsage({ input: 1000, cacheRead: 800, cacheWrite: 0, output: 500 });
      const trend = tracker.getHitRateTrend(10);
      expect(trend).toHaveLength(1);
      expect(trend[0]!.hitRate).toBe(0.8);
    });

    it('should return multiple data points (sliding window average)', () => {
      tracker.recordUsage({ input: 1000, cacheRead: 500, cacheWrite: 0, output: 500 });
      tracker.recordUsage({ input: 1000, cacheRead: 900, cacheWrite: 0, output: 500 });
      tracker.recordUsage({ input: 1000, cacheRead: 800, cacheWrite: 0, output: 500 });
      const trend = tracker.getHitRateTrend(10);
      expect(trend).toHaveLength(3);
      // hitRate = cumulative cacheRead / cumulative input over all calls in window
      // Call 3: (500 + 900 + 800) / (1000 + 1000 + 1000) = 2200/3000 ≈ 0.733
      expect(trend[2]!.hitRate).toBeCloseTo(0.733, 2);
    });

    it('should respect count parameter', () => {
      for (let i = 0; i < 10; i++) {
        tracker.recordUsage({ input: 1000, cacheRead: 800, cacheWrite: 0, output: 500 });
      }
      const trend = tracker.getHitRateTrend(3);
      expect(trend).toHaveLength(3);
    });
  });

  describe('_hitRateHistory boundary', () => {
    it('should be bounded to ~100 entries', () => {
      for (let i = 0; i < 150; i++) {
        tracker.recordUsage({ input: 1000, cacheRead: 800, cacheWrite: 0, output: 500 });
      }
      const trend = tracker.getHitRateTrend(200);
      expect(trend.length).toBeLessThanOrEqual(100);
    });
  });

  describe('reset', () => {
    it('should clear hit rate history', () => {
      tracker.recordUsage({ input: 1000, cacheRead: 800, cacheWrite: 0, output: 500 });
      tracker.reset();
      expect(tracker.getHitRateTrend()).toEqual([]);
      expect(tracker.getHitRateChange()).toBe(0);
    });
  });
});
