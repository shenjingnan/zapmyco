import { describe, expect, it, vi } from 'vitest';
import { createQuitCommand } from '@/cli/repl/commands/quit';
import type { ReplSession } from '@/cli/repl/types';

function createMockSession(): ReplSession {
  return {
    currentState: 'idle',
    replOptions: {
      color: true,
      debug: false,
      maxHistorySize: 100,
      prompt: '> ',
      continuationPrompt: '... ',
    },
    config: {} as ReplSession['config'],
    shutdown: vi.fn().mockResolvedValue(undefined),
    getRenderer: vi.fn(),
    getHistoryStore: vi.fn(),
    getStats: vi.fn(),
    executeGoal: vi.fn(),
    appendOutput: vi.fn(),
    clearOutput: vi.fn(),
    requestRender: vi.fn(),
    getCommandRegistry: vi.fn(),
    getInputParser: vi.fn(),
  };
}

describe('/quit command', () => {
  it('应调用 session.shutdown 并传入退出原因', async () => {
    const session = createMockSession();
    const cmd = createQuitCommand();

    await cmd.handler([], session);

    expect(session.shutdown).toHaveBeenCalledWith('用户主动退出');
  });
});
