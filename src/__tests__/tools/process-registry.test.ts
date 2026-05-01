import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ProcessRegistry } from '@/cli/repl/tools/process-registry';

describe('ProcessRegistry', () => {
  describe('register', () => {
    it('应该注册一个新的后台进程并返回 session', () => {
      const registry = new ProcessRegistry();
      const child = spawn('echo', ['hello']);
      const session = registry.register('echo hello', child);

      expect(session.sessionId).toMatch(/^proc_[a-f0-9]{12}$/);
      expect(session.command).toBe('echo hello');
      expect(session.status).toBe('running');
      expect(session.pid).toBeGreaterThan(0);

      registry.destroy();
    });

    it('应该支持 workdir 参数', () => {
      const registry = new ProcessRegistry();
      const child = spawn('echo', ['hello']);
      const session = registry.register('echo hello', child, { workdir: '/tmp' });

      expect(session.workdir).toBe('/tmp');

      registry.destroy();
    });

    it('进程退出后 session 状态应该更新为 exited', async () => {
      const registry = new ProcessRegistry();
      const child = spawn('echo', ['hello']);
      const session = registry.register('echo hello', child);

      await registry.wait(session.sessionId);

      const updated = registry.poll(session.sessionId);
      expect(updated?.session.status).toBe('exited');
      expect(updated?.session.exitCode).toBe(0);

      registry.destroy();
    });

    it('非零退出码的进程状态应该是 exited', async () => {
      const registry = new ProcessRegistry();
      const child = spawn('node', ['-e', 'process.exit(1)']);
      const session = registry.register('node -e process.exit(1)', child);

      await registry.wait(session.sessionId);

      const updated = registry.poll(session.sessionId);
      expect(updated?.session.status).toBe('exited');
      expect(updated?.session.exitCode).toBe(1);

      registry.destroy();
    });
  });

  describe('list', () => {
    it('空注册表应该返回空数组', () => {
      const registry = new ProcessRegistry();
      expect(registry.list()).toEqual([]);
    });

    it('应该列出所有进程', () => {
      const registry = new ProcessRegistry();
      const child1 = spawn('echo', ['a']);
      const child2 = spawn('echo', ['b']);

      registry.register('echo a', child1);
      registry.register('echo b', child2);

      const list = registry.list();
      expect(list.length).toBe(2);
      expect(list[0]!.command).toBeDefined();
      expect(list[1]!.command).toBeDefined();

      registry.destroy();
    });
  });

  describe('poll', () => {
    it('不存在的 session 应该返回 null', () => {
      const registry = new ProcessRegistry();
      expect(registry.poll('nonexistent')).toBeNull();
    });

    it('应该返回 session 状态和输出', async () => {
      const registry = new ProcessRegistry();
      const child = spawn('echo', ['test output']);
      const session = registry.register('echo "test output"', child);

      await registry.wait(session.sessionId);

      const result = registry.poll(session.sessionId);
      expect(result).not.toBeNull();
      expect(result!.session.status).toBe('exited');
      expect(result!.newOutput).toContain('test output');

      registry.destroy();
    });
  });

  describe('getLog', () => {
    it('不存在的 session 应该返回 null', () => {
      const registry = new ProcessRegistry();
      expect(registry.getLog('nonexistent')).toBeNull();
    });

    it('应该返回完整日志', async () => {
      const registry = new ProcessRegistry();
      const child = spawn('echo', ['log line 1\nlog line 2']);
      const session = registry.register('echo multi', child);

      await registry.wait(session.sessionId);

      const result = registry.getLog(session.sessionId);
      expect(result).not.toBeNull();
      expect(result!.output).toContain('log line 1');

      registry.destroy();
    });

    it('应该支持 offset 和 limit', () => {
      // 通过快速命令验证参数传递
      const registry = new ProcessRegistry();
      const child = spawn('echo', ['line1\nline2\nline3\nline4\nline5']);
      const session = registry.register('echo lines', child);

      // offset + limit
      const result = registry.getLog(session.sessionId, { offset: 1, limit: 2 });
      expect(result).not.toBeNull();

      registry.destroy();
    });
  });

  describe('wait', () => {
    it('不存在的 session 应该返回 null', async () => {
      const registry = new ProcessRegistry();
      expect(await registry.wait('nonexistent')).toBeNull();
    });

    it('应该等待进程完成', async () => {
      const registry = new ProcessRegistry();
      const child = spawn('sleep', ['0.1']);
      const session = registry.register('sleep 0.1', child);

      const result = await registry.wait(session.sessionId);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('exited');

      registry.destroy();
    });

    it('超时后应该返回当前状态', async () => {
      const registry = new ProcessRegistry();
      const child = spawn('sleep', ['10']);
      const session = registry.register('sleep 10', child);

      const result = await registry.wait(session.sessionId, 100);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('running');

      registry.kill(session.sessionId);
      registry.destroy();
    });
  });

  describe('kill', () => {
    it('不存在的 session 应该返回 null', () => {
      const registry = new ProcessRegistry();
      expect(registry.kill('nonexistent')).toBeNull();
    });

    it('应该终止运行中的进程', async () => {
      const registry = new ProcessRegistry();
      const child = spawn('sleep', ['10']);
      const session = registry.register('sleep 10', child);

      expect(session.status).toBe('running');

      const killed = registry.kill(session.sessionId);
      expect(killed).not.toBeNull();
      expect(killed!.status).toBe('killed');

      await registry.wait(session.sessionId);
      registry.destroy();
    });

    it('已经退出的进程应该保持不变', async () => {
      const registry = new ProcessRegistry();
      const child = spawn('echo', ['done']);
      const session = registry.register('echo done', child);

      await registry.wait(session.sessionId);

      const killed = registry.kill(session.sessionId);
      expect(killed!.status).toBe('exited');

      registry.destroy();
    });
  });

  describe('write', () => {
    it('不存在的 session 应该返回 null', () => {
      const registry = new ProcessRegistry();
      expect(registry.write('nonexistent', 'data', false)).toBeNull();
    });

    it('submit 应该写入数据 + 换行', () => {
      const registry = new ProcessRegistry();
      const child = spawn('cat');
      const session = registry.register('cat', child);

      const result = registry.write(session.sessionId, 'hello world', true);
      expect(result).not.toBeNull();

      registry.kill(session.sessionId);
      registry.destroy();
    });
  });

  describe('remove', () => {
    it('应该移除进程记录', async () => {
      const registry = new ProcessRegistry();
      const child = spawn('echo', ['hello']);
      const session = registry.register('echo hello', child);

      await registry.wait(session.sessionId);

      expect(registry.remove(session.sessionId)).toBe(true);
      expect(registry.poll(session.sessionId)).toBeNull();
    });

    it('不存在的 session 应该返回 false', () => {
      const registry = new ProcessRegistry();
      expect(registry.remove('nonexistent')).toBe(false);
    });
  });

  describe('count', () => {
    it('应该返回正确的进程数', () => {
      const registry = new ProcessRegistry();
      expect(registry.count).toBe(0);

      const child = spawn('echo', ['a']);
      registry.register('echo a', child);
      expect(registry.count).toBe(1);

      registry.destroy();
    });
  });

  describe('destroy', () => {
    it('应该清理所有进程', () => {
      const registry = new ProcessRegistry();
      const child = spawn('sleep', ['10']);
      registry.register('sleep 10', child);
      expect(registry.count).toBe(1);

      registry.destroy();
      expect(registry.count).toBe(0);
    });
  });

  describe('getProcessRegistry', () => {
    it('应该返回全局单例', async () => {
      const { getProcessRegistry } = await import('@/cli/repl/tools/process-registry');
      const reg1 = getProcessRegistry();
      const reg2 = getProcessRegistry();
      expect(reg1).toBe(reg2);
    });
  });
});
