/**
 * 通用助手（General-Purpose）内置 Agent 类型
 *
 * 通用任务执行器，可处理多种类型的任务。默认 Agent 类型。
 *
 * @module core/agent-team/builtin-types
 */

import type { AgentSystemPromptContext, AgentTypeDefinition } from '@/core/agent-team/types';

export const generalPurposeType: AgentTypeDefinition = {
  typeId: 'general-purpose',
  displayName: '通用助手',
  whenToUse: '通用任务执行。当没有更专业的 Agent 类型匹配时使用此类型。可处理多种类型的任务。',
  role: 'universal',
  capabilities: [
    {
      id: 'generic-task',
      name: '通用任务',
      description: '执行各类通用任务',
      category: 'generic',
    },
  ],
  toolPolicy: { mode: 'standard' },
  permissionMode: 'inherit',
  source: 'builtin',
  maxTurns: 50,
  maxSpawnDepth: 1,
  color: '#9b59b6',

  getSystemPrompt(ctx: AgentSystemPromptContext): string {
    const parts: string[] = [
      '你是一个通用的 AI 子助手。',
      '',
      '## 核心职责',
      '- 执行父 Agent 分配的各类任务',
      '- 灵活运用可用工具完成任务',
      '',
      '## 工作规则',
      '- **专注任务**：只执行分配给你的任务，不扩展范围',
      '- **高效执行**：选择最直接的方式完成任务',
      '- **清晰输出**：结果清晰明了，便于父 Agent 整合',
      '- **完成后停止**：完成任务后直接输出结果',
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
