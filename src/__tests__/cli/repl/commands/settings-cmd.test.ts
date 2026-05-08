import { describe, expect, it, vi } from 'vitest';
import { createSettingsCommand } from '@/cli/repl/commands/settings-cmd';
import type { ReplSession } from '@/cli/repl/types';

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
    config: {
      llm: {
        defaultModel: 'deepseek/deepseek-chat',
        providers: {
          deepseek: {
            apiKey: 'sk-test-key',
            models: {
              'deepseek-chat': { id: 'deepseek-chat' },
            },
          },
          anthropic: {
            apiKey: '${ANTHROPIC_API_KEY}',
          },
        },
        defaults: { maxTokens: 8192, temperature: 0.7 },
      },
      scheduler: {
        maxConcurrency: 5,
        maxPerAgent: 3,
        taskTimeoutMs: 1800000,
        maxRetries: 3,
        retryBaseDelayMs: 1000,
      },
      agents: [{ id: 'code-agent', enabled: true }],
      cli: { color: true, debug: false, outputFormat: 'text' },
    },
    shutdown: vi.fn(),
    getRenderer: vi.fn().mockReturnValue({
      renderWelcome: vi.fn().mockReturnValue([]),
      renderError: vi.fn().mockReturnValue([]),
      renderResult: vi.fn().mockReturnValue([]),
      renderTaskGraph: vi.fn().mockReturnValue([]),
      renderAgents: vi.fn().mockReturnValue([]),
      renderConfig: vi.fn().mockReturnValue(['', '  ⚙️  current config', '']),
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
    getTui: vi.fn(),
    applyConfigUpdate: vi.fn(),
  };
}

describe('/settings command', () => {
  describe('createSettingsCommand', () => {
    it('应返回正确的命令定义', () => {
      const cmd = createSettingsCommand();
      expect(cmd.name).toBe('settings');
      expect(cmd.aliases).toContain('set');
      expect(cmd.description).toContain('configuration menu');
      expect(cmd.usage).toContain('list-providers');
    });
  });

  describe('list-providers', () => {
    it('应列出所有已知提供商并标记已配置状态', async () => {
      const session = createMockSession();
      const cmd = createSettingsCommand();

      await cmd.handler(['list-providers'], session);

      const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lines = (calls[0]?.[0] as string[]) ?? [];
      const output = lines.join('\n');

      // Contains header
      expect(output).toContain('Known providers:');

      // Contains known providers
      expect(output).toContain('Anthropic');
      expect(output).toContain('DeepSeek');
      expect(output).toContain('OpenAI');
      expect(output).toContain('xAI');
      expect(output).toContain('Groq');

      // deepseek is configured (has apiKey in mock)
      expect(output).toContain('DeepSeek');
    });
  });

  describe('list-models', () => {
    it('无提供商参数时应显示用法提示', async () => {
      const session = createMockSession();
      const cmd = createSettingsCommand();

      await cmd.handler(['list-models'], session);

      const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lines = (calls[0]?.[0] as string[]) ?? [];
      const output = lines.join('\n');
      expect(output).toContain('Usage');
    });

    it('提供商有模型时应列出模型', async () => {
      const session = createMockSession();
      const cmd = createSettingsCommand();

      await cmd.handler(['list-models', 'deepseek'], session);

      const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lines = (calls[0]?.[0] as string[]) ?? [];
      const output = lines.join('\n');
      expect(output).toContain('deepseek available models');
      // Should return model IDs from pi-ai registry
      expect(output).toContain('deepseek-v4-flash');
    });

    it('提供商没有模型时应提示', async () => {
      const session = createMockSession();
      const cmd = createSettingsCommand();

      await cmd.handler(['list-models', 'nonexistent'], session);

      const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lines = (calls[0]?.[0] as string[]) ?? [];
      const output = lines.join('\n');
      expect(output).toContain('no known models');
    });
  });

  describe('未知参数', () => {
    it('应显示用法说明', async () => {
      const session = createMockSession();
      const cmd = createSettingsCommand();

      await cmd.handler(['invalid-arg'], session);

      const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lines = (calls[0]?.[0] as string[]) ?? [];
      const output = lines.join('\n');
      expect(output).toContain('Usage:');
    });
  });
});
