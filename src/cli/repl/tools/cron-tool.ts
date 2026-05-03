/**
 * scheduled_task 工具实现 — 定时任务管理
 *
 * 参考 Claude Code 的 CronCreate/CronDelete/CronList 三工具设计
 * 和 OpenClaw/Hermes-Agent 的单工具 + action 模式，
 * 结合 zapmyco 现有 memory 工具的 action 路由风格。
 *
 * 设计要点:
 * - 单工具 + 8 action: create/list/update/remove/pause/resume/run/status
 * - 工厂函数 createCronTool(scheduler) 注入依赖
 * - 5-field cron 表达式，自定义解析器零外部依赖
 *
 * @module cli/repl/tools/cron-tool
 */

import { parseCron } from '../cron/cron-parser';
import type { CronScheduler } from '../cron/cron-scheduler';
import { CronStore } from '../cron/cron-store';
import { CRON_CONSTANTS, type CronJob, type CronToolParams } from '../cron/types';

// ============ 工具描述 ============

const CRON_TOOL_DESCRIPTION = `定时任务管理工具 — 创建和管理按 cron 表达式触发的自动化任务。

## 何时使用
- 用户要求"每天早上 9 点检查 XX" → create 循环任务
- 用户要求"5 分钟后提醒我" → 计算 cron 表达式并 create
- 用户要求"列出所有定时任务" → list
- 用户要求"取消/暂停 XX 任务" → remove / pause
- 用户要求"查看调度器状态" → status

## 调度说明
- 任务仅在当前 REPL 会话存活期间触发
- durable=true 的任务会在下次启动时恢复
- 循环任务默认 7 天后自动过期（触发最后一次后删除）
- 调度器仅在 REPL 空闲时触发任务，不会中断正在执行的对话

## Cron 表达式格式（5 字段）
\`minute hour day-of-month month day-of-week\`

| 字段 | 范围 | 说明 |
|------|------|------|
| minute | 0-59 | 分钟 |
| hour | 0-23 | 小时 |
| day-of-month | 1-31 | 每月第几天 |
| month | 1-12 | 月份 |
| day-of-week | 0-6 | 星期几（0=周日） |

支持语法:
- \`*\` 通配符 — 匹配所有值
- \`*/N\` 步进 — 每隔 N 个单位
- \`N\` 精确值
- \`N-M\` 范围
- \`N,M,O\` 列表（逗号分隔）

示例:
- \`0 9 * * *\` = 每天早上 9:00
- \`*/5 * * * *\` = 每 5 分钟
- \`0 9 * * 1-5\` = 工作日早上 9:00
- \`30 14 28 2 *\` = 2 月 28 日下午 2:30（一次性）

## 注意事项
- 创建"5分钟后"类任务时，需要根据当前时间计算准确的 cron 表达式
- 一次性任务（recurring=false）触发后自动删除
- session 级任务（durable=false）在退出后不会恢复`;

// ============ 工具工厂 ============

/**
 * 创建 scheduled_task 工具
 * @param scheduler CronScheduler 实例
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createCronTool(scheduler: CronScheduler): any {
  return {
    id: 'scheduled_task' as const,
    label: '定时任务',
    description: CRON_TOOL_DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string' as const,
          description:
            '操作类型: "create"(创建), "list"(列出), "update"(更新), "remove"(删除), ' +
            '"pause"(暂停), "resume"(恢复), "run"(立即执行), "status"(状态)。',
          enum: ['create', 'list', 'update', 'remove', 'pause', 'resume', 'run', 'status'],
        },
        cron: {
          type: 'string' as const,
          description: '5 字段 cron 表达式（action="create" 时必填，update 时可选）',
        },
        prompt: {
          type: 'string' as const,
          description: '任务触发时发送给 Agent 的 prompt 内容（action="create" 时必填）',
        },
        recurring: {
          type: 'boolean' as const,
          description: '是否循环执行，默认 true。设为 false 则为一次性任务，触发后自动删除。',
        },
        durable: {
          type: 'boolean' as const,
          description:
            '是否持久化到文件（跨会话恢复），默认 false。仅当用户明确要求持久化时设为 true。',
        },
        max_fires: {
          type: 'number' as const,
          description: '最大执行次数，不设置则无限制。一次性任务默认为 1。',
        },
        job_id: {
          type: 'string' as const,
          description: '任务 ID（update/remove/pause/resume/run 操作需要）',
        },
        enabled: {
          type: 'boolean' as const,
          description: '是否启用（update 时使用，对应 pause/resume 操作）',
        },
        new_cron: {
          type: 'string' as const,
          description: '新的 cron 表达式（update 时使用）',
        },
        new_prompt: {
          type: 'string' as const,
          description: '新的 prompt 内容（update 时使用）',
        },
      },
      required: ['action'],
    } as const,

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(_toolCallId: string, params: CronToolParams): Promise<any> {
      const action = params.action ?? 'list';

      switch (action) {
        case 'create':
          return buildCreateResult(scheduler, params);
        case 'list':
          return buildListResult(scheduler);
        case 'update':
          return buildUpdateResult(scheduler, params);
        case 'remove':
          return buildRemoveResult(scheduler, params);
        case 'pause':
          return buildPauseResult(scheduler, params);
        case 'resume':
          return buildResumeResult(scheduler, params);
        case 'run':
          return buildRunResult(scheduler, params);
        case 'status':
          return buildStatusResult(scheduler);
        default:
          return {
            content: [{ type: 'text', text: `不支持的操作: ${action}` }],
            details: { action, error: `不支持的操作: ${action}` },
          };
      }
    },
  };
}

// ============ 操作实现 ============

async function buildCreateResult(
  scheduler: CronScheduler,
  params: CronToolParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const cron = params.cron?.trim();
  const prompt = params.prompt?.trim();

  if (!cron) {
    return {
      content: [{ type: 'text', text: '请提供 cron 参数（5 字段 cron 表达式）。' }],
      details: { action: 'create', error: 'cron 参数为空' },
    };
  }

  if (!prompt) {
    return {
      content: [{ type: 'text', text: '请提供 prompt 参数（任务触发时要执行的内容）。' }],
      details: { action: 'create', error: 'prompt 参数为空' },
    };
  }

  if (prompt.length > CRON_CONSTANTS.MAX_PROMPT_LENGTH) {
    return {
      content: [
        {
          type: 'text',
          text: `prompt 过长（最大 ${CRON_CONSTANTS.MAX_PROMPT_LENGTH} 字符，当前 ${prompt.length} 字符）。`,
        },
      ],
      details: {
        action: 'create',
        error: `prompt 过长: ${prompt.length} > ${CRON_CONSTANTS.MAX_PROMPT_LENGTH}`,
      },
    };
  }

  // 验证 cron 表达式
  const schedule = parseCron(cron);
  if (!schedule) {
    return {
      content: [{ type: 'text', text: `无效的 cron 表达式: "${cron}"。请使用 5 字段格式。` }],
      details: { action: 'create', error: `无效的 cron 表达式: ${cron}` },
    };
  }

  const now = Date.now();
  const recurring = params.recurring !== false; // 默认 true

  const maxFiresValue = params.max_fires ?? (!recurring ? 1 : undefined);
  const job: CronJob = {
    id: CronStore.generateId(),
    cron,
    prompt,
    createdAt: now,
    recurring,
    durable: params.durable === true,
    enabled: true,
    fireCount: 0,
  };
  if (maxFiresValue !== undefined) {
    job.maxFires = maxFiresValue;
  }

  const error = await scheduler.addJob(job);
  if (error) {
    return {
      content: [{ type: 'text', text: `[创建失败] ${error}` }],
      details: { action: 'create', error },
    };
  }

  const nextRun = schedule.nextFrom(new Date());
  const nextRunStr = nextRun ? nextRun.toISOString() : '无（表达式在未来 365 天内无匹配）';
  const typeStr = recurring ? '循环' : '一次性';
  const durableStr = job.durable ? '持久化' : '会话级';

  return {
    content: [
      {
        type: 'text',
        text: [
          `已创建${typeStr}定时任务:`,
          `  ID: ${job.id}`,
          `  调度: ${schedule.description}`,
          `  Cron: ${cron}`,
          `  类型: ${typeStr} / ${durableStr}`,
          `  状态: 启用`,
          `  下次触发: ${nextRunStr}`,
          job.maxFires ? `  剩余次数: ${job.maxFires}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    details: {
      action: 'create',
      jobId: job.id,
      cron,
      recurring,
      durable: job.durable,
      nextRun: nextRunStr,
    },
  };
}

async function buildListResult(
  scheduler: CronScheduler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const jobs = scheduler.getJobs();

  if (jobs.length === 0) {
    return {
      content: [{ type: 'text', text: '暂无定时任务。使用 action="create" 创建一个。' }],
      details: { action: 'list', jobs: [] },
    };
  }

  const lines: string[] = [`共 ${jobs.length} 个定时任务:\n`];

  let index = 0;
  for (const job of jobs) {
    index++;
    const schedule = parseCron(job.cron);
    const nextRun = schedule?.nextFrom(new Date(job.lastFiredAt ?? job.createdAt));
    const nextStr = nextRun ? nextRun.toISOString() : '已过期';
    const status = job.enabled ? '启用' : '暂停';
    const type = job.recurring ? '循环' : '一次性';
    const persist = job.durable ? '持久' : '会话';

    lines.push(
      `${index}. [${status}] ${job.id}`,
      `   调度: ${schedule?.description ?? job.cron}`,
      `   类型: ${type} / ${persist} | 已触发: ${job.fireCount}次 | 下次: ${nextStr}`,
      `   任务: ${job.prompt.slice(0, 80)}${job.prompt.length > 80 ? '...' : ''}`,
      ''
    );
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details: {
      action: 'list',
      count: jobs.length,
      jobs: jobs.map((j) => ({ id: j.id, cron: j.cron })),
    },
  };
}

async function buildUpdateResult(
  scheduler: CronScheduler,
  params: CronToolParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!params.job_id) {
    return {
      content: [{ type: 'text', text: '请提供 job_id 参数。' }],
      details: { action: 'update', error: 'job_id 参数为空' },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: any = {};
  if (params.new_cron !== undefined) updates.cron = params.new_cron;
  if (params.new_prompt !== undefined) updates.prompt = params.new_prompt;
  if (params.enabled !== undefined) updates.enabled = params.enabled;

  if (Object.keys(updates).length === 0) {
    return {
      content: [{ type: 'text', text: '请提供要更新的参数（new_cron / new_prompt / enabled）。' }],
      details: { action: 'update', error: '无更新参数' },
    };
  }

  const error = await scheduler.updateJob(params.job_id, updates);
  if (error) {
    return {
      content: [{ type: 'text', text: `[更新失败] ${error}` }],
      details: { action: 'update', error },
    };
  }

  return {
    content: [{ type: 'text', text: `任务 ${params.job_id} 已更新。` }],
    details: { action: 'update', jobId: params.job_id, updates },
  };
}

async function buildRemoveResult(
  scheduler: CronScheduler,
  params: CronToolParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!params.job_id) {
    return {
      content: [{ type: 'text', text: '请提供 job_id 参数。' }],
      details: { action: 'remove', error: 'job_id 参数为空' },
    };
  }

  const removed = await scheduler.removeJob(params.job_id);
  if (!removed) {
    return {
      content: [{ type: 'text', text: `[删除失败] 任务未找到: ${params.job_id}` }],
      details: { action: 'remove', error: `任务未找到: ${params.job_id}` },
    };
  }

  return {
    content: [{ type: 'text', text: `任务 ${params.job_id} 已删除。` }],
    details: { action: 'remove', jobId: params.job_id },
  };
}

async function buildPauseResult(
  scheduler: CronScheduler,
  params: CronToolParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!params.job_id) {
    return {
      content: [{ type: 'text', text: '请提供 job_id 参数。' }],
      details: { action: 'pause', error: 'job_id 参数为空' },
    };
  }

  const error = await scheduler.updateJob(params.job_id, { enabled: false });
  if (error) {
    return {
      content: [{ type: 'text', text: `[暂停失败] ${error}` }],
      details: { action: 'pause', error },
    };
  }

  return {
    content: [{ type: 'text', text: `任务 ${params.job_id} 已暂停。` }],
    details: { action: 'pause', jobId: params.job_id },
  };
}

async function buildResumeResult(
  scheduler: CronScheduler,
  params: CronToolParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!params.job_id) {
    return {
      content: [{ type: 'text', text: '请提供 job_id 参数。' }],
      details: { action: 'resume', error: 'job_id 参数为空' },
    };
  }

  const error = await scheduler.updateJob(params.job_id, { enabled: true });
  if (error) {
    return {
      content: [{ type: 'text', text: `[恢复失败] ${error}` }],
      details: { action: 'resume', error },
    };
  }

  return {
    content: [{ type: 'text', text: `任务 ${params.job_id} 已恢复。` }],
    details: { action: 'resume', jobId: params.job_id },
  };
}

async function buildRunResult(
  scheduler: CronScheduler,
  params: CronToolParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!params.job_id) {
    return {
      content: [{ type: 'text', text: '请提供 job_id 参数。' }],
      details: { action: 'run', error: 'job_id 参数为空' },
    };
  }

  const error = await scheduler.triggerJob(params.job_id);
  if (error) {
    return {
      content: [{ type: 'text', text: `[执行失败] ${error}` }],
      details: { action: 'run', error },
    };
  }

  return {
    content: [{ type: 'text', text: `任务 ${params.job_id} 已触发执行。` }],
    details: { action: 'run', jobId: params.job_id },
  };
}

async function buildStatusResult(
  scheduler: CronScheduler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const status = await scheduler.getStatus();
  const lines = [
    '调度器状态:',
    `  运行中: ${status.running ? '是' : '否'}`,
    `  总任务数: ${status.jobCount}`,
    `  已启用: ${status.enabledCount}`,
    `  持久化任务: ${status.durableCount}`,
    `  会话任务: ${status.sessionCount}`,
  ];

  if (status.running && status.enabledCount > 0) {
    const jobs = scheduler.getJobs();
    const enabledJobs = jobs.filter((j) => j.enabled);
    if (enabledJobs.length > 0) {
      lines.push('\n最近到期任务:');
      const now = new Date();
      for (const job of enabledJobs.slice(0, 5)) {
        const schedule = parseCron(job.cron);
        const nextRun = schedule?.nextFrom(
          new Date(Math.max(job.lastFiredAt ?? job.createdAt, now.getTime()))
        );
        lines.push(`  ${job.id}: ${nextRun?.toISOString() ?? '无'} — ${job.prompt.slice(0, 50)}`);
      }
    }
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details: { action: 'status', ...status },
  };
}
