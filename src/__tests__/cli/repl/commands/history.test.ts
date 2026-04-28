import { describe, expect, it, vi } from 'vitest';
import { createHistoryCommand } from '@/cli/repl/commands/history';
import type { HistoryEntry, ReplSession } from '@/cli/repl/types';

function createMockSession(entries?: HistoryEntry[]): ReplSession {
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
    getHistoryStore: vi.fn().mockReturnValue({
      getLast: vi.fn().mockReturnValue(entries ?? []),
      getAll: vi.fn().mockReturnValue(entries ?? []),
      push: vi.fn(),
      clear: vi.fn(),
      search: vi.fn().mockReturnValue([]),
    }),
    getStats: vi.fn(),
    executeGoal: vi.fn(),
    appendOutput: vi.fn(),
    clearOutput: vi.fn(),
    requestRender: vi.fn(),
    getCommandRegistry: vi.fn(),
    getInputParser: vi.fn(),
  };
}

describe('/history command', () => {
  it('无参数时应使用默认条数 (10)', () => {
    const session = createMockSession();
    const cmd = createHistoryCommand();

    cmd.handler([], session);

    const store = session.getHistoryStore() as unknown as { getLast: ReturnType<typeof vi.fn> };
    expect(store.getLast).toHaveBeenCalledWith(10);
  });

  it('指定参数时应使用指定的条数', () => {
    const session = createMockSession();
    const cmd = createHistoryCommand();

    cmd.handler(['20'], session);

    const store = session.getHistoryStore() as unknown as { getLast: ReturnType<typeof vi.fn> };
    expect(store.getLast).toHaveBeenCalledWith(20);
  });

  it('无效参数时应输出错误提示到输出区', () => {
    const session = createMockSession();
    const cmd = createHistoryCommand();

    cmd.handler(['abc'], session);

    expect(session.appendOutput).toHaveBeenCalledOnce();
    const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
    const lines = calls[0]?.[0] as string[] | undefined;
    const output = (lines ?? []).join('\n');
    expect(output).toContain('参数错误');
  });

  it('负数参数应输出错误提示到输出区', () => {
    const session = createMockSession();
    const cmd = createHistoryCommand();

    cmd.handler(['-5'], session);

    expect(session.appendOutput).toHaveBeenCalledOnce();
    const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
    const lines = calls[0]?.[0] as string[] | undefined;
    const output = (lines ?? []).join('\n');
    expect(output).toContain('参数错误');
  });
});
