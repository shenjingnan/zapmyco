/**
 * 研究员（Researcher）内置 Agent 类型
 *
 * 专注信息搜集、技术调研和代码分析。只读工具，不修改任何文件。
 *
 * @module core/agent-team/builtin-types
 */

import type { AgentSystemPromptContext, AgentTypeDefinition } from '@/core/agent-team/types';

export const researcherType: AgentTypeDefinition = {
  typeId: 'researcher',
  displayName: '研究员',
  whenToUse: '信息搜集、技术调研、方案对比、文档查找、代码分析。只读操作，不会修改任何文件。',
  role: 'worker',
  capabilities: [
    {
      id: 'web-research',
      name: '网络调研',
      description: '搜索和分析网络信息，查找技术文档和最佳实践',
      category: 'research',
    },
    {
      id: 'code-analysis',
      name: '代码分析',
      description: '读取和分析代码结构、依赖关系和设计模式',
      category: 'code-analysis',
    },
    {
      id: 'documentation',
      name: '文档查阅',
      description: '查找和阅读项目文档、API 参考',
      category: 'documentation',
    },
  ],
  toolPolicy: { mode: 'safe' },
  permissionMode: 'restricted',
  source: 'builtin',
  maxTurns: 30,
  maxSpawnDepth: 0,
  /** 信息搜集、文档查找等任务可用轻量模型降低成本 — 使用 lightModel（如 claude-haiku） */
  model: 'light',
  color: '#3498db',

  getSystemPrompt(ctx: AgentSystemPromptContext): string {
    const parts: string[] = [
      '你是一个专注于信息搜集和分析的 AI 研究员。',
      '',
      '## 核心职责',
      '- 搜索和收集相关信息（WebSearch、WebFetch）',
      '- 阅读和分析代码文件（ReadFile、Glob、Grep）',
      '- 整理和呈现结构化的调查结果',
      '- 提供客观、有据可查的结论',
      '',
      '## 工作规则',
      '- **只读操作**：你只有只读工具，不能修改任何文件或执行命令',
      '- **专注范围**：只回答任务范围内的问题，不主动扩展',
      '- **引用来源**：提供信息时标注来源（URL、文件名、行号）',
      '- **结构化输出**：使用清晰的标题和列表组织信息',
      '- **完成即停**：得出明确结论后立即结束，不要循环搜索',
      '',
      `## 工作目录\n${ctx.workdir}`,
    ];

    if (ctx.taskDescription) {
      parts.push('', '## 当前任务', ctx.taskDescription);
    }

    if (ctx.context) {
      parts.push('', '## 背景上下文', ctx.context);
    }

    if (ctx.upstreamResults?.length) {
      parts.push('', '## 上游结果', ...ctx.upstreamResults.map((r) => `- ${r}`));
    }

    return parts.join('\n');
  },
};
