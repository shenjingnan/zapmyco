/**
 * SendMessageTool（Agent 间通信）
 *
 * 允许 Worker Agent 向 Coordinator 或其他 Agent 发送消息。
 * 这是 A2A 通信的主要入口，Worker 可通过此工具：
 * - 向 Coordinator 提问确认
 * - 报告执行进度
 * - 发送中间结果
 *
 * @module cli/repl/tools
 */

import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import { getAgentMessageBus } from '@/core/agent-team/agent-message-bus';
import type { SendMessageParams } from '@/core/agent-team/types';
import type { RiskLevel } from '@/security/types';

/**
 * 创建 SendMessage 工具注册
 *
 * @param currentAgentInstanceId - 当前 Agent 的实例 ID（用于 fromAgentId）
 * @returns ToolRegistration
 */
export function createSendMessageTool(currentAgentInstanceId: string): ToolRegistration {
  return {
    id: 'SendMessage',
    label: '发送消息',
    defaultRisk: 'medium' as RiskLevel,
    description: [
      '向其他 Agent 发送消息，用于 Agent 间通信。',
      '',
      '### 何时使用此工具',
      '1. 执行过程中需要向父 Agent/Coordinator 确认某些信息',
      '2. 发现任务描述不够明确，需要澄清',
      '3. 需要向 Coordinator 报告中间进度或部分结果',
      '4. 需要告知 Coordinator 任务可以提前结束',
      '',
      '### 何时不使用此工具',
      '- 任务已完全完成（直接返回结果即可）',
      '- 不需要和其他 Agent 交互',
      '',
      '### 参数说明',
      '- **toAgentId**: 目标 Agent 的实例 ID。使用 `parent` 表示父 Agent',
      '- **message**: 要发送的消息内容',
      '- **messageType**: 消息类型',
      '  - `question`: 需要确认或回答的问题',
      '  - `progress`: 进度报告',
      '  - `task_result`: 部分结果或中间产出',
      '',
      `### 你的实例 ID: \`${currentAgentInstanceId}\``,
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        toAgentId: {
          type: 'string',
          description: '目标 Agent 实例 ID（或 "parent" 表示父 Agent）',
        },
        message: {
          type: 'string',
          description: '消息内容',
        },
        messageType: {
          type: 'string',
          enum: ['question', 'progress', 'task_result'],
          description: '消息类型',
          default: 'progress',
        },
      },
      required: ['toAgentId', 'message'],
    } as unknown as import('typebox').TSchema,
    execute: async (_toolCallId: string, params) => {
      const p = params as SendMessageParams;
      const messageBus = getAgentMessageBus();

      // 映射 SendMessageParams.messageType 到 AgentMessageType
      const msgType =
        p.messageType === 'question'
          ? 'question'
          : p.messageType === 'result'
            ? 'task_result'
            : 'progress';

      const fullMessage = messageBus.publish(currentAgentInstanceId, p.toAgentId, {
        type: msgType,
        payload: p.message,
        requiresResponse: p.messageType === 'question',
      });

      return {
        content: [
          {
            type: 'text',
            text: `消息已发送 (ID: ${fullMessage.messageId})\n目标: ${p.toAgentId}\n类型: ${p.messageType ?? 'progress'}`,
          },
        ],
        details: fullMessage,
      };
    },
  };
}
