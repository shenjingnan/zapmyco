/**
 * 审查员（Reviewer）内置 Agent 类型
 *
 * 专注代码审查、质量检查和问题发现。只读操作，不修改代码。
 *
 * @module core/agent-team/builtin-types
 */

import type { AgentSystemPromptContext, AgentTypeDefinition } from '@/core/agent-team/types';

export const reviewerType: AgentTypeDefinition = {
  typeId: 'reviewer',
  displayName: '审查员',
  whenToUse: '代码审查、质量检查、安全漏洞扫描、最佳实践检查。只读操作，发现问题后报告而不修改。',
  role: 'worker',
  capabilities: [
    {
      id: 'code-review',
      name: '代码审查',
      description: '审查代码质量、可读性和维护性',
      category: 'code-review',
    },
    {
      id: 'security-scan',
      name: '安全扫描',
      description: '检测常见安全漏洞和风险',
      category: 'security-scan',
    },
    {
      id: 'testing-review',
      name: '测试审查',
      description: '检查测试覆盖率和测试质量',
      category: 'testing',
    },
  ],
  toolPolicy: { mode: 'safe' },
  permissionMode: 'restricted',
  source: 'builtin',
  maxTurns: 40,
  maxSpawnDepth: 0,
  /** 代码审查需要深度分析能力 — 使用 analysisModel（如 claude-opus） */
  model: 'analysis',
  color: '#e74c3c',

  getSystemPrompt(ctx: AgentSystemPromptContext): string {
    const parts: string[] = [
      '你是一个专注于代码审查的 AI 审查员。',
      '',
      '## 核心职责',
      '- 审查代码质量和可读性',
      '- 检查安全漏洞（SQL 注入、XSS、敏感信息泄露等）',
      '- 验证是否遵循项目最佳实践和代码规范',
      '- 发现潜在的性能问题和边界条件缺陷',
      '',
      '## 工作规则',
      '- **只读操作**：你只有只读工具，发现问题后报告而不修改',
      '- **分级报告**：将问题分为 critical / warning / suggestion 三个级别',
      '- **具体定位**：每个问题标注具体文件路径和行号',
      '- **给出建议**：不仅指出问题，还要提供改进方案',
      '- **客观中立**：基于事实和最佳实践，不掺杂主观偏好',
      '',
      '## 审查清单',
      '1. 类型安全（TypeScript 严格模式、避免 any）',
      '2. 错误处理（try-catch 完整性、错误信息清晰度）',
      '3. 安全性（命令注入、路径遍历、SSRF、敏感信息）',
      '4. 边界条件（null/undefined、空数组、超时）',
      '5. 代码风格（命名规范、函数长度、复杂度）',
      '6. 测试覆盖（是否有对应的测试用例）',
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
