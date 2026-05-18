import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentsCommand } from '@/cli/repl/commands/agents-cmd';
import type { ReplSession } from '@/cli/repl/types';
import { resetAgentInstanceManager } from '@/core/agent-team/agent-instance-manager';
import { resetAgentTypeRegistry } from '@/core/agent-team/agent-type-registry';

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
      llm: {
        defaultModel: 'anthropic/claude-sonnet-4-20250514',
        providers: {},
      },
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
    clearAgentContext: vi.fn(),
    requestRender: vi.fn(),
    getCommandRegistry: vi.fn(),
    getInputParser: vi.fn(),
    getTui: vi.fn(),
    applyConfigUpdate: vi.fn(),
  };
}

describe('/agents command', () => {
  beforeEach(() => {
    // 重置全局单例状态，确保每个测试独立
    resetAgentTypeRegistry();
    resetAgentInstanceManager();
  });

  it('应在无参数时显示概览（从 AgentTypeRegistry 获取类型）', () => {
    const session = createMockSession();
    const cmd = createAgentsCommand();

    cmd.handler([], session);

    // 应调用 appendOutput，输出包含概览信息
    expect(session.appendOutput).toHaveBeenCalledOnce();
    const output = (session.appendOutput as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string[];
    const text = output.join('\n');

    // 应包含 6 个内置 Agent 类型（含 coordinator）
    expect(text).toContain('Agent Team 概览');
    expect(text).toContain('researcher');
    expect(text).toContain('coder');
    expect(text).toContain('reviewer');
    expect(text).toContain('planner');
    expect(text).toContain('general-purpose');
    expect(text).toContain('coordinator');
    expect(text).toContain('6 个');
  });

  it('应在 /agents types 时显示类型列表', () => {
    const session = createMockSession();
    const cmd = createAgentsCommand();

    cmd.handler(['types'], session);

    expect(session.appendOutput).toHaveBeenCalledOnce();
    const output = (session.appendOutput as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string[];
    const text = output.join('\n');

    expect(text).toContain('Agent 类型列表');
    expect(text).toContain('coordinator');
    expect(text).toContain('协调者');
    expect(text).toContain('researcher');
    expect(text).toContain('coder');
    expect(text).toContain('共 6 个类型');
  });

  it('应在 /agents instances 时显示实例列表', () => {
    const session = createMockSession();
    const cmd = createAgentsCommand();

    cmd.handler(['instances'], session);

    expect(session.appendOutput).toHaveBeenCalledOnce();
    const output = (session.appendOutput as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string[];
    const text = output.join('\n');

    expect(text).toContain('Agent 实例列表');
    expect(text).toContain('当前没有运行中的 Agent 实例');
  });

  it('应在 /agents team 时显示状态统计', () => {
    const session = createMockSession();
    const cmd = createAgentsCommand();

    cmd.handler(['team'], session);

    expect(session.appendOutput).toHaveBeenCalledOnce();
    const output = (session.appendOutput as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string[];
    const text = output.join('\n');

    expect(text).toContain('Agent 状态统计');
    expect(text).toContain('Agent 消息记录');
  });

  it('别名已移除，aliases 应为空', () => {
    const cmd = createAgentsCommand();
    expect(cmd.aliases).toEqual([]);
  });

  it('应支持简写子命令 (t/i/s)', () => {
    const session = createMockSession();
    const cmd = createAgentsCommand();

    // 't' → types
    cmd.handler(['t'], session);
    let text = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].join('\n');
    expect(text).toContain('Agent 类型列表');

    // 'i' → instances
    const session2 = createMockSession();
    cmd.handler(['i'], session2);
    text = (session2.appendOutput as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].join('\n');
    expect(text).toContain('Agent 实例列表');

    // 's' → team/status
    const session3 = createMockSession();
    cmd.handler(['s'], session3);
    text = (session3.appendOutput as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].join('\n');
    expect(text).toContain('Agent 状态统计');
  });

  it('应在未知子命令时回退到概览', () => {
    const session = createMockSession();
    const cmd = createAgentsCommand();

    cmd.handler(['unknown-sub'], session);

    const output = (session.appendOutput as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string[];
    const text = output.join('\n');

    expect(text).toContain('Agent Team 概览');
  });
});
