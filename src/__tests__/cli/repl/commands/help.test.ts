import { describe, expect, it, vi } from 'vitest';
import { createHelpCommand } from '@/cli/repl/commands/help';
import type { ReplSession } from '@/cli/repl/types';

function createMockSession(overrides?: Partial<ReplSession>): ReplSession {
  return {
    currentState: 'idle',
    replOptions: {
      color: false,
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
      renderStatus: vi.fn().mockReturnValue([]),
    }),
    getHistoryStore: vi.fn(),
    getStats: vi.fn(),
    executeGoal: vi.fn(),
    appendOutput: vi.fn(),
    clearOutput: vi.fn(),
    requestRender: vi.fn(),
    getCommandRegistry: vi.fn().mockReturnValue({
      listCommands: () => [
        {
          name: 'help',
          aliases: ['h'],
          description: '显示帮助',
          usage: '/help',
          handler: vi.fn(),
        },
        {
          name: 'quit',
          aliases: ['q'],
          description: '退出',
          usage: '/quit',
          handler: vi.fn(),
        },
      ],
    }),
    getInputParser: vi.fn(),
    ...overrides,
  };
}

describe('/help command', () => {
  it('应显示可用命令列表', async () => {
    const session = createMockSession();
    const cmd = createHelpCommand();

    await cmd.handler([], session);

    expect(session.appendOutput).toHaveBeenCalledOnce();
    const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
    const lines = calls[0]?.[0] as string[] | undefined;
    const output = (lines ?? []).join('\n');
    expect(output).toContain('可用命令');
    expect(output).toContain('/help');
    expect(output).toContain('/quit');
    expect(output).toContain('显示帮助');
    expect(output).toContain('退出');
  });

  it('应显示提示信息', async () => {
    const session = createMockSession();
    const cmd = createHelpCommand();

    await cmd.handler([], session);

    const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
    const lines = calls[0]?.[0] as string[] | undefined;
    const output = (lines ?? []).join('\n');
    expect(output).toContain('直接输入自然语言');
    expect(output).toContain('续行');
    expect(output).toContain('Ctrl+C');
  });
});
