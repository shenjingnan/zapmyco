/**
 * AskUserQuestion 工具
 *
 * 允许 Agent 在执行过程中向用户提问以获取决策指导。
 * 支持单选、多选、自定义答案（Other）和预览面板。
 *
 * @module cli/repl/tools/ask-user-question
 */

import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import { getQuestionManager } from '@/core/question';
import type { AskUserQuestionParams } from '@/core/question/types';
import { getToolGuardContext, SecurityBlockedError } from '@/security/tool-guard';
import type { RiskLevel } from '@/security/types';

/**
 * 创建 AskUserQuestion 工具注册
 */
export function createAskUserQuestionTool(): ToolRegistration {
  return {
    id: 'AskUserQuestion',
    label: '向用户提问',
    defaultRisk: 'medium' as RiskLevel,
    checkPermission: () => ({
      risk: 'medium' as RiskLevel,
      requiresApproval: false,
      reason: 'AskUserQuestion 使用独立的交互式 UI，不走 ToolGuard 审批路径',
    }),
    description: [
      '向用户提问以获取决策指导。当需要在多个可行方案之间选择、进行技术选型、',
      '或需要用户偏好时使用此工具。',
      '',
      '### 何时使用',
      '- 需要在多个可行方案之间做出选择时',
      '- 需要技术选型、架构决策等需要用户判断的问题',
      '- Plan Mode 中分析完方案后需要用户指定方向时',
      '- 需要明确用户偏好以实现个性化功能时',
      '',
      '### 何时不使用',
      '- 可以通过代码分析直接确定的结论',
      '- 简单确认（直接回复文本询问即可）',
      '- 已有明确最佳实践的问题',
      '',
      '### 提问原则',
      '- 每个问题提供 2-4 个具体、互斥的选项',
      '- header 字段控制在 12 个字符以内',
      '- 使用 multiSelect: true 表示多选',
      '- 推荐选项放在第一位并加 "(Recommended)" 后缀',
      '- 如果选项有代码示例/配置对比，可在 preview 字段中提供（markdown 格式）',
      '- 用户始终可以选择 "Other" 输入自定义答案',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: '完整问题文本，以问号结尾',
              },
              header: {
                type: 'string',
                description: '短标签，用于 Tab 导航（最多 12 个字符）',
              },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: {
                      type: 'string',
                      description: '选项显示文本（1-5 个词）',
                    },
                    description: {
                      type: 'string',
                      description: '选项说明',
                    },
                    preview: {
                      type: 'string',
                      description:
                        '可选的预览内容（markdown 格式）。当任一选项有 preview 时，UI 切换为左右分栏布局',
                    },
                  },
                  required: ['label', 'description'],
                },
                minItems: 2,
                maxItems: 4,
                description: '2-4 个选项',
              },
              multiSelect: {
                type: 'boolean',
                description: '是否允许多选',
                default: false,
              },
            },
            required: ['question', 'header', 'options', 'multiSelect'],
          },
          minItems: 1,
          maxItems: 4,
          description: '1-4 个问题',
        },
      },
      required: ['questions'],
    } as unknown as import('typebox').TSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (_toolCallId: string, params: any): Promise<any> => {
      const p = params as AskUserQuestionParams;

      // 后台 Agent 不能提问
      const ctx = getToolGuardContext();
      if (ctx?.isBackgroundAgent) {
        throw new SecurityBlockedError(
          '后台 Agent 不支持交互式提问（AskUserQuestion）',
          'AskUserQuestion',
          'medium',
          '后台 Agent 无用户交互界面'
        );
      }

      // 参数校验
      if (!p.questions || p.questions.length === 0) {
        return {
          content: [{ type: 'text', text: '错误: 至少需要 1 个问题' }],
          details: { error: true, message: 'questions 数组不能为空' },
        };
      }

      for (let i = 0; i < p.questions.length; i++) {
        const q = p.questions[i]!;
        if (q.options.length < 2) {
          return {
            content: [{ type: 'text', text: `错误: 问题 "${q.header}" 至少需要 2 个选项` }],
            details: { error: true, message: '选项数量不足', questionIndex: i },
          };
        }
        if (q.header.length > 12) {
          return {
            content: [
              {
                type: 'text',
                text: `错误: 问题 "${q.header}" 的 header 超过 12 个字符限制`,
              },
            ],
            details: { error: true, message: 'header 过长', questionIndex: i },
          };
        }
      }

      try {
        const questionManager = getQuestionManager();

        if (!questionManager.hasProvider()) {
          return {
            content: [
              {
                type: 'text',
                text: '错误: 当前环境不支持交互式提问（headless 模式或未初始化 UI）',
              },
            ],
            details: { error: true, message: '无 QuestionProvider' },
          };
        }

        const result = await questionManager.ask(p);

        // 格式化答案文本
        const answerLines = result.questions.map((q) => {
          const answer = result.answers[q.question];
          const answerStr = Array.isArray(answer) ? answer.join(', ') : (answer ?? '(未回答)');
          return `"${q.question}" → "${answerStr}"`;
        });

        return {
          content: [
            {
              type: 'text',
              text: `用户已回答你的问题：\n${answerLines.join('\n')}\n\n你可以根据这些答案继续执行。`,
            },
          ],
          details: {
            questions: result.questions,
            answers: result.answers,
            annotations: result.annotations,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `提问被取消: ${message}`,
            },
          ],
          details: { error: true, message, cancelled: true },
        };
      }
    },
  };
}
