import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskManageTool } from '@/cli/repl/tools/task-manage';
import { TaskStore } from '@/core/task/task-store';

/**
 * task_manage 工具单元测试
 *
 * 覆盖：read / write / update 三种操作模式及错误处理
 */
describe('task_manage', () => {
  let store: TaskStore;
  let tmpDir: string;

  function createTool() {
    return createTaskManageTool(store);
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-task-tool-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    store = new TaskStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ============ 工具定义 ============
  describe('工具定义', () => {
    it('应该有正确的 id', () => {
      const tool = createTool();
      expect(tool.id).toBe('task_manage');
    });

    it('应该有正确的 label', () => {
      const tool = createTool();
      expect(tool.label).toBe('任务管理');
    });

    it('应该定义 parameters schema', () => {
      const tool = createTool();
      expect(tool.parameters).toBeDefined();
    });

    it('parameters 应该包含 action 枚举', () => {
      const tool = createTool();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params = tool.parameters as any;
      expect(params.properties.action.enum).toEqual(['read', 'write', 'update']);
    });
  });

  // ============ read 操作 ============
  describe('action: read', () => {
    it('空任务列表应返回提示信息', async () => {
      const tool = createTool();
      const result = await tool.execute('test_1', { action: 'read' });

      expect(result.content[0].text).toContain('当前没有任务');
    });

    it('默认 action 应为 read', async () => {
      const tool = createTool();
      const result = await tool.execute('test_1', {});

      expect(result.content[0].text).toContain('当前没有任务');
      expect(result.details.action).toBe('read');
    });

    it('应展示所有任务及其状态', async () => {
      store.write([
        { id: '1', subject: '分析需求', status: 'completed' },
        { id: '2', subject: '编写代码', status: 'in_progress' },
        { id: '3', subject: '编写测试', status: 'pending' },
      ]);

      const tool = createTool();
      const result = await tool.execute('test_1', { action: 'read' });

      const text = result.content[0].text;
      expect(text).toContain('分析需求');
      expect(text).toContain('编写代码');
      expect(text).toContain('编写测试');
      expect(text).toContain('共 3 个任务');
    });

    it('应包含进度统计', async () => {
      store.write([
        { id: '1', subject: '任务1', status: 'completed' },
        { id: '2', subject: '任务2', status: 'in_progress' },
        { id: '3', subject: '任务3', status: 'pending' },
        { id: '4', subject: '任务4', status: 'cancelled' },
      ]);

      const tool = createTool();
      const result = await tool.execute('test_1', { action: 'read' });

      const text = result.content[0].text;
      expect(text).toContain('1 待处理');
      expect(text).toContain('1 进行中');
      expect(text).toContain('1 已完成');
      expect(text).toContain('1 已取消');
    });

    it('details 应包含任务列表和摘要', async () => {
      store.write([{ id: '1', subject: '任务', status: 'pending' }]);

      const tool = createTool();
      const result = await tool.execute('test_1', { action: 'read' });

      expect(result.details.tasks).toHaveLength(1);
      expect(result.details.summary.total).toBe(1);
    });
  });

  // ============ write 操作 ============
  describe('action: write', () => {
    it('应成功写入任务列表', async () => {
      const tool = createTool();
      const result = await tool.execute('test_1', {
        action: 'write',
        tasks: [
          { id: '1', subject: '分析', status: 'pending' },
          { id: '2', subject: '编码', status: 'pending' },
        ],
      });

      expect(result.content[0].text).toContain('任务列表已更新');
      expect(result.details.summary.total).toBe(2);
    });

    it('merge 模式应保留已有任务', async () => {
      store.write([{ id: '1', subject: '已有任务', status: 'pending' }]);

      const tool = createTool();
      await tool.execute('test_1', {
        action: 'write',
        tasks: [{ id: '2', subject: '新任务', status: 'pending' }],
        merge: true,
      });

      expect(store.read()).toHaveLength(2);
    });

    it('无 tasks 参数应返回错误', async () => {
      const tool = createTool();
      const result = await tool.execute('test_1', {
        action: 'write',
      });

      expect(result.content[0].text).toContain('请提供 tasks 参数');
      expect(result.details.error).toBeDefined();
    });

    it('空 tasks 应返回错误', async () => {
      const tool = createTool();
      const result = await tool.execute('test_1', {
        action: 'write',
        tasks: [],
      });

      expect(result.details.error).toBeDefined();
    });

    it('多 in_progress 应返回错误', async () => {
      const tool = createTool();
      const result = await tool.execute('test_1', {
        action: 'write',
        tasks: [
          { id: '1', subject: '任务1', status: 'in_progress' },
          { id: '2', subject: '任务2', status: 'in_progress' },
        ],
      });

      expect(result.content[0].text).toContain('任务更新失败');
      expect(result.details.error).toContain('不允许同时有');
    });
  });

  // ============ update 操作 ============
  describe('action: update', () => {
    it('应成功更新任务状态', async () => {
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);

      const tool = createTool();
      const result = await tool.execute('test_1', {
        action: 'update',
        tasks: [{ id: '1', subject: '测试', status: 'in_progress' }],
      });

      expect(result.content[0].text).toContain('任务已更新');
      expect(result.content[0].text).toContain('[1]');
      expect(store.read()[0]!.status).toBe('in_progress');
    });

    it('应成功完成一个任务并开始下一个', async () => {
      store.write([
        { id: '1', subject: '进行中', status: 'in_progress' },
        { id: '2', subject: '待处理', status: 'pending' },
      ]);

      const tool = createTool();
      await tool.execute('test_1', {
        action: 'update',
        tasks: [{ id: '1', subject: '进行中', status: 'completed' }],
      });
      const result = await tool.execute('test_2', {
        action: 'update',
        tasks: [{ id: '2', subject: '待处理', status: 'in_progress' }],
      });

      expect(result.content[0].text).toContain('任务已更新');
    });

    it('更新不存在的任务应报告错误', async () => {
      const tool = createTool();
      const result = await tool.execute('test_1', {
        action: 'update',
        tasks: [{ id: 'nonexistent', subject: '不存在', status: 'in_progress' }],
      });

      expect(result.content[0].text).toContain('部分任务更新失败');
      expect(result.details.error).toBeDefined();
    });

    it('无 tasks 参数应返回错误', async () => {
      const tool = createTool();
      const result = await tool.execute('test_1', {
        action: 'update',
      });

      expect(result.details.error).toBeDefined();
    });
  });

  // ============ 错误处理 ============
  describe('错误处理', () => {
    it('不支持的操作应返回错误', async () => {
      const tool = createTool();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await tool.execute('test_1', { action: 'invalid' as any });

      expect(result.content[0].text).toContain('不支持的操作');
    });

    it('update 模式下部分成功部分失败应有明确报告', async () => {
      store.write([
        { id: '1', subject: '正常任务', status: 'pending' },
        { id: '2', subject: '已完成任务', status: 'completed' },
      ]);

      const tool = createTool();
      const result = await tool.execute('test_1', {
        action: 'update',
        tasks: [
          { id: '1', subject: '正常任务', status: 'in_progress' },
          { id: '2', subject: '已完成任务', status: 'in_progress' },
        ],
      });

      expect(result.content[0].text).toContain('部分任务更新失败');
      // task 1 应成功
      expect(store.read().find((t) => t.id === '1')!.status).toBe('in_progress');
      // task 2 应保持 completed
      expect(store.read().find((t) => t.id === '2')!.status).toBe('completed');
    });
  });
});
