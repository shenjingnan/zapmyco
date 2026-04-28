import { describe, expect, it, vi } from 'vitest';
import { createClearCommand } from '../../../../cli/repl/commands/clear.js';
import type { ReplSession } from '../../../../cli/repl/types.js';

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
    shutdown: vi.fn(),
    getRenderer: vi.fn(),
    getHistoryStore: vi.fn(),
    getStats: vi.fn(),
    executeGoal: vi.fn(),
    appendOutput: vi.fn(),
    clearOutput: vi.fn(),
    requestRender: vi.fn(),
    getCommandRegistry: vi.fn(),
    getInputParser: vi.fn().mockReturnValue({
      reset: vi.fn(),
    }),
  };
}

describe('/clear command', () => {
  it('应清空输出区域并重置解析器', () => {
    const session = createMockSession();
    const cmd = createClearCommand();

    cmd.handler([], session);

    expect(session.clearOutput).toHaveBeenCalledOnce();

    const parser = session.getInputParser() as unknown as { reset: ReturnType<typeof vi.fn> };
    expect(parser.reset).toHaveBeenCalledOnce();
  });
});
