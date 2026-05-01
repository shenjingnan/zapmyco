import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getProcessRegistry } from '@/cli/repl/tools/process-registry';
import { createProcessTool } from '@/cli/repl/tools/shell-process';

describe('shell-process', () => {
  const tool = createProcessTool();

  describe('工具结构', () => {
    it('应该有正确的 id', () => {
      expect(tool.id).toBe('process');
    });

    it('应该有 label', () => {
      expect(tool.label).toBeDefined();
      expect(tool.label.length).toBeGreaterThan(0);
    });

    it('应该有 description', () => {
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(0);
    });

    it('parameters 应该包含 action 作为必需参数', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params = tool.parameters as any;
      expect(params.properties.action).toBeDefined();
      expect(params.required).toContain('action');
    });

    it('action 应该支持所有操作类型', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params = tool.parameters as any;
      const actionEnum: string[] = params.properties.action.enum;
      expect(actionEnum).toContain('list');
      expect(actionEnum).toContain('poll');
      expect(actionEnum).toContain('log');
      expect(actionEnum).toContain('wait');
      expect(actionEnum).toContain('kill');
      expect(actionEnum).toContain('write');
      expect(actionEnum).toContain('submit');
    });
  });

  describe('list action', () => {
    it('空注册表应该返回空列表信息', async () => {
      const result = await tool.execute('test_1', { action: 'list' });
      expect(result.content[0]!.text).toContain('没有活动');
    });

    it('有进程时应列出所有进程', async () => {
      const registry = getProcessRegistry();
      const child = spawn('sleep', ['1']);
      registry.register('sleep 1', child);

      const result = await tool.execute('test_2', { action: 'list' });
      expect(result.content[0]!.text).toContain('sleep');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.details as any).processCount).toBeGreaterThanOrEqual(1);

      registry.kill(child.pid ? (registry.list()[0]?.sessionId ?? '') : '');
      registry.destroy();
    });
  });

  describe('poll action', () => {
    it('无 sessionId 时应返回提示', async () => {
      const result = await tool.execute('test_3', { action: 'poll' });
      expect(result.content[0]!.text).toContain('sessionId');
    });

    it('不存在的 session 应返回未找到', async () => {
      const result = await tool.execute('test_4', {
        action: 'poll',
        sessionId: 'proc_nonexistent',
      });
      expect(result.content[0]!.text).toContain('未找到');
    });
  });

  describe('log action', () => {
    it('无 sessionId 时应返回提示', async () => {
      const result = await tool.execute('test_5', { action: 'log' });
      expect(result.content[0]!.text).toContain('sessionId');
    });
  });

  describe('wait action', () => {
    it('无 sessionId 时应返回提示', async () => {
      const result = await tool.execute('test_6', { action: 'wait' });
      expect(result.content[0]!.text).toContain('sessionId');
    });
  });

  describe('kill action', () => {
    it('无 sessionId 时应返回提示', async () => {
      const result = await tool.execute('test_7', { action: 'kill' });
      expect(result.content[0]!.text).toContain('sessionId');
    });
  });

  describe('write action', () => {
    it('无 sessionId 时应返回提示', async () => {
      const result = await tool.execute('test_8', { action: 'write' });
      expect(result.content[0]!.text).toContain('sessionId');
    });

    it('无 data 时应返回提示', async () => {
      const result = await tool.execute('test_9', {
        action: 'write',
        sessionId: 'proc_test',
      });
      expect(result.content[0]!.text).toContain('data');
    });
  });

  describe('submit action', () => {
    it('submit 同样需要 sessionId 和 data', async () => {
      const result = await tool.execute('test_10', { action: 'submit' });
      expect(result.content[0]!.text).toContain('sessionId');
    });
  });

  describe('未知操作', () => {
    it('应该返回错误提示', async () => {
      const result = await tool.execute('test_11', { action: 'unknown' as never });
      expect(result.content[0]!.text).toContain('未知操作');
    });
  });

  describe('与 ProcessRegistry 集成', () => {
    it('完整流程: list → kill', async () => {
      const registry = getProcessRegistry();

      // 注册一个睡眠进程
      const child = spawn('sleep', ['10']);
      const session = registry.register('sleep 10', child);

      // list 应该看到该进程
      const listResult = await tool.execute('test_12', { action: 'list' });
      expect(listResult.content[0]!.text).toContain(session.sessionId);

      // kill 该进程
      const killResult = await tool.execute('test_13', {
        action: 'kill',
        sessionId: session.sessionId,
      });
      expect(killResult.content[0]!.text).toContain('终止信号');

      registry.destroy();
    });
  });
});
