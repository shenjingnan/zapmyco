import { describe, expect, it, vi } from 'vitest';
import { createConfigCommand } from '../../../../cli/repl/commands/config-cmd.js';
import type { ReplSession } from '../../../../cli/repl/types.js';
import type { ZapmycoConfig } from '../../../../config/types.js';

const mockConfig: ZapmycoConfig = {
  llm: { provider: 'anthropic', apiKey: 'sk-test-key', model: 'claude-sonnet-4-20250514' },
  scheduler: {
    maxConcurrency: 5,
    maxPerAgent: 3,
    taskTimeoutMs: 1800000,
    maxRetries: 3,
    retryBaseDelayMs: 1000,
  },
  agents: [
    { id: 'code-agent', enabled: true },
    { id: 'test-agent', enabled: false },
  ],
  cli: { color: true, debug: false, outputFormat: 'text' },
};

function createMockSession(): ReplSession {
  return {
    currentState: 'idle',
    replOptions: {
      color: false,
      debug: false,
      maxHistorySize: 100,
      prompt: '> ',
      continuationPrompt: '... ',
    },
    config: mockConfig,
    shutdown: vi.fn(),
    getRenderer: vi.fn().mockReturnValue({
      renderWelcome: vi.fn().mockReturnValue([]),
      renderError: vi.fn().mockReturnValue([]),
      renderResult: vi.fn().mockReturnValue([]),
      renderTaskGraph: vi.fn().mockReturnValue([]),
      renderAgents: vi.fn().mockReturnValue([]),
      renderConfig: vi.fn().mockReturnValue(['', '  ⚙️  当前配置', '']),
      renderHistory: vi.fn().mockReturnValue([]),
      renderStatus: vi.fn().mockReturnValue([]),
    }),
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

describe('/config command', () => {
  it('无参数或 show 应调用 renderConfig 并追加到输出区', () => {
    const session = createMockSession();
    const cmd = createConfigCommand();

    cmd.handler([], session);

    const renderer = session.getRenderer() as unknown as { renderConfig: ReturnType<typeof vi.fn> };
    expect(renderer.renderConfig).toHaveBeenCalledWith(mockConfig);
    expect(session.appendOutput).toHaveBeenCalledOnce();
  });

  it('show 参数应调用 renderConfig', () => {
    const session = createMockSession();
    const cmd = createConfigCommand();

    cmd.handler(['show'], session);

    const renderer = session.getRenderer() as unknown as { renderConfig: ReturnType<typeof vi.fn> };
    expect(renderer.renderConfig).toHaveBeenCalledOnce();
  });

  it('get 参数应输出单项配置值（apiKey 脱敏）到输出区', () => {
    const session = createMockSession();
    const cmd = createConfigCommand();

    cmd.handler(['get', 'llm.provider'], session);

    expect(session.appendOutput).toHaveBeenCalledOnce();
    const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
    const lines = calls[0]?.[0] as string[] | undefined;
    expect(lines).toBeDefined();
    const output = (lines ?? []).join('\n');
    expect(output).toContain('anthropic');
  });

  it('get apiKey 应脱敏显示', () => {
    const session = createMockSession();
    const cmd = createConfigCommand();

    cmd.handler(['get', 'llm.apiKey'], session);

    const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
    const lines = calls[0]?.[0] as string[] | undefined;
    const output = (lines ?? []).join('\n');
    expect(output).toContain('已配置');
    expect(output).not.toContain('sk-test-key');
  });

  it('get 不存在的配置项应显示未找到', () => {
    const session = createMockSession();
    const cmd = createConfigCommand();

    cmd.handler(['get', 'nonexistent.key'], session);

    const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
    const lines = calls[0]?.[0] as string[] | undefined;
    const output = (lines ?? []).join('\n');
    expect(output).toContain('未找到');
  });
});
