import { describe, expect, it, vi } from 'vitest';

// 使用 vi.hoisted() 提升变量
const { mockConfig, mockSessionStart } = vi.hoisted(() => ({
  mockConfig: {
    llm: { provider: 'anthropic', apiKey: 'sk-test' },
    scheduler: {
      maxConcurrency: 5,
      maxPerAgent: 3,
      taskTimeoutMs: 1800000,
      maxRetries: 3,
      retryBaseDelayMs: 1000,
    },
    agents: [{ id: 'test-agent', enabled: true }],
    cli: { color: false, debug: false, outputFormat: 'text' },
  },
  mockSessionStart: vi.fn(),
}));

// Mock config loader
vi.mock('../../../config/loader.js', () => ({
  loadConfig: vi.fn().mockResolvedValue(mockConfig),
}));

// Mock ReplSession
vi.mock('../../../cli/repl/session.js', () => ({
  ReplSession: class MockReplSession {
    start = mockSessionStart;
    constructor(_config: unknown) {}
  },
}));

import { startRepl } from '../../../cli/repl/index.js';

describe('startRepl', () => {
  it('应加载配置并创建会话后启动', async () => {
    await startRepl();

    expect(mockSessionStart).toHaveBeenCalledTimes(1);
  });
});
