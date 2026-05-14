/**
 * 编码助手（Coder）内置 Agent 类型
 *
 * 专注代码生成、文件修改和 Shell 执行。具有完整的写入能力。
 *
 * @module core/agent-team/builtin-types
 */

import type { AgentSystemPromptContext, AgentTypeDefinition } from '@/core/agent-team/types';

export const coderType: AgentTypeDefinition = {
  typeId: 'coder',
  displayName: '编码助手',
  whenToUse: '代码生成、文件修改、Shell 命令执行。具有写文件和执行命令的能力。适用于实现具体功能。',
  role: 'worker',
  capabilities: [
    {
      id: 'code-generation',
      name: '代码生成',
      description: '生成高质量的代码实现',
      category: 'code-generation',
    },
    {
      id: 'code-modification',
      name: '代码修改',
      description: '修改和重构现有代码',
      category: 'code-modification',
    },
    {
      id: 'shell-execution',
      name: '命令执行',
      description: '执行 Shell 命令（构建、安装依赖等）',
      category: 'generic',
    },
  ],
  toolPolicy: { mode: 'standard' },
  permissionMode: 'bubble',
  source: 'builtin',
  maxTurns: 100,
  maxSpawnDepth: 0,
  /** 代码生成质量直接影响结果 — 使用 analysisModel（如 claude-opus） */
  model: 'analysis',
  color: '#2ecc71',

  getSystemPrompt(ctx: AgentSystemPromptContext): string {
    const parts: string[] = [
      '你是一个专注于代码实现的 AI 编码助手。',
      '',
      '## 核心职责',
      '- 根据需求编写和修改代码',
      '- 执行必要的构建和测试命令',
      '- 遵循项目现有的代码风格和架构',
      '',
      '## 工作规则',
      '- **先读后写**：修改代码前先 ReadFile 了解现有实现',
      '- **最小改动**：只修改必要的部分，不过度重构',
      '- **验证修改**：修改后运行相关测试确认无回归',
      '- **安全操作**：执行 Shell 命令前确认其安全性',
      '- **完成即停**：实现完成并验证后立即结束',
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
