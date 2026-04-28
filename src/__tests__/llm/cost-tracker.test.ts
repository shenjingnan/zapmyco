import { beforeEach, describe, expect, it } from 'vitest';
import { CostTracker, costTracker } from '@/llm/cost-tracker';

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  describe('record()', () => {
    it('should record token usage for known model', () => {
      tracker.record(
        { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
        'claude-sonnet-4-20250514'
      );
      expect(tracker.count).toBe(1);
    });

    it('should calculate cost correctly for claude-sonnet-4', () => {
      // sonnet: $3/$15 per 1M tokens
      // 1000 input + 500 output = 0.001 * $3 + 0.0005 * $15 = $0.003 + $0.0075 = $0.0105
      tracker.record(
        { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
        'claude-sonnet-4-20250514'
      );
      const summary = tracker.getSummary();
      expect(summary.totalCostUsd).toBeCloseTo(0.0105, 6);
    });

    it('should calculate cost for claude-haiku-4-5', () => {
      // haiku: $0.8/$4 per 1M tokens
      // 2000 input + 1000 output = 0.002 * $0.8 + 0.001 * $4 = $0.0016 + $0.004 = $0.0056
      tracker.record(
        { inputTokens: 2000, outputTokens: 1000, totalTokens: 3000 },
        'claude-haiku-4-5-20251001'
      );
      const summary = tracker.getSummary();
      expect(summary.totalCostUsd).toBeCloseTo(0.0056, 6);
    });

    it('should calculate cost for claude-opus-4', () => {
      // opus: $15/$75 per 1M tokens
      tracker.record(
        { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
        'claude-opus-4-20250514'
      );
      const summary = tracker.getSummary();
      // 0.0005 * 15 + 0.0002 * 75 = 0.0075 + 0.015 = 0.0225
      expect(summary.totalCostUsd).toBeCloseTo(0.0225, 6);
    });

    it('should calculate cost for gpt-4o', () => {
      // gpt-4o: $2.5/$10 per 1M tokens
      tracker.record({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }, 'gpt-4o');
      const summary = tracker.getSummary();
      // 0.001 * 2.5 + 0.0005 * 10 = 0.0025 + 0.005 = 0.0075
      expect(summary.totalCostUsd).toBeCloseTo(0.0075, 6);
    });

    it('should calculate cost for gpt-4o-mini', () => {
      // gpt-4o-mini: $0.15/$0.6 per 1M tokens
      tracker.record({ inputTokens: 5000, outputTokens: 2000, totalTokens: 7000 }, 'gpt-4o-mini');
      const summary = tracker.getSummary();
      // 0.005 * 0.15 + 0.002 * 0.6 = 0.00075 + 0.0012 = 0.00195
      expect(summary.totalCostUsd).toBeCloseTo(0.00195, 6);
    });

    it('should handle unknown model with zero pricing', () => {
      tracker.record(
        { inputTokens: 9999, outputTokens: 8888, totalTokens: 18887 },
        'unknown-model'
      );
      const summary = tracker.getSummary();
      expect(summary.totalCostUsd).toBe(0);
    });

    it('should compute totalTokens as sum of input and output', () => {
      tracker.record(
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        'claude-haiku-4-5-20251001'
      );
      const summary = tracker.getSummary();
      expect(summary.totalTokens).toBe(150);
      expect(summary.totalInputTokens).toBe(100);
      expect(summary.totalOutputTokens).toBe(50);
    });

    it('should allow multiple records', () => {
      tracker.record(
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        'claude-haiku-4-5-20251001'
      );
      tracker.record({ inputTokens: 200, outputTokens: 100, totalTokens: 300 }, 'gpt-4o');
      expect(tracker.count).toBe(2);
    });
  });

  describe('getSummary()', () => {
    it('should return zeros when no records recorded', () => {
      const summary = tracker.getSummary();
      expect(summary).toEqual({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        callCount: 0,
      });
    });

    it('should aggregate multiple records correctly', () => {
      tracker.record(
        { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
        'claude-sonnet-4-20250514'
      );
      tracker.record({ inputTokens: 2000, outputTokens: 1000, totalTokens: 3000 }, 'gpt-4o');

      const summary = tracker.getSummary();
      expect(summary.totalInputTokens).toBe(3000);
      expect(summary.totalOutputTokens).toBe(1500);
      expect(summary.totalTokens).toBe(4500);
      expect(summary.callCount).toBe(2);

      // sonnet: 0.001*3 + 0.0005*15 = 0.0105
      // gpt-4o: 0.002*2.5 + 0.001*10 = 0.015
      // total: 0.0255
      expect(summary.totalCostUsd).toBeCloseTo(0.0255, 6);
    });

    it('should return correct callCount matching records', () => {
      tracker.record({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 'gpt-4o-mini');
      tracker.record({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 'gpt-4o-mini');
      tracker.record({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 'gpt-4o-mini');
      expect(tracker.getSummary().callCount).toBe(3);
    });
  });

  describe('reset()', () => {
    it('should clear all records', () => {
      tracker.record(
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        'claude-haiku-4-5-20251001'
      );
      tracker.reset();
      expect(tracker.count).toBe(0);
      expect(tracker.getSummary()).toEqual({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        callCount: 0,
      });
    });

    it('should allow recording after reset', () => {
      tracker.record(
        { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        'claude-haiku-4-5-20251001'
      );
      tracker.reset();
      tracker.record({ inputTokens: 200, outputTokens: 100, totalTokens: 300 }, 'gpt-4o');
      expect(tracker.count).toBe(1);
      expect(tracker.getSummary().totalInputTokens).toBe(200);
    });
  });

  describe('count getter', () => {
    it('should return 0 initially', () => {
      expect(tracker.count).toBe(0);
    });

    it('should increment after each record', () => {
      expect(tracker.count).toBe(0);
      tracker.record({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 'gpt-4o-mini');
      expect(tracker.count).toBe(1);
      tracker.record({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 'gpt-4o-mini');
      expect(tracker.count).toBe(2);
      tracker.record({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 'gpt-4o-mini');
      expect(tracker.count).toBe(3);
    });
  });
});

describe('global costTracker instance', () => {
  beforeEach(() => {
    costTracker.reset();
  });

  it('should be an instance of CostTracker', () => {
    expect(costTracker).toBeInstanceOf(CostTracker);
  });

  it('should start empty after reset', () => {
    expect(costTracker.count).toBe(0);
    expect(costTracker.getSummary().callCount).toBe(0);
  });
});
