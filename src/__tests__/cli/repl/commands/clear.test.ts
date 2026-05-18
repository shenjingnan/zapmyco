import { describe, expect, it, vi } from 'vitest';
import { createClearCommand } from '@/cli/repl/commands/clear';
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
    getTui: vi.fn(),
    applyConfigUpdate: vi.fn(),
    clearAgentContext: vi.fn(),
  };
}

describe('/clear command', () => {
  it('应清空 Agent 上下文并重置解析器', () => {
    const session = createMockSession();
    const cmd = createClearCommand();

    cmd.handler([], session);

    expect(session.clearAgentContext).toHaveBeenCalledOnce();

    const parser = session.getInputParser() as unknown as { reset: ReturnType<typeof vi.fn> };
    expect(parser.reset).toHaveBeenCalledOnce();
  });

  it('清空 Agent 上下文应在重置解析器之前调用', () => {
    const session = createMockSession();
    const cmd = createClearCommand();

    const parser = { reset: vi.fn() };
    session.getInputParser = vi.fn().mockReturnValue(parser);

    cmd.handler([], session);

    expect(session.clearAgentContext).toHaveBeenCalledOnce();
    expect(parser.reset).toHaveBeenCalledOnce();
  });
});
