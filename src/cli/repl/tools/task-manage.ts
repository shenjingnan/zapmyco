/**
 * task_manage 工具实现 — Agent 任务跟踪与管理
 *
 * 参考 Hermes-Agent 的 todo 工具（单工具 + merge 模式）和
 * Claude Code 的 TaskCreate/TaskUpdate/TaskList 设计。
 *
 * 操作模式:
 * - action: "read"  → 读取当前任务列表（默认）
 * - action: "write" → 全量替换任务列表
 * - action: "update" → 按 ID 增量更新单个任务
 *
 * @module cli/repl/tools/task-manage
 */

import type { TaskStore } from '@/core/task/task-store';
import type {
  TaskItemStatus,
  TaskManageAction,
  TaskManageInputItem,
  TaskManageSummary,
} from '@/core/task/types';

// ============ 类型定义 ============

/** task_manage 工具参数 */
export interface TaskManageParams {
  action?: TaskManageAction;
  tasks?: TaskManageInputItem[];
  merge?: boolean;
}

/** task_manage 返回详情 */
export interface TaskManageDetails {
  action: TaskManageAction;
  tasks: Array<{
    id: string;
    subject: string;
    description?: string;
    status: string;
  }>;
  summary: TaskManageSummary;
  error?: string;
}

// ============ 工具描述 ============

const TASK_MANAGE_DESCRIPTION = `任务管理工具 — 对于多步骤任务，**这必须是你调用的第一个工具**。

## 何时必须使用
收到任何需要 2 个以上独立步骤的任务时，**在调用任何其他工具之前**，必须先用 action="write" 将任务分解为子任务。
**你的第一个 tool call 必须是 task_manage！** 不得先搜索、读取、执行任何操作！

## 操作类型 (action)
- "read": 读取当前任务列表和进度摘要
- "write": 设置任务列表。传入 tasks 数组。用于初次规划或重新规划。merge=true 可追加/更新任务而不删除已有任务
- "update": 更新单个任务状态。每完成一个子任务**立即**调用 update 标记状态，**不要等到所有任务做完才批量更新**

## 必须遵守的规则
1. 任何 2 个以上步骤的任务：第一个 tool call = task_manage write，先规划再执行
2. 每次只能有 1 个任务处于 "in_progress" 状态
3. 完成一个子任务后**立刻** update 为 "completed"，然后再开始下一个
4. 任务状态: "pending"(未开始), "in_progress"(进行中), "completed"(已完成), "cancelled"(已取消)
5. 不要在一条消息中批量标记多个任务完成 — 每个任务完成时单独 update

> 提示：如果项目启用了 spawn_subagents 工具，规划完成后识别其中互不依赖的子任务，使用 spawn_subagents 并行执行它们，然后根据结果更新任务状态。`;

// ============ task_manage 工具 ============

/**
 * 创建 task_manage 工具
 *
 * @param store - TaskStore 实例（由 ReplSession 注入，保证会话级生命周期）
 */
export function createTaskManageTool(store: TaskStore) {
  return {
    id: 'task_manage' as const,
    label: '任务管理',
    description: TASK_MANAGE_DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string' as const,
          description:
            '操作类型: "read"(读取), "write"(全量设置), "update"(更新单个任务)。默认 "read"。',
          enum: ['read', 'write', 'update'],
        },
        tasks: {
          type: 'array' as const,
          description:
            '任务项数组。write 模式传入完整任务列表，update 模式只传入需要更新的任务。每项包含: id(标识), subject(标题), description(描述, 可选), status(状态)',
          items: {
            type: 'object' as const,
            properties: {
              id: {
                type: 'string' as const,
                description: '任务唯一标识，如 "1", "2", "search-files"',
              },
              subject: {
                type: 'string' as const,
                description: '简短标题（祈使句），如 "搜索相关文件"',
              },
              description: {
                type: 'string' as const,
                description: '详细描述（可选）',
              },
              status: {
                type: 'string' as const,
                description: '任务状态',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              },
            },
            required: ['id', 'subject', 'status'],
          },
        },
        merge: {
          type: 'boolean' as const,
          description:
            'write 模式下是否按 ID 合并（默认 false 全量替换）。设为 true 时按 ID 新增/更新任务，不删除已有任务。',
        },
      },
    } as const,

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(_toolCallId: string, params: TaskManageParams): Promise<any> {
      const action = params.action ?? 'read';

      switch (action) {
        case 'read':
          return buildReadResult(store);
        case 'write':
          return buildWriteResult(store, params.tasks, params.merge);
        case 'update':
          return buildUpdateResult(store, params.tasks);
        default:
          return {
            content: [{ type: 'text', text: `不支持的操作: ${action}` }],
            details: {
              action,
              tasks: [],
              summary: { total: 0, pending: 0, in_progress: 0, completed: 0, cancelled: 0 },
              error: `不支持的操作: ${action}`,
            },
          };
      }
    },
  };
}

// ============ 操作实现 ============

function buildReadResult(store: TaskStore) {
  const tasks = store.read();
  const summary = store.summary();

  const details: TaskManageDetails = {
    action: 'read',
    tasks,
    summary,
  };

  if (tasks.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: '当前没有任务。使用 action="write" 创建任务列表来分解复杂工作。',
        },
      ],
      details,
    };
  }

  const lines: string[] = [`共 ${summary.total} 个任务:`, ''];

  for (const task of tasks) {
    const marker = statusMarker(task.status);
    const desc = task.description ? ` — ${task.description}` : '';
    lines.push(`  ${marker} [${task.id}] ${task.subject}${desc}`);
  }

  lines.push('');
  lines.push(
    `进度: ${summary.pending} 待处理 | ${summary.in_progress} 进行中 | ${summary.completed} 已完成 | ${summary.cancelled} 已取消`
  );

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details,
  };
}

function buildWriteResult(
  store: TaskStore,
  tasks: TaskManageInputItem[] | undefined,
  merge: boolean | undefined
) {
  if (!tasks || tasks.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: '请提供 tasks 参数（任务列表）。使用空数组可清空所有任务。',
        },
      ],
      details: {
        action: 'write' as const,
        tasks: [],
        summary: store.summary(),
        error: 'tasks 参数为空',
      },
    };
  }

  const error = store.write(tasks, merge ?? false);
  if (error) {
    return {
      content: [{ type: 'text', text: `[任务更新失败] ${error}` }],
      details: {
        action: 'write' as const,
        tasks: store.read(),
        summary: store.summary(),
        error,
      },
    };
  }

  const summary = store.summary();
  const lines: string[] = [
    `任务列表已更新（${merge ? '合并模式' : '替换模式'}）`,
    `共 ${summary.total} 个任务: ${summary.pending} 待处理 | ${summary.in_progress} 进行中 | ${summary.completed} 已完成 | ${summary.cancelled} 已取消`,
  ];

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details: {
      action: 'write' as const,
      tasks: store.read(),
      summary,
    },
  };
}

function buildUpdateResult(store: TaskStore, tasks: TaskManageInputItem[] | undefined) {
  if (!tasks || tasks.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: '请提供 tasks 参数，包含要更新的任务（带 id 和新的 status）。',
        },
      ],
      details: {
        action: 'update' as const,
        tasks: store.read(),
        summary: store.summary(),
        error: 'tasks 参数为空',
      },
    };
  }

  const results: string[] = [];
  let hasError = false;

  for (const item of tasks) {
    const updates: { subject?: string; description?: string; status?: TaskItemStatus } = {
      subject: item.subject,
      status: item.status,
    };
    if (item.description !== undefined) {
      updates.description = item.description;
    }
    const error = store.update(item.id, updates);

    if (error) {
      results.push(`  ❌ [${item.id}]: ${error}`);
      hasError = true;
    } else {
      const task = store.read().find((t) => t.id === item.id);
      const marker = task ? statusMarker(task.status) : '';
      results.push(`  ✅ [${item.id}] → ${marker} ${item.status}`);
    }
  }

  const summary = store.summary();
  const header = hasError ? '部分任务更新失败:' : '任务已更新:';

  return {
    content: [{ type: 'text', text: [header, ...results].join('\n') }],
    details: {
      action: 'update' as const,
      tasks: store.read(),
      summary,
      error: hasError ? '部分更新失败，详见结果' : undefined,
    },
  };
}

// ============ 工具函数 ============

function statusMarker(status: string): string {
  switch (status) {
    case 'pending':
      return '○';
    case 'in_progress':
      return '▶';
    case 'completed':
      return '✅';
    case 'cancelled':
      return '❌';
    default:
      return '?';
  }
}
