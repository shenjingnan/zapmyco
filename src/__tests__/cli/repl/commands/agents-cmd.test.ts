import { describe, expect, it, vi } from 'vitest';
import { createAgentsCommand } from '@/cli/repl/commands/agents-cmd';
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
    config: {
      llm: { provider: 'anthropic' },
      scheduler: {
        maxConcurrency: 5,
        maxPerAgent: 3,
        taskTimeoutMs: 1800000,
        maxRetries: 3,
        retryBaseDelayMs: 1000,
      },
      agents: [
        { id: 'code-agent', enabled: true },
        { id: 'security-scanner', enabled: true },
        { id: 'disabled-agent', enabled: false },
      ],
      cli: { color: true, debug: false, outputFormat: 'text' },
    },
    shutdown: vi.fn(),
    getRenderer: vi.fn().mockReturnValue({
      renderWelcome: vi.fn().mockReturnValue([]),
      renderError: vi.fn().mockReturnValue([]),
      renderResult: vi.fn().mockReturnValue([]),
      renderTaskGraph: vi.fn().mockReturnValue([]),
      renderAgents: vi.fn(),
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
    getCommandRegistry: vi.fn(),
    getInputParser: vi.fn(),
  };
}

describe('/agents command', () => {
  it('应调用 renderAgents 并只包含启用的 Agent', () => {
    const session = createMockSession();
    const cmd = createAgentsCommand();

    cmd.handler([], session);

    const renderer = session.getRenderer() as unknown as { renderAgents: ReturnType<typeof vi.fn> };
    expect(renderer.renderAgents).toHaveBeenCalledOnce();

    const callArgs = renderer.renderAgents.mock.calls[0];
    if (!callArgs) return;
    const agentsArg = callArgs[0] as { agentId: string }[];
    expect(agentsArg).toHaveLength(2);
    expect(agentsArg.map((a) => a.agentId)).toEqual(
      expect.arrayContaining(['code-agent', 'security-scanner'])
    );
    expect(agentsArg.map((a) => a.agentId)).not.toContain('disabled-agent');
  });
});
