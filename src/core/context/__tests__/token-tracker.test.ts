import { describe, expect, it } from 'vitest';
import { estimateMessagesTokens, roughTokenEstimate, TokenTracker } from '../token-tracker';

describe('roughTokenEstimate', () => {
  it('should return 0 for empty string', () => {
    expect(roughTokenEstimate('')).toBe(0);
  });

  it('should estimate tokens using default bytesPerToken (4)', () => {
    // 'hello' = 5 chars, ceil(5/4) = 2
    expect(roughTokenEstimate('hello')).toBe(2);
  });

  it('should estimate tokens with custom bytesPerToken', () => {
    // 'hello' = 5 chars, ceil(5/2) = 3
    expect(roughTokenEstimate('hello', 2)).toBe(3);
  });

  it('should return 1 for single character with default bytesPerToken', () => {
    expect(roughTokenEstimate('a')).toBe(1);
  });

  it('should handle long strings', () => {
    const text = 'a'.repeat(1000);
    expect(roughTokenEstimate(text)).toBe(250);
  });
});

describe('estimateMessagesTokens', () => {
  it('should return 0 for empty array', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it('should return 0 for null/undefined', () => {
    expect(estimateMessagesTokens(null as unknown as readonly unknown[])).toBe(0);
    expect(estimateMessagesTokens(undefined as unknown as readonly unknown[])).toBe(0);
  });

  it('should estimate tokens for messages with string content', () => {
    const messages = [
      { role: 'user', content: 'Hello world' }, // 11 chars
    ];
    const result = estimateMessagesTokens(messages);
    const baseTokens = Math.ceil(11 / 4); // 3
    const expected = baseTokens + Math.ceil(baseTokens * 0.1); // 3 + 1 = 4
    expect(result).toBe(expected);
  });

  it('should estimate tokens for messages with content block arrays', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello' }, // 5 chars
          { type: 'thinking', thinking: 'Hmm' }, // 3 chars
        ],
      },
    ];
    const result = estimateMessagesTokens(messages);
    const baseTokens = Math.ceil(8 / 4); // 2
    const expected = baseTokens + Math.ceil(baseTokens * 0.1); // 2 + 1 = 3
    expect(result).toBe(expected);
  });

  it('should handle toolCall blocks with string arguments', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', arguments: '{"key":"value"}' }, // 16 chars
        ],
      },
    ];
    const result = estimateMessagesTokens(messages);
    const baseTokens = Math.ceil(16 / 4); // 4
    const expected = baseTokens + Math.ceil(baseTokens * 0.1); // 4+1 = 5
    expect(result).toBe(expected);
  });

  it('should handle toolCall blocks with object arguments', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', arguments: { key: 'value' } }, // JSON.stringify -> '{"key":"value"}' = 16 chars
        ],
      },
    ];
    const result = estimateMessagesTokens(messages);
    const baseTokens = Math.ceil(16 / 4); // 4
    const expected = baseTokens + Math.ceil(baseTokens * 0.1);
    expect(result).toBe(expected);
  });

  it('should handle summary messages', () => {
    const messages = [
      { role: 'summary', text: 'Summary text here' }, // 17 chars
    ];
    const result = estimateMessagesTokens(messages);
    const baseTokens = Math.ceil(17 / 4); // 5
    const expected = baseTokens + Math.ceil(baseTokens * 0.1);
    expect(result).toBe(expected);
  });

  it('should skip non-object entries in the array', () => {
    const messages = [
      { role: 'user', content: 'Hello' }, // 5 chars
      null,
      undefined,
      'string',
      123,
    ];
    const result = estimateMessagesTokens(messages);
    const baseTokens = Math.ceil(5 / 4); // 2
    const expected = baseTokens + Math.ceil(baseTokens * 0.1);
    expect(result).toBe(expected);
  });

  it('should add 10% overhead for message structure', () => {
    const messages = [
      { role: 'user', content: 'x'.repeat(40) }, // 40 chars
    ];
    const result = estimateMessagesTokens(messages);
    // baseTokens = ceil(40/4) = 10
    // overhead = ceil(10 * 0.1) = 1
    // total = 11
    expect(result).toBe(11);
  });
});

describe('TokenTracker', () => {
  const createUsage = (
    overrides?: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }>
  ) =>
    ({
      input: overrides?.input ?? 100,
      output: overrides?.output ?? 50,
      cacheRead: overrides?.cacheRead ?? 0,
      cacheWrite: overrides?.cacheWrite ?? 0,
      totalTokens: (overrides?.input ?? 100) + (overrides?.output ?? 50),
      cost: {} as unknown as Record<string, never>,
    }) as unknown as import('@/core/agent-runtime/runtime-types').Usage;

  it('should have correct initial state', () => {
    const tracker = new TokenTracker();
    expect(tracker.initialized).toBe(false);
    expect(tracker.inputTokens).toBe(0);
    expect(tracker.outputTokens).toBe(0);
    expect(tracker.totalTokens).toBe(0);
    expect(tracker.turnCount).toBe(0);
  });

  it('should record usage and update counters', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 150, output: 75 }));

    expect(tracker.initialized).toBe(true);
    expect(tracker.inputTokens).toBe(150);
    expect(tracker.outputTokens).toBe(75);
    expect(tracker.totalTokens).toBe(225);
    expect(tracker.turnCount).toBe(1);
  });

  it('should accumulate multiple usage records', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, output: 50 }));
    tracker.recordUsage(createUsage({ input: 200, output: 100 }));

    expect(tracker.inputTokens).toBe(300);
    expect(tracker.outputTokens).toBe(150);
    expect(tracker.totalTokens).toBe(450);
    expect(tracker.turnCount).toBe(2);
  });

  it('should track cache tokens', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, output: 50, cacheRead: 200, cacheWrite: 60 }));

    expect(tracker.inputTokens).toBe(100);
    expect(tracker.outputTokens).toBe(50);
  });

  it('should return correct snapshot', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, output: 50 }));

    const snapshot = tracker.getSnapshot(10);
    expect(snapshot.inputTokens).toBe(100);
    expect(snapshot.outputTokens).toBe(50);
    expect(snapshot.totalTokens).toBe(150);
    expect(snapshot.cacheReadTokens).toBe(0);
    expect(snapshot.cacheWriteTokens).toBe(0);
    expect(snapshot.messageCount).toBe(10);
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  it('should reset counters but not usage history', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage());

    expect(tracker.initialized).toBe(true);

    tracker.reset();

    expect(tracker.inputTokens).toBe(0);
    expect(tracker.outputTokens).toBe(0);
    expect(tracker.totalTokens).toBe(0);
    // turnCount is based on _usageHistory which is NOT cleared by reset
    expect(tracker.turnCount).toBe(1);
  });
});

describe('TokenTracker advanced metrics', () => {
  const createUsage = (
    overrides?: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }>
  ) =>
    ({
      input: overrides?.input ?? 100,
      output: overrides?.output ?? 50,
      cacheRead: overrides?.cacheRead ?? 0,
      cacheWrite: overrides?.cacheWrite ?? 0,
      totalTokens: (overrides?.input ?? 100) + (overrides?.output ?? 50),
      cost: {} as unknown as Record<string, never>,
    }) as unknown as import('@/core/agent-runtime/runtime-types').Usage;

  it('getCacheHitRate 空历史返回 0', () => {
    const tracker = new TokenTracker();
    expect(tracker.getCacheHitRate()).toBe(0);
    expect(tracker.getCacheHitRate(3)).toBe(0);
  });

  it('getCacheHitRate 正常计算', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, cacheRead: 80 }));
    tracker.recordUsage(createUsage({ input: 200, cacheRead: 100 }));

    // (80 + 100) / (100 + 200) = 0.6
    expect(tracker.getCacheHitRate(5)).toBeCloseTo(0.6);
  });

  it('getCacheHitRate 使用指定窗口大小', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, cacheRead: 80 }));
    tracker.recordUsage(createUsage({ input: 200, cacheRead: 100 }));

    // window=1: 只取最后一次 100/200 = 0.5
    expect(tracker.getCacheHitRate(1)).toBeCloseTo(0.5);
  });

  it('getCacheHitRate 零输入返回 0', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 0, cacheRead: 0 }));

    expect(tracker.getCacheHitRate()).toBe(0);
  });

  it('detectCacheBreak 单次调用返回 null', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, cacheRead: 5000 }));

    expect(tracker.detectCacheBreak()).toBeNull();
  });

  it('detectCacheBreak 检测到缓存断裂', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, cacheRead: 5000 }));
    tracker.recordUsage(createUsage({ input: 100, cacheRead: 500 }));

    const result = tracker.detectCacheBreak();
    expect(result).toEqual({
      broken: true,
      previousRead: 5000,
      currentRead: 500,
    });
  });

  it('detectCacheBreak 未断裂', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, cacheRead: 5000 }));
    tracker.recordUsage(createUsage({ input: 100, cacheRead: 3000 }));

    const result = tracker.detectCacheBreak();
    expect(result).toEqual({
      broken: false,
      previousRead: 5000,
      currentRead: 3000,
    });
  });

  it('getAverageCacheRatio 空历史返回 0', () => {
    const tracker = new TokenTracker();
    expect(tracker.getAverageCacheRatio()).toBe(0);
  });

  it('getAverageCacheRatio 正常计算', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, cacheRead: 60 })); // 0.6
    tracker.recordUsage(createUsage({ input: 200, cacheRead: 100 })); // 0.5

    // (0.6 + 0.5) / 2 = 0.55
    expect(tracker.getAverageCacheRatio(5)).toBeCloseTo(0.55);
  });

  it('getAverageCacheRatio 过滤零输入调用', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 0, cacheRead: 0 })); // filtered
    tracker.recordUsage(createUsage({ input: 100, cacheRead: 50 })); // 0.5

    // 0.5 / 1 = 0.5
    expect(tracker.getAverageCacheRatio(5)).toBeCloseTo(0.5);
  });

  it('getUsage 返回正确的 TokenUsage 快照', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, output: 50, cacheRead: 30, cacheWrite: 20 }));

    const usage = tracker.getUsage();
    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 30,
      cacheWriteTokens: 20,
      estimatedCostUsd: 0,
    });
  });

  it('reset 清除缓存指标后 getCacheHitRate 返回 0', () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(createUsage({ input: 100, cacheRead: 80 }));
    tracker.recordUsage(createUsage({ input: 200, cacheRead: 100 }));

    expect(tracker.getCacheHitRate()).toBeCloseTo(0.6);

    tracker.reset();

    expect(tracker.getCacheHitRate()).toBe(0);
    expect(tracker.getAverageCacheRatio()).toBe(0);
  });
});
