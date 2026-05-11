import { describe, expect, it, vi } from 'vitest';
import { createSecurityCommand } from '@/cli/repl/commands/security-cmd';
import type { ReplSession } from '@/cli/repl/types';
import type { SecurityHealthReport } from '@/security/types';

function createMockSession(
  overrides: {
    healthReport?: SecurityHealthReport | undefined;
    renderSecurityHealth?: (report: SecurityHealthReport) => string[];
  } = {}
): ReplSession {
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
      renderStatus: vi.fn().mockReturnValue([]),
      renderSecurityHealth:
        overrides.renderSecurityHealth === undefined
          ? undefined
          : vi.fn(overrides.renderSecurityHealth),
    }),
    getHistoryStore: vi.fn(),
    getStats: vi.fn().mockReturnValue({
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      state: 'idle',
    }),
    executeGoal: vi.fn(),
    appendOutput: vi.fn(),
    clearOutput: vi.fn(),
    requestRender: vi.fn(),
    getCommandRegistry: vi.fn(),
    getInputParser: vi.fn(),
    getTui: vi.fn(),
    applyConfigUpdate: vi.fn(),
    getSecurityHealthReport:
      overrides.healthReport === undefined
        ? undefined
        : vi.fn().mockReturnValue(overrides.healthReport),
  } as ReplSession;
}

/** 安全地从 mock session 提取 appendOutput 输出 */
function extractOutput(session: ReplSession): string[] {
  const fn = session.appendOutput as ReturnType<typeof vi.fn>;
  const calls = fn.mock.calls;
  const firstCall = calls[0];
  return Array.isArray(firstCall) ? ((firstCall as string[][])[0] ?? []) : [];
}

function createBaseReport(overrides: Partial<SecurityHealthReport> = {}): SecurityHealthReport {
  return {
    overallScore: 75,
    scores: {
      permissions: 70,
      shell: 80,
      filesystem: 75,
      ssrf: 75,
      secrets: 70,
      sandbox: 30,
    },
    recentBlocks: [],
    stats: {
      totalDecisions: 10,
      blockedCount: 2,
      approvedCount: 7,
      deniedCount: 1,
      doomLoopTriggers: 0,
    },
    recommendations: [],
    ...overrides,
  };
}

describe('/audit command', () => {
  describe('handler', () => {
    it('should show warning when security framework not initialized', () => {
      const session = createMockSession(); // no getSecurityHealthReport
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      expect(session.appendOutput).toHaveBeenCalledWith([
        '',
        '  安全框架未初始化，无法生成报告',
        '',
      ]);
    });

    it('should render health report with overall score', () => {
      const session = createMockSession({
        healthReport: createBaseReport({ overallScore: 85 }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output).toBeDefined();
      expect(output.some((line: string) => line.includes('安全健康报告'))).toBe(true);
      expect(output.some((line: string) => line.includes('85/100'))).toBe(true);
    });

    it('should render green indicator for high score (>=80)', () => {
      const session = createMockSession({
        healthReport: createBaseReport({ overallScore: 90 }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('🟢'))).toBe(true);
    });

    it('should render yellow indicator for medium score (50-79)', () => {
      const session = createMockSession({
        healthReport: createBaseReport({ overallScore: 60 }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('🟡'))).toBe(true);
    });

    it('should render red indicator for low score (<50)', () => {
      const session = createMockSession({
        healthReport: createBaseReport({ overallScore: 30 }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('🔴'))).toBe(true);
    });

    it('should render category scores with bar chart', () => {
      const session = createMockSession({
        healthReport: createBaseReport({ overallScore: 75 }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('permissions:'))).toBe(true);
      expect(output.some((line: string) => line.includes('shell:'))).toBe(true);
      expect(output.some((line: string) => line.includes('/100'))).toBe(true);
    });

    it('should render statistics with counts', () => {
      const session = createMockSession({
        healthReport: createBaseReport({
          stats: {
            totalDecisions: 25,
            blockedCount: 5,
            approvedCount: 18,
            deniedCount: 2,
            doomLoopTriggers: 0,
          },
        }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('25'))).toBe(true);
      expect(output.some((line: string) => line.includes('5'))).toBe(true);
      expect(output.some((line: string) => line.includes('18'))).toBe(true);
    });

    it('should show doomLoopTriggers when greater than zero', () => {
      const session = createMockSession({
        healthReport: createBaseReport({
          stats: {
            totalDecisions: 20,
            blockedCount: 3,
            approvedCount: 14,
            deniedCount: 3,
            doomLoopTriggers: 2,
          },
        }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('doom-loop'))).toBe(true);
    });

    it('should not show doomLoopTriggers section when zero', () => {
      const session = createMockSession({
        healthReport: createBaseReport({
          stats: {
            totalDecisions: 20,
            blockedCount: 3,
            approvedCount: 14,
            deniedCount: 3,
            doomLoopTriggers: 0,
          },
        }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('doom-loop'))).toBe(false);
    });

    it('should render recent blocks when present', () => {
      const session = createMockSession({
        healthReport: createBaseReport({
          recentBlocks: [
            {
              toolId: 'BashExec',
              reason: '危险命令已阻止',
              timestamp: '2026-05-11T10:00:00.000Z',
            },
          ],
        }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('近期阻止'))).toBe(true);
      expect(output.some((line: string) => line.includes('BashExec'))).toBe(true);
    });

    it('should not show recent blocks section when empty', () => {
      const session = createMockSession({
        healthReport: createBaseReport({ recentBlocks: [] }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('近期阻止'))).toBe(false);
    });

    it('should render recommendations when present', () => {
      const session = createMockSession({
        healthReport: createBaseReport({
          recommendations: ['切换到 strict 模式', '启用沙箱保护'],
        }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('改进建议'))).toBe(true);
      expect(output.some((line: string) => line.includes('strict'))).toBe(true);
    });

    it('should not show recommendations section when empty', () => {
      const session = createMockSession({
        healthReport: createBaseReport({ recommendations: [] }),
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output.some((line: string) => line.includes('改进建议'))).toBe(false);
    });

    it('should use renderer.renderSecurityHealth when available', () => {
      const session = createMockSession({
        healthReport: createBaseReport({ overallScore: 80 }),
        renderSecurityHealth: () => ['自定义渲染'],
      });
      const cmd = createSecurityCommand();

      cmd.handler([], session);

      const output = extractOutput(session);
      expect(output).toContain('自定义渲染');
    });

    it('should have correct command metadata', () => {
      const cmd = createSecurityCommand();
      expect(cmd.name).toBe('audit');
      expect(cmd.aliases).toContain('sec');
      expect(cmd.aliases).toContain('security');
      expect(cmd.description).toBeTruthy();
    });
  });

  describe('barChart (indirectly via renderSecurityDefault)', () => {
    it('should render full bar for score 100', () => {
      const session = createMockSession({
        healthReport: createBaseReport({
          overallScore: 100,
          scores: {
            permissions: 100,
            shell: 100,
            filesystem: 100,
            ssrf: 100,
            secrets: 100,
            sandbox: 100,
          },
        }),
      });
      const cmd = createSecurityCommand();
      cmd.handler([], session);

      const output = extractOutput(session);
      const shellLine = output.find((l: string) => l.includes('shell:'));
      expect(shellLine).toContain('██████████');
      expect(shellLine).toContain('100/100');
    });

    it('should render empty bar for score 0', () => {
      const session = createMockSession({
        healthReport: createBaseReport({
          overallScore: 10,
          scores: { permissions: 0, shell: 0, filesystem: 0, ssrf: 0, secrets: 0, sandbox: 0 },
        }),
      });
      const cmd = createSecurityCommand();
      cmd.handler([], session);

      const output = extractOutput(session);
      const shellLine = output.find((l: string) => l.includes('shell:'));
      expect(shellLine).toContain('░░░░░░░░░░');
      expect(shellLine).toContain('0/100');
    });

    it('should render half bar for score 50', () => {
      const session = createMockSession({
        healthReport: createBaseReport({
          overallScore: 50,
          scores: {
            permissions: 50,
            shell: 50,
            filesystem: 50,
            ssrf: 50,
            secrets: 50,
            sandbox: 50,
          },
        }),
      });
      const cmd = createSecurityCommand();
      cmd.handler([], session);

      const output = extractOutput(session);
      const shellLine = output.find((l: string) => l.includes('shell:'));
      expect(shellLine).toContain('█████░░░░░');
      expect(shellLine).toContain('50/100');
    });
  });
});
