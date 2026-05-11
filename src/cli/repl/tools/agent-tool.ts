/**
 * AgentTool（增强版 SpawnSubAgents）
 *
 * 供 Coordinator/LLM 使用的 Agent 创建和派发工具。
 * 支持按类型创建单个 Agent（subagent_type）和批量创建（agents 兼容）。
 *
 * @module cli/repl/tools
 */

import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import { getBackgroundAgentManager } from '@/core/agent-team/agent-background-manager';
import type { AgentOrchestrator } from '@/core/agent-team/agent-orchestrator';
import { getAgentTypeRegistry } from '@/core/agent-team/agent-type-registry';
import type { AgentToolParams } from '@/core/agent-team/types';
import type { RiskLevel } from '@/security/types';

/**
 * 创建 AgentTool 工具注册
 *
 * @param orchestrator - AgentOrchestrator 实例
 * @returns ToolRegistration
 */
export function createAgentTool(orchestrator: AgentOrchestrator): ToolRegistration {
  const registry = getAgentTypeRegistry();
  const availableTypes = registry
    .list()
    .map((t) => `- **${t.typeId}**: ${t.whenToUse}`)
    .join('\n');

  return {
    id: 'AgentTool',
    label: '创建 Agent',
    defaultRisk: 'high' as RiskLevel,
    description: [
      '创建特定类型的子 Agent 来执行独立任务。支持按 Agent 类型创建（推荐）或批量匿名创建（兼容旧版）。',
      '',
      '### 何时使用此工具',
      '1. 需要分解复杂任务为多个独立子任务时',
      '2. 需要特定类型的 Agent（研究员/编码助手/审查员/规划师）时',
      '3. 多个子任务之间没有顺序依赖关系时可以并行创建',
      '',
      '### 何时不使用此工具',
      '- 只有 1 个简单任务时（直接执行即可）',
      '- 任务之间有严格的顺序依赖（必须串行执行）',
      '- 任务非常简单（如读取单个文件）',
      '',
      '### 可用的 Agent 类型',
      availableTypes,
      '',
      '### 参数说明',
      '- **subagent_type**（推荐）: Agent 类型 ID，如 researcher/coder/reviewer/planner/general-purpose',
      '- **description**: 发给子 Agent 的详细任务指令',
      '- **run_in_background**: 是否后台运行（默认 false）。设为 true 时立即返回 taskId，Agent 在后台执行，完成后自动通知',
      '- **inherit_context**: 是否继承父级上下文',
      '- **agents**（已废弃，兼容旧版）: 批量匿名子 Agent 列表',
      '- **context**: 可选背景摘要',
      '',
      '### 使用流程',
      '1. 分析任务，确定需要的 Agent 类型',
      '2. 为每个 Agent 编写详细的任务指令',
      '3. 调用本工具创建 Agent（可多次调用创建多个不同类型的 Agent）',
      '4. 同步模式：等待结果返回后整合汇总',
      '5. 异步模式：立即返回 taskId，完成后通过收件箱接收通知',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        subagent_type: {
          type: 'string',
          description: `Agent 类型 ID。可用类型: ${registry
            .list()
            .map((t) => t.typeId)
            .join(', ')}`,
        },
        description: {
          type: 'string',
          description: '发给子 Agent 的详细任务指令',
        },
        run_in_background: {
          type: 'boolean',
          description:
            '是否后台运行（默认 false）。设为 true 时 fire-and-forget，Agent 后台执行完成后自动通知父 Agent',
          default: false,
        },
        inherit_context: {
          type: 'boolean',
          description: '是否继承父级上下文',
          default: false,
        },
        agents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '子任务唯一标识' },
              description: { type: 'string', description: '发给子 Agent 的详细任务指令' },
              allowedTools: {
                type: 'array',
                items: { type: 'string' },
                description: '可选工具白名单',
              },
            },
            required: ['id', 'description'],
          },
          description: '[已废弃] 批量匿名子 Agent 列表，请使用 subagent_type 参数',
        },
        context: {
          type: 'string',
          description: '可选背景摘要，注入给每个子 Agent',
        },
      },
      required: ['description'],
    } as unknown as import('typebox').TSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (_toolCallId: string, params: any): Promise<any> => {
      const p = params as AgentToolParams & {
        agents?: Array<{ id: string; description: string; allowedTools?: string[] }>;
      };

      // 异步模式：fire-and-forget
      if (p.run_in_background && p.subagent_type && !p.agents) {
        const bgManager = getBackgroundAgentManager();
        const { taskId, instanceId } = await bgManager.executeAsync({
          typeId: p.subagent_type,
          description: p.description,
          context: p.context,
          inheritContext: p.inherit_context,
        });

        const asyncMsg = [
          `🚀 **${p.subagent_type}** 已作为后台任务启动`,
          '',
          `- 任务 ID: \`${taskId}\``,
          `- 实例 ID: \`${instanceId}\``,
          `- 状态: 后台运行中`,
          '',
          'Agent 完成后将自动通知。可使用 BackgroundTask 工具查询状态。',
        ].join('\n');

        return {
          content: [{ type: 'text', text: asyncMsg }],
          details: { taskId, instanceId, status: 'async_launched' },
        };
      }

      // 异步模式需要 subagent_type
      if (p.run_in_background && !p.subagent_type) {
        return {
          content: [
            {
              type: 'text',
              text: '后台运行模式需要指定 subagent_type 参数。请选择一种 Agent 类型。',
            },
          ],
        };
      }

      // 新版单 Agent 路径（同步）
      if (p.subagent_type && !p.agents) {
        const result = await orchestrator.spawnWorker(p.subagent_type, p.description, {
          ...(p.context != null ? { context: p.context } : {}),
          ...(p.inherit_context != null ? { inheritContext: p.inherit_context } : {}),
        });

        const summary =
          result.status === 'success'
            ? `✅ **${result.typeId}** 执行成功 (${(result.duration / 1000).toFixed(1)}s)\n\n${result.output ?? '（无输出）'}`
            : `❌ **${result.typeId}** 执行失败: ${result.error?.message ?? '未知错误'}`;

        return {
          content: [{ type: 'text', text: summary }],
          details: result,
        };
      }

      // 兼容旧版批量路径
      if (p.agents && p.agents.length > 0) {
        const results = await orchestrator.spawnFlat(p.agents, p.context);

        return {
          content: [{ type: 'text', text: results.summary }],
          details: results,
        };
      }

      // 既没有 subagent_type 也没有 agents
      return {
        content: [
          {
            type: 'text',
            text: '请指定 subagent_type（推荐的 Agent 类型）或 agents（已废弃的批量参数）。',
          },
        ],
      };
    },
  };
}
