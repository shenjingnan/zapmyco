import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '@/cli/repl/command-registry';
import type { CommandDefinition, ReplSession } from '@/cli/repl/types';

/** 创建 mock session */
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
    config: {} as ReplSession['config'],
    shutdown: vi.fn(),
    getRenderer: vi.fn(),
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

describe('CommandRegistry', () => {
  let registry: CommandRegistry;
  let mockSession: ReplSession;

  beforeEach(() => {
    mockSession = createMockSession();
    registry = new CommandRegistry(mockSession);
  });

  describe('register & getCommand', () => {
    it('注册后应能通过名称查找', () => {
      const cmd: CommandDefinition = {
        name: 'test',
        aliases: [],
        description: '测试命令',
        usage: '/test',
        handler: vi.fn(),
      };
      registry.register(cmd);

      const found = registry.getCommand('test');
      expect(found).toBe(cmd);
    });

    it('注册后应能通过别名查找', () => {
      const cmd: CommandDefinition = {
        name: 'quit',
        aliases: ['q', 'exit'],
        description: '退出',
        usage: '/quit',
        handler: vi.fn(),
      };
      registry.register(cmd);

      expect(registry.getCommand('q')).toBe(cmd);
      expect(registry.getCommand('exit')).toBe(cmd);
      expect(registry.getCommand('QUIT')).toBe(cmd);
    });

    it('查找不存在的命令应返回 undefined', () => {
      expect(registry.getCommand('nonexistent')).toBeUndefined();
    });
  });

  describe('listCommands', () => {
    it('应返回所有已注册的命令', () => {
      registry.register({
        name: 'cmd1',
        aliases: [],
        description: '1',
        usage: '/cmd1',
        handler: vi.fn(),
      });
      registry.register({
        name: 'cmd2',
        aliases: [],
        description: '2',
        usage: '/cmd2',
        handler: vi.fn(),
      });

      const cmds = registry.listCommands();
      expect(cmds).toHaveLength(2);
      expect(cmds.map((c) => c.name)).toEqual(expect.arrayContaining(['cmd1', 'cmd2']));
    });
  });

  describe('dispatch', () => {
    it('应分发到正确的 handler', async () => {
      const handler = vi.fn();
      registry.register({
        name: 'greet',
        aliases: [],
        description: '问候',
        usage: '/greet',
        handler,
      });

      await registry.dispatch({
        kind: 'command',
        name: 'greet',
        args: ['world'],
      });

      expect(handler).toHaveBeenCalledWith(['world'], mockSession);
    });

    it('未知命令应显示提示信息', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await registry.dispatch({
        kind: 'command',
        name: 'unknown',
        args: [],
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未知命令'));
    });

    it('非 command 类型输入应不做任何事', async () => {
      // 不应抛出异常
      await registry.dispatch({ kind: 'empty' });
      await registry.dispatch({ kind: 'goal', rawInput: 'test' });
      await registry.dispatch({ kind: 'incomplete', buffer: '' });
    });

    it('handler 抛出异常时应捕获并显示错误', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('handler error'));
      registry.register({
        name: 'err',
        aliases: [],
        description: '出错命令',
        usage: '/err',
        handler: errorHandler,
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await registry.dispatch({
        kind: 'command',
        name: 'err',
        args: [],
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('命令执行出错'));
    });
  });
});
