import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CronScheduler } from '@/cli/repl/cron/cron-scheduler';
import type { CronJob, SchedulerStatus } from '@/cli/repl/cron/types';
import { createCronTool } from '@/cli/repl/tools/cron-tool';

// Mock parseCron — 有效 cron 返回 schedule 对象，特定字符串返回 null
vi.mock('@/cli/repl/cron/cron-parser', () => ({
  parseCron: vi.fn((cron: string) => {
    if (!cron || cron.startsWith('invalid')) return null;
    return {
      nextFrom: vi.fn(() => new Date('2026-05-08T09:00:00Z')),
      description: `每天 ${cron}`,
    };
  }),
}));

// Mock CronStore.generateId
vi.mock('@/cli/repl/cron/cron-store', () => ({
  CronStore: {
    generateId: vi.fn(() => 'a1b2c3d4'),
  },
}));

/**
 * 创建轻量 mock CronScheduler，追踪 job 操作
 */
function createMockScheduler(): CronScheduler {
  const jobs: CronJob[] = [];

  return {
    addJob: vi.fn(async (job: CronJob): Promise<string | null> => {
      if (job.prompt === 'trigger-add-error') return '模拟添加失败';
      const newJob = { ...job, id: job.id || 'a1b2c3d4' };
      jobs.push(newJob);
      return null;
    }),
    getJobs: vi.fn((): CronJob[] => [...jobs]),
    removeJob: vi.fn(async (id: string): Promise<boolean> => {
      const idx = jobs.findIndex((j) => j.id === id);
      if (idx >= 0) {
        jobs.splice(idx, 1);
        return true;
      }
      return false;
    }),
    updateJob: vi.fn(async (_id: string, _updates: Partial<CronJob>): Promise<string | null> => {
      if (_id === 'update-sim-error') return '模拟更新失败';
      const job = jobs.find((j) => j.id === _id);
      if (!job) return `任务未找到: ${_id}`;
      Object.assign(job, _updates);
      return null;
    }),
    triggerJob: vi.fn(async (id: string): Promise<string | null> => {
      if (id === 'trigger-sim-error') return '模拟触发失败';
      const job = jobs.find((j) => j.id === id);
      if (!job) return `任务未找到: ${id}`;
      if (!job.enabled) return `任务已暂停: ${id}`;
      job.fireCount++;
      return null;
    }),
    getStatus: vi.fn(
      async (): Promise<SchedulerStatus> => ({
        running: true,
        jobCount: jobs.length,
        enabledCount: jobs.filter((j) => j.enabled).length,
        durableCount: jobs.filter((j) => j.durable).length,
        sessionCount: jobs.filter((j) => !j.durable).length,
      })
    ),
  } as unknown as CronScheduler;
}

describe('cron-tool', () => {
  let scheduler: CronScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = createMockScheduler();
  });

  // ============ 工具定义 ============

  describe('工具定义', () => {
    it('应该有正确的 id', () => {
      const tool = createCronTool(scheduler);
      expect(tool.id).toBe('ScheduledTask');
    });

    it('应该有正确的 label', () => {
      const tool = createCronTool(scheduler);
      expect(tool.label).toBe('定时任务');
    });

    it('应该包含 description', () => {
      const tool = createCronTool(scheduler);
      expect(tool.description).toBeDefined();
      expect(tool.description).toContain('定时任务管理工具');
    });

    it('parameters 应包含 8 个 action 枚举', () => {
      const tool = createCronTool(scheduler);
      const params = tool.parameters as any;
      expect(params.required).toContain('action');
      expect(params.properties.action.enum).toEqual([
        'create',
        'list',
        'update',
        'remove',
        'pause',
        'resume',
        'run',
        'status',
      ]);
    });

    it('parameters 应包含 cron/prompt/job_id 等字段', () => {
      const tool = createCronTool(scheduler);
      const params = tool.parameters as any;
      expect(params.properties.cron).toBeDefined();
      expect(params.properties.prompt).toBeDefined();
      expect(params.properties.job_id).toBeDefined();
      expect(params.properties.recurring).toBeDefined();
      expect(params.properties.durable).toBeDefined();
      expect(params.properties.max_fires).toBeDefined();
      expect(params.properties.enabled).toBeDefined();
      expect(params.properties.new_cron).toBeDefined();
      expect(params.properties.new_prompt).toBeDefined();
    });
  });

  // ============ action="create" ============

  describe('action="create"', () => {
    it('缺少 cron 参数应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-1', { action: 'create' });
      expect(result.content[0].text).toContain('请提供 cron 参数');
      expect(result.details.error).toContain('cron 参数为空');
    });

    it('缺少 prompt 参数应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-2', { action: 'create', cron: '0 9 * * *' });
      expect(result.content[0].text).toContain('请提供 prompt 参数');
      expect(result.details.error).toContain('prompt 参数为空');
    });

    it('prompt 过长应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const longPrompt = 'x'.repeat(2001);
      const result = await tool.execute('test-3', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: longPrompt,
      });
      expect(result.content[0].text).toContain('prompt 过长');
      expect(result.details.error).toContain('prompt 过长');
    });

    it('无效的 cron 表达式应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-4', {
        action: 'create',
        cron: 'invalid-expression',
        prompt: '测试任务',
      });
      expect(result.content[0].text).toContain('无效的 cron 表达式');
    });

    it('创建循环任务（默认 recurring=true）应成功', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-5', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: '每天早上检查部署状态',
      });
      expect(result.content[0].text).toContain('已创建循环定时任务');
      expect(result.content[0].text).toContain('a1b2c3d4');
      expect(result.details.recurring).toBe(true);
      expect(result.details.jobId).toBe('a1b2c3d4');
    });

    it('创建一次性任务 (recurring=false) 应成功', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-6', {
        action: 'create',
        cron: '30 14 28 2 *',
        prompt: '一次性提醒',
        recurring: false,
      });
      expect(result.content[0].text).toContain('已创建一次性定时任务');
      expect(result.details.recurring).toBe(false);
    });

    it('创建持久化任务 (durable=true) 应成功', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-7', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: '持久化任务',
        durable: true,
      });
      expect(result.content[0].text).toContain('持久化');
      expect(result.details.durable).toBe(true);
    });

    it('scheduler.addJob 失败应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-8', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: 'trigger-add-error',
      });
      expect(result.content[0].text).toContain('[创建失败]');
      expect(result.content[0].text).toContain('模拟添加失败');
    });
  });

  // ============ action="list" ============

  describe('action="list"', () => {
    it('无任务时应返回提示', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-1', { action: 'list' });
      expect(result.content[0].text).toContain('暂无定时任务');
    });

    it('有任务时应列出详细信息', async () => {
      // 先创建两个任务
      const tool = createCronTool(scheduler);
      await tool.execute('t1', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: '任务一',
      });
      await tool.execute('t2', {
        action: 'create',
        cron: '*/5 * * * *',
        prompt: '任务二',
        recurring: true,
      });

      const result = await tool.execute('test-2', { action: 'list' });
      expect(result.content[0].text).toContain('共 2 个定时任务');
      expect(result.content[0].text).toContain('a1b2c3d4');
      expect(result.details.count).toBe(2);
      expect(result.details.jobs).toHaveLength(2);
    });

    it('prompt 超过 80 字符应截断', async () => {
      const tool = createCronTool(scheduler);
      const longPrompt = 'A'.repeat(100);
      await tool.execute('t1', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: longPrompt,
      });

      const result = await tool.execute('test-3', { action: 'list' });
      expect(result.content[0].text).toContain('...');
    });
  });

  // ============ action="update" ============

  describe('action="update"', () => {
    beforeEach(async () => {
      const tool = createCronTool(scheduler);
      await tool.execute('setup', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: '测试任务',
      });
    });

    it('缺少 job_id 应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-1', { action: 'update' });
      expect(result.content[0].text).toContain('请提供 job_id 参数');
    });

    it('无更新参数应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-2', { action: 'update', job_id: 'a1b2c3d4' });
      expect(result.content[0].text).toContain('请提供要更新的参数');
    });

    it('更新 cron 应成功', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-3', {
        action: 'update',
        job_id: 'a1b2c3d4',
        new_cron: '5 0 * * *',
      });
      expect(result.content[0].text).toContain('已更新');
    });

    it('任务不存在应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-4', {
        action: 'update',
        job_id: 'nonexistent',
        new_cron: '5 0 * * *',
      });
      expect(result.content[0].text).toContain('[更新失败]');
    });

    it('scheduler 返回错误时应传递', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-5', {
        action: 'update',
        job_id: 'update-sim-error',
        new_prompt: 'new prompt',
      });
      expect(result.content[0].text).toContain('[更新失败]');
      expect(result.content[0].text).toContain('模拟更新失败');
    });
  });

  // ============ action="remove" ============

  describe('action="remove"', () => {
    beforeEach(async () => {
      const tool = createCronTool(scheduler);
      await tool.execute('setup', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: '测试任务',
      });
    });

    it('缺少 job_id 应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-1', { action: 'remove' });
      expect(result.content[0].text).toContain('请提供 job_id 参数');
    });

    it('成功删除应返回结果', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-2', { action: 'remove', job_id: 'a1b2c3d4' });
      expect(result.content[0].text).toContain('已删除');
    });

    it('任务不存在应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-3', {
        action: 'remove',
        job_id: 'nonexistent',
      });
      expect(result.content[0].text).toContain('[删除失败]');
      expect(result.content[0].text).toContain('任务未找到');
    });
  });

  // ============ action="pause" ============

  describe('action="pause"', () => {
    beforeEach(async () => {
      const tool = createCronTool(scheduler);
      await tool.execute('setup', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: '测试任务',
      });
    });

    it('缺少 job_id 应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-1', { action: 'pause' });
      expect(result.content[0].text).toContain('请提供 job_id 参数');
    });

    it('暂停成功应返回结果', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-2', {
        action: 'pause',
        job_id: 'a1b2c3d4',
      });
      expect(result.content[0].text).toContain('已暂停');
    });

    it('scheduler 返回错误应传递', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-3', {
        action: 'pause',
        job_id: 'update-sim-error',
      });
      expect(result.content[0].text).toContain('[暂停失败]');
      expect(result.content[0].text).toContain('模拟更新失败');
    });
  });

  // ============ action="resume" ============

  describe('action="resume"', () => {
    beforeEach(async () => {
      const tool = createCronTool(scheduler);
      await tool.execute('setup', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: '测试任务',
      });
    });

    it('缺少 job_id 应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-1', { action: 'resume' });
      expect(result.content[0].text).toContain('请提供 job_id 参数');
    });

    it('恢复成功应返回结果', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-2', {
        action: 'resume',
        job_id: 'a1b2c3d4',
      });
      expect(result.content[0].text).toContain('已恢复');
    });

    it('scheduler 返回错误应传递', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-3', {
        action: 'resume',
        job_id: 'update-sim-error',
      });
      expect(result.content[0].text).toContain('[恢复失败]');
      expect(result.content[0].text).toContain('模拟更新失败');
    });
  });

  // ============ action="run" ============

  describe('action="run"', () => {
    beforeEach(async () => {
      const tool = createCronTool(scheduler);
      await tool.execute('setup', {
        action: 'create',
        cron: '0 9 * * *',
        prompt: '测试任务',
      });
    });

    it('缺少 job_id 应返回错误', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-1', { action: 'run' });
      expect(result.content[0].text).toContain('请提供 job_id 参数');
    });

    it('触发成功应返回结果', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-2', {
        action: 'run',
        job_id: 'a1b2c3d4',
      });
      expect(result.content[0].text).toContain('已触发执行');
    });

    it('scheduler.triggerJob 返回错误应传递', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-3', {
        action: 'run',
        job_id: 'trigger-sim-error',
      });
      expect(result.content[0].text).toContain('[执行失败]');
      expect(result.content[0].text).toContain('模拟触发失败');
    });
  });

  // ============ action="status" ============

  describe('action="status"', () => {
    it('应返回调度器运行状态', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-1', { action: 'status' });
      expect(result.content[0].text).toContain('调度器状态');
      expect(result.content[0].text).toContain('运行中: 是');
      expect(result.details.running).toBe(true);
    });

    it('调度器停止时应显示否', async () => {
      (scheduler.getStatus as any).mockResolvedValue({
        running: false,
        jobCount: 0,
        enabledCount: 0,
        durableCount: 0,
        sessionCount: 0,
      });
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-2', { action: 'status' });
      expect(result.content[0].text).toContain('运行中: 否');
    });
  });

  // ============ 不支持的 action ============

  describe('不支持的操作', () => {
    it('传入无效 action 应返回错误提示', async () => {
      const tool = createCronTool(scheduler);
      const result = await tool.execute('test-1', { action: 'unknown' as any });
      expect(result.content[0].text).toContain('不支持的操作');
      expect(result.details.error).toContain('不支持的操作');
    });
  });
});
