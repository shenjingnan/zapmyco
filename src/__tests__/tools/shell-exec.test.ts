import { describe, expect, it } from 'vitest';
import { createExecTool } from '@/cli/repl/tools/shell-exec';

describe('shell-exec', () => {
  const tool = createExecTool();

  describe('工具结构', () => {
    it('应该有正确的 id', () => {
      expect(tool.id).toBe('exec');
    });

    it('应该有 label', () => {
      expect(tool.label).toBeDefined();
      expect(tool.label.length).toBeGreaterThan(0);
    });

    it('应该有 description', () => {
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(0);
    });

    it('parameters 应该包含 command 作为必需参数', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params = tool.parameters as any;
      expect(params.properties.command).toBeDefined();
      expect(params.required).toContain('command');
    });

    it('parameters 应该包含可选参数', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params = tool.parameters as any;
      expect(params.properties.workdir).toBeDefined();
      expect(params.properties.timeout).toBeDefined();
      expect(params.properties.background).toBeDefined();
      expect(params.properties.pty).toBeDefined();
    });
  });

  describe('execute', () => {
    it('应该执行 echo 命令并返回输出', async () => {
      const result = await tool.execute('test_1', { command: 'echo hello world' });
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]!.text).toContain('hello world');
      expect(result.details.status).toBe('completed');
      expect(result.details.exitCode).toBe(0);
    });

    it('应该执行 ls 命令', async () => {
      const result = await tool.execute('test_2', { command: 'ls' });
      expect(result.details.status).toBe('completed');
      expect(result.details.exitCode).toBe(0);
    });

    it('退出码非零的命令应该返回 failed 状态', async () => {
      const result = await tool.execute('test_3', { command: 'exit 1' });
      expect(result.details.status).toBe('failed');
      expect(result.details.exitCode).toBe(1);
    });

    it('应该阻断 rm -rf / 命令', async () => {
      const result = await tool.execute('test_4', { command: 'rm -rf /' });
      expect(result.details.status).toBe('blocked');
      expect(result.content[0]!.text).toContain('安全检查');
    });

    it('应该阻断 shutdown 命令', async () => {
      const result = await tool.execute('test_5', { command: 'shutdown now' });
      expect(result.details.status).toBe('blocked');
    });

    it('空命令应该被拒绝', async () => {
      const result = await tool.execute('test_6', { command: '' });
      expect(result.details.status).toBe('blocked');
    });

    it('后台命令应该返回 running 状态和 sessionId', async () => {
      const result = await tool.execute('test_7', {
        command: 'sleep 5',
        background: true,
      });
      expect(result.details.status).toBe('running');
      expect(result.details.sessionId).toMatch(/^proc_/);
      expect(result.details.pid).toBeGreaterThan(0);
      expect(result.content[0]!.text).toContain('后台进程已启动');
    });

    it('应该支持 workdir 参数', async () => {
      const result = await tool.execute('test_8', {
        command: 'pwd',
        workdir: '/tmp',
      });
      expect(result.details.status).toBe('completed');
      expect(result.content[0]!.text).toContain('/tmp');
    });

    it('无效的 workdir 应该返回错误', async () => {
      const result = await tool.execute('test_9', {
        command: 'ls',
        workdir: '/etc/cron.d',
      });
      expect(result.details.status).toBe('error');
    });

    it('超时的命令应该被终止', async () => {
      const result = await tool.execute('test_10', {
        command: 'sleep 30',
        timeout: 0.5,
      });
      expect(result.details.status).toBe('timeout');
      expect(result.content[0]!.text).toContain('超时');
    });

    it('应该返回 exitCode 非零的详情', async () => {
      const result = await tool.execute('test_11', { command: 'node -e "process.exit(42)"' });
      expect(result.details.exitCode).toBe(42);
    });
  });
});
