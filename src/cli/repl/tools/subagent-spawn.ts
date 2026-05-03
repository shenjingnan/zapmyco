/**
 * spawn_subagents 工具
 *
 * 允许父 Agent 并行启动多个子 Agent 执行独立任务。
 * 工具会同步等待所有子 Agent 完成后返回汇总结果。
 *
 * @module cli/repl/tools/subagent-spawn
 */

import type { SubAgentConfig } from '@/config/types';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import type { SubAgentManager } from '@/core/sub-agent/sub-agent-manager';

/**
 * 创建 spawn_subagents 工具注册
 *
 * @param manager - SubAgentManager 实例
 * @param config - Sub-Agent 系统配置
 * @returns ToolRegistration
 */
export function createSpawnSubAgentsTool(
  manager: SubAgentManager,
  _config: SubAgentConfig
): ToolRegistration {
  return {
    id: 'spawn_subagents',
    label: '派生子 Agent',
    description: [
      '并行启动多个子 Agent 执行独立任务，等待全部完成后汇总返回结果。',
      '',
      '### 何时使用此工具',
      '1. 用户请求包含 2 个以上互不依赖的独立步骤',
      '2. 每个步骤需要独立的搜索、分析或研究',
      '3. 步骤之间没有顺序依赖关系，可以同时进行',
      '',
      '### 何时不使用此工具',
      '- 只有 1 个任务时（直接执行即可）',
      '- 任务之间有严格的顺序依赖（必须串行执行）',
      '- 任务非常简单（如读取单个文件）',
      '',
      '### 使用流程',
      '1. 先用 task_manage write 规划所有子任务',
      '2. 识别其中可并行的独立子任务',
      '3. 调用本工具一次性派发所有并行子任务',
      '4. 根据返回结果更新 task_manage 状态',
      '5. 继续处理依赖这些结果的后续任务',
      '',
      '### 参数说明',
      '- agents: 子任务列表，每个包含 id（唯一标识）、description（详细指令）、allowedTools（可选工具白名单）',
      '- context: 可选背景摘要，会注入给每个子 Agent 帮助它们理解任务背景',
      '',
      '### 子 Agent 的能力',
      '默认情况下子 Agent 拥有安全的只读工具集：read_file, glob, grep, web_fetch, web_search。',
      '如需子 Agent 写文件或执行命令，请在 allowedTools 中显式指定。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
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
                description: '可选工具白名单，默认使用安全工具集',
              },
            },
            required: ['id', 'description'],
          },
          description: '要并行创建的子 Agent 列表',
        },
        context: {
          type: 'string',
          description: '可选背景摘要，注入给每个子 Agent',
        },
      },
      required: ['agents'],
    } as unknown as import('typebox').TSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (_toolCallId: string, params: any): Promise<any> => {
      const { agents, context } = params as {
        agents: Array<{ id: string; description: string; allowedTools?: string[] }>;
        context?: string;
      };
      const results = await manager.spawnAndWait(agents, context);

      return {
        content: [{ type: 'text', text: results.summary }],
        details: results,
      };
    },
  };
}
