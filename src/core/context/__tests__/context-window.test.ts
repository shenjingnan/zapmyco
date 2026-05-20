import { describe, expect, it } from 'vitest';
import type { Model } from '@/core/agent-runtime/runtime-types';
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_OUTPUT_RESERVE,
  getEffectiveContextWindow,
  getKnownContextWindow,
  getUsagePercent,
  resolveContextWindow,
  shouldTriggerCompaction,
} from '../context-window';

function createModel(overrides?: {
  id?: string;
  provider?: string;
  contextWindow?: number;
  maxTokens?: number;
}): Model {
  return {
    id: overrides?.id ?? 'test-model',
    provider: overrides?.provider ?? 'test-provider',
    contextWindow: overrides?.contextWindow,
    maxTokens: overrides?.maxTokens,
  } as unknown as Model;
}

describe('resolveContextWindow', () => {
  it('should use model.contextWindow when available', () => {
    const model = createModel({ contextWindow: 100_000 });
    const info = resolveContextWindow(model);
    expect(info.contextWindow).toBe(100_000);
  });

  it('should fallback to KNOWN_CONTEXT_WINDOWS by model.id', () => {
    const model = createModel({ id: 'claude-sonnet-4-20250514' });
    const info = resolveContextWindow(model);
    expect(info.contextWindow).toBe(200_000);
  });

  it('should fallback to DEFAULT_CONTEXT_WINDOW when id is unknown', () => {
    const model = createModel({ id: 'unknown-model-12345' });
    const info = resolveContextWindow(model);
    expect(info.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('should use maxTokens as outputReserve (capped at DEFAULT_OUTPUT_RESERVE)', () => {
    const model = createModel({ contextWindow: 100_000, maxTokens: 4096 });
    const info = resolveContextWindow(model);
    expect(info.outputReserve).toBe(4096);
    expect(info.effectiveWindow).toBe(100_000 - 4096);
  });

  it('should cap outputReserve at DEFAULT_OUTPUT_RESERVE', () => {
    const model = createModel({ contextWindow: 200_000, maxTokens: 100_000 });
    const info = resolveContextWindow(model);
    expect(info.outputReserve).toBe(DEFAULT_OUTPUT_RESERVE);
  });

  it('should use DEFAULT_OUTPUT_RESERVE when maxTokens is undefined', () => {
    const model = createModel({ contextWindow: 128_000 });
    const info = resolveContextWindow(model);
    expect(info.outputReserve).toBe(DEFAULT_OUTPUT_RESERVE);
    expect(info.effectiveWindow).toBe(128_000 - DEFAULT_OUTPUT_RESERVE);
  });

  it('should return modelId and provider in the info', () => {
    const model = createModel({ id: 'gpt-4o', provider: 'openai', contextWindow: 128_000 });
    const info = resolveContextWindow(model);
    expect(info.modelId).toBe('gpt-4o');
    expect(info.provider).toBe('openai');
  });

  it('should handle gemini-2.5-pro known window', () => {
    const model = createModel({ id: 'gemini-2.5-pro' });
    const info = resolveContextWindow(model);
    expect(info.contextWindow).toBe(1_048_576);
  });
});

describe('getKnownContextWindow', () => {
  it('should return window size for known model key with provider prefix', () => {
    expect(getKnownContextWindow('anthropic/claude-sonnet-4-20250514')).toBe(200_000);
  });

  it('should return window size for known model key without prefix', () => {
    expect(getKnownContextWindow('deepseek-v3')).toBe(128_000);
  });

  it('should return DEFAULT_CONTEXT_WINDOW for unknown model key', () => {
    expect(getKnownContextWindow('unknown/model')).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('should return DEFAULT_CONTEXT_WINDOW for empty string', () => {
    // 'empty'.split('/').pop() = 'empty', not in known windows
    expect(getKnownContextWindow('')).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe('getEffectiveContextWindow', () => {
  it('should calculate effective window with default reserve', () => {
    expect(getEffectiveContextWindow(200_000)).toBe(200_000 - DEFAULT_OUTPUT_RESERVE);
  });

  it('should calculate with custom maxOutputTokens', () => {
    expect(getEffectiveContextWindow(200_000, 4096)).toBe(200_000 - 4096);
  });

  it('should cap custom maxOutputTokens at DEFAULT_OUTPUT_RESERVE', () => {
    expect(getEffectiveContextWindow(200_000, 100_000)).toBe(200_000 - DEFAULT_OUTPUT_RESERVE);
  });
});

describe('getUsagePercent', () => {
  it('should return 0.5 for half usage', () => {
    expect(getUsagePercent(50_000, 100_000)).toBe(0.5);
  });

  it('should return 1 for usage exceeding effective window', () => {
    expect(getUsagePercent(200_000, 100_000)).toBe(1);
  });

  it('should return 1 when effectiveWindow is 0', () => {
    expect(getUsagePercent(100, 0)).toBe(1);
  });

  it('should return 1 when effectiveWindow is negative', () => {
    expect(getUsagePercent(100, -10)).toBe(1);
  });

  it('should return 1 for exact usage', () => {
    expect(getUsagePercent(100_000, 100_000)).toBe(1);
  });
});

describe('shouldTriggerCompaction', () => {
  it('should return false when below default threshold', () => {
    expect(shouldTriggerCompaction(50_000, 100_000)).toBe(false);
  });

  it('should return true when above default threshold', () => {
    expect(shouldTriggerCompaction(71_000, 100_000)).toBe(true);
  });

  it('should return true when exactly at threshold', () => {
    expect(shouldTriggerCompaction(70_000, 100_000)).toBe(true);
  });

  it('should use custom threshold', () => {
    // 50% usage with 0.5 threshold should trigger
    expect(shouldTriggerCompaction(50_000, 100_000, 0.5)).toBe(true);
    // 50% usage with 0.6 threshold should not trigger
    expect(shouldTriggerCompaction(50_000, 100_000, 0.6)).toBe(false);
  });
});

describe('constants', () => {
  it('DEFAULT_CONTEXT_WINDOW should be 200,000', () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(200_000);
  });

  it('DEFAULT_OUTPUT_RESERVE should be 20,000', () => {
    expect(DEFAULT_OUTPUT_RESERVE).toBe(20_000);
  });
});
