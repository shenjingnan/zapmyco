import { describe, expect, it, vi } from 'vitest';
import { createStatusCommand } from '@/cli/repl/commands/status';
import type { ReplSession } from '@/cli/repl/types';

function createMockSession(): ReplSession {
  return {
    currentState: 'executing',
    replOptions: {
      color: true,
      debug: false,
      maxHistorySize: 100,
      prompt: '> ',
      continuationPrompt: '... ',
    },
    config: {} as ReplSession['config'],
    shutdown: vi.fn(),
    getRenderer: vi.fn().mockReturnValue({
      renderWelcome: vi.fn().mockReturnValue([]),
      renderError: vi.fn().mockReturnValue([]),
      renderResult: vi.fn().mockReturnValue([]),
      renderTaskGraph: vi.fn().mockReturnValue([]),
      renderAgents: vi.fn().mockReturnValue([]),
      renderConfig: vi.fn().mockReturnValue([]),
      renderHistory: vi.fn().mockReturnValue([]),
      renderStatus: vi.fn().mockReturnValue(['', '  📊 会话状态', '']),
    }),
    getHistoryStore: vi.fn(),
    getStats: vi.fn().mockReturnValue({
      totalRequests: 10,
      successCount: 8,
      failureCount: 2,
      totalTokens: 50000,
      totalCostUsd: 0.1234,
      state: 'executing',
    }),
    executeGoal: vi.fn(),
    appendOutput: vi.fn(),
    clearOutput: vi.fn(),
    requestRender: vi.fn(),
    getCommandRegistry: vi.fn(),
    getInputParser: vi.fn(),
  };
}

describe('/status command', () => {
  it('应调用 renderStatus 并将结果追加到输出区', () => {
    const session = createMockSession();
    const cmd = createStatusCommand();

    cmd.handler([], session);

    expect(session.getStats).toHaveBeenCalledOnce();
    const renderer = session.getRenderer() as unknown as { renderStatus: ReturnType<typeof vi.fn> };
    expect(renderer.renderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        totalRequests: 10,
        successCount: 8,
        failureCount: 2,
        state: 'executing',
      })
    );
    expect(session.appendOutput).toHaveBeenCalledOnce();
  });
});
