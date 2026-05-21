/**
 * TaskStop 工具
 *
 * 允许 Coordinator 停止正在运行的子 Agent 任务。
 * 供 Coordinator 模式下的主 Agent 使用。
 *
 * @module cli/repl/tools
 */

import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import { getAgentInstanceManager } from '@/core/agent-team/agent-instance-manager';

/**
 * 创建 TaskStop 工具注册
 *
 * @returns ToolRegistration
 */
export function createTaskStopTool(): ToolRegistration {
  return {
    id: 'TaskStop',
    label: '停止任务',
    defaultRisk: 'medium' as const,
    description: [
      '停止正在运行中的子 Agent 任务。',
      '',
      '### 何时使用此工具',
      '1. 子 Agent 执行方向错误，需要中止',
      '2. 用户需求变更，当前子任务不再需要',
      '3. 子 Agent 陷入死循环或异常状态',
      '4. 需要立即停止所有子任务以重新规划',
      '',
      '### 参数说明',
      '- **task_id**: 要停止的子 Agent 实例 ID（AgentTool 返回的 instanceId）',
      '',
      '### 使用示例',
      '停止指定任务: `{ "task_id": "agent-xyz-123" }`',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: '要停止的子 Agent 实例 ID（AgentTool 返回结果中的 instanceId）',
        },
      },
      required: ['task_id'],
    } as unknown as import('typebox').TSchema,
    execute: async (_toolCallId: string, params) => {
      const { task_id } = params as { task_id: string };
      const instanceManager = getAgentInstanceManager();
      const instance = instanceManager.get(task_id);

      if (!instance) {
        return {
          content: [{ type: 'text', text: `⚠️ 未找到任务 \`${task_id}\`` }],
          details: { taskId: task_id, found: false },
        };
      }

      // 只有 running 或 idle 状态的任务可以被停止
      if (instance.status !== 'running' && instance.status !== 'idle') {
        return {
          content: [
            {
              type: 'text',
              text: `⚠️ 任务 \`${task_id}\` 当前状态为 \`${instance.status}\`，无法停止`,
            },
          ],
          details: { taskId: task_id, status: instance.status, stopped: false },
        };
      }

      // 使用 AgentInstanceManager.cancel() 递归取消（含子实例）
      const cancelled = await instanceManager.cancel(task_id);

      return {
        content: [{ type: 'text', text: `✅ 任务 \`${task_id}\` 已停止` }],
        details: { taskId: task_id, stopped: true, cancelled: cancelled.length },
      };
    },
  };
}
