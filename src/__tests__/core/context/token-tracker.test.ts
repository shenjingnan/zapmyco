import { beforeEach, describe, expect, it } from 'vitest';
import { TokenTracker } from '@/core/context/token-tracker';

describe('TokenTracker', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  describe('initial state', () => {
    it('should start with zero values', () => {
      expect(tracker.inputTokens).toBe(0);
      expect(tracker.outputTokens).toBe(0);
      expect(tracker.totalTokens).toBe(0);
      expect(tracker.turnCount).toBe(0);
      expect(tracker.initialized).toBe(false);
    });
  });

  describe('recordUsage', () => {
    it('should track input and output tokens', () => {
      tracker.recordUsage({ input: 100, output: 50, cost: { input: 0, output: 0, total: 0 } });
      expect(tracker.inputTokens).toBe(100);
      expect(tracker.outputTokens).toBe(50);
      expect(tracker.totalTokens).toBe(150);
      expect(tracker.turnCount).toBe(1);
      expect(tracker.initialized).toBe(true);
    });

    it('should accumulate values across multiple calls', () => {
      tracker.recordUsage({ input: 100, output: 50, cost: { input: 0, output: 0, total: 0 } });
      tracker.recordUsage({ input: 200, output: 100, cost: { input: 0, output: 0, total: 0 } });
      expect(tracker.inputTokens).toBe(300);
      expect(tracker.outputTokens).toBe(150);
      expect(tracker.totalTokens).toBe(450);
      expect(tracker.turnCount).toBe(2);
    });

    it('should track cost when provided', () => {
      tracker.recordUsage({
        input: 1000,
        output: 500,
        cost: { input: 0.003, output: 0.0075, total: 0.0105 },
      });
      const usage = tracker.getUsage();
      expect(usage.estimatedCostUsd).toBeCloseTo(0.0105, 4);
    });

    it('should default cost to 0 when not provided', () => {
      tracker.recordUsage({ input: 100, output: 50 });
      const usage = tracker.getUsage();
      expect(usage.estimatedCostUsd).toBe(0);
    });

    it('should handle zero tokens gracefully', () => {
      tracker.recordUsage({ input: 0, output: 0 });
      expect(tracker.inputTokens).toBe(0);
      expect(tracker.outputTokens).toBe(0);
      expect(tracker.totalTokens).toBe(0);
      expect(tracker.initialized).toBe(true);
    });
  });

  describe('getUsage', () => {
    it('should return TokenUsage object with accumulated values', () => {
      tracker.recordUsage({ input: 100, output: 50, cost: { input: 0, output: 0, total: 0.001 } });
      const usage = tracker.getUsage();
      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(50);
      expect(usage.totalTokens).toBe(150);
      expect(usage.estimatedCostUsd).toBe(0.001);
    });

    it('should return zeros for empty tracker', () => {
      const usage = tracker.getUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.estimatedCostUsd).toBe(0);
    });
  });

  describe('getSnapshot', () => {
    it('should return snapshot with message count', () => {
      tracker.recordUsage({ input: 100, output: 50 });
      const snapshot = tracker.getSnapshot(5);
      expect(snapshot.inputTokens).toBe(100);
      expect(snapshot.outputTokens).toBe(50);
      expect(snapshot.totalTokens).toBe(150);
      expect(snapshot.messageCount).toBe(5);
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('should clear all accumulated values', () => {
      tracker.recordUsage({ input: 100, output: 50 });
      tracker.reset();

      expect(tracker.inputTokens).toBe(0);
      expect(tracker.outputTokens).toBe(0);
      expect(tracker.totalTokens).toBe(0);
      expect(tracker.turnCount).toBe(0);
      // initialized 在 reset() 后不重置，此为当前实现行为
    });

    it('should allow recording after reset', () => {
      tracker.recordUsage({ input: 100, output: 50 });
      tracker.reset();
      tracker.recordUsage({ input: 200, output: 100 });

      expect(tracker.inputTokens).toBe(200);
      expect(tracker.outputTokens).toBe(100);
      expect(tracker.turnCount).toBe(1);
    });
  });
});
