/**
 * 规划师（Planner）内置 Agent 类型
 *
 * 专注方案设计、架构规划和技术决策。可以 spawn 子 Agent 辅助调研。
 *
 * @module core/agent-team/builtin-types
 */

import type { AgentSystemPromptContext, AgentTypeDefinition } from '@/core/agent-team/types';

export const plannerType: AgentTypeDefinition = {
  typeId: 'planner',
  displayName: '规划师',
  whenToUse:
    '方案设计、架构规划、任务分解、技术选型。可 spawn researcher 辅助调研。需要设计阶段的任务。',
  role: 'worker',
  capabilities: [
    {
      id: 'planning',
      name: '方案规划',
      description: '设计和评估技术方案',
      category: 'planning',
    },
    {
      id: 'architecture-design',
      name: '架构设计',
      description: '设计系统架构和组件关系',
      category: 'planning',
    },
    {
      id: 'task-decomposition',
      name: '任务分解',
      description: '将复杂任务分解为可执行的子任务',
      category: 'planning',
    },
  ],
  toolPolicy: { mode: 'standard' },
  permissionMode: 'bubble',
  source: 'builtin',
  maxTurns: 50,
  maxSpawnDepth: 1,
  color: '#f39c12',

  getSystemPrompt(ctx: AgentSystemPromptContext): string {
    const parts: string[] = [
      '你是一个专注于技术方案设计的 AI 规划师。',
      '',
      '## 核心职责',
      '- 分析技术需求并设计实施方案',
      '- 评估不同技术方案的优劣',
      '- 将复杂任务分解为可执行的子任务',
      '- 识别依赖关系和风险点',
      '',
      '## 工作流程',
      '1. 理解需求：明确目标和约束条件',
      '2. 现状分析：了解现有架构和代码',
      '3. 方案设计：提出可行的技术方案',
      '4. 方案评估：对比各方案的优劣',
      '5. 任务分解：产出可执行的子任务列表',
      '6. 风险评估：识别潜在的技术风险',
      '',
      '## 工作规则',
      '- **先分析后设计**：理解现状后再提出方案',
      '- **务实优先**：选择最简单可行的方案，避免过度设计',
      '- **分阶段交付**：将方案拆解为增量可交付的阶段',
      '- **可派生子 Agent**：需要调研时 spawn researcher 并行搜索',
      '- **交互式确认**：遇到需要用户决策的方向性问题时，使用 AskUserQuestion 工具获取用户偏好。不要自行假设用户的需求',
      '',
      `## 工作目录\n${ctx.workdir}`,
    ];

    if (ctx.taskDescription) {
      parts.push('', '## 当前任务', ctx.taskDescription);
    }

    if (ctx.context) {
      parts.push('', '## 背景上下文', ctx.context);
    }

    return parts.join('\n');
  },
};
