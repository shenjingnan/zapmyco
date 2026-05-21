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
