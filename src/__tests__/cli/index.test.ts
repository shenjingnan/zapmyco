import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock 会被 hoisted 到文件顶部，所以 spy 必须用 vi.hoisted 定义
const { startReplSpy } = vi.hoisted(() => {
  return {
    startReplSpy: vi.fn().mockResolvedValue(undefined),
  };
});

// mock 必须在文件顶层作用域（会被 hoisted）
vi.mock('../../cli/repl/index.js', () => ({
  startRepl: startReplSpy,
}));

describe('CLI', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  async function runCli(args: string[]) {
    process.argv = ['node', 'zapmyco', ...args];
    vi.resetModules();
    await import('../../cli/index.js');
  }

  function getOutput(): string[] {
    return consoleLogSpy.mock.calls
      .map((call) => call[0] as string)
      .filter((line): line is string => line != null);
  }

  it('default action should call startRepl', async () => {
    await runCli([]);
    expect(startReplSpy).toHaveBeenCalledOnce();
  });

  it('run command should print goal text', async () => {
    await runCli(['run', 'fix login bug']);
    const output = getOutput();
    expect(output.some((line) => line.includes('fix login bug'))).toBe(true);
  });

  it('run command with --json option should not crash', async () => {
    await runCli(['run', 'test goal', '--json']);
    const output = getOutput();
    expect(output.some((line) => line.includes('test goal'))).toBe(true);
  });

  it('agents command should list registered agents', async () => {
    await runCli(['agents']);
    const output = getOutput();
    expect(output.some((line) => line.includes('code-agent'))).toBe(true);
    expect(output.some((line) => line.includes('security-scanner'))).toBe(true);
    expect(output.some((line) => line.includes('research-agent'))).toBe(true);
    expect(output.some((line) => line.includes('planning-agent'))).toBe(true);
  });

  it('config command should print message', async () => {
    await runCli(['config']);
    const output = getOutput();
    expect(output.some((line) => line.includes('配置管理'))).toBe(true);
  });
});
