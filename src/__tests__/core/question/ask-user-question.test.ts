/**
 * AskUserQuestion 工具测试
 */
import { describe, expect, it } from 'vitest';
import { createAskUserQuestionTool } from '@/cli/repl/tools/ask-user-question';
import { getQuestionManager, resetQuestionManager } from '@/core/question';
import type { QuestionProvider } from '@/core/question/types';
import { runWithToolGuardContext, SecurityBlockedError } from '@/security/tool-guard';

function makeProvider(answers: Record<string, string>): QuestionProvider {
  return {
    showQuestions: async (params) => ({
      questions: params.questions,
      answers,
    }),
  };
}

/** 从工具结果中提取第一个文本内容 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getText(result: any): string {
  return result.content[0]?.text ?? '';
}

describe('AskUserQuestion tool', () => {
  const tool = createAskUserQuestionTool();

  it('should have correct id', () => {
    expect(tool.id).toBe('AskUserQuestion');
  });

  it('should have medium default risk', () => {
    expect(tool.defaultRisk).toBe('medium');
  });

  it('should return error when questions is empty', async () => {
    const result = await tool.execute('call-1', { questions: [] });
    expect(getText(result)).toContain('至少需要 1 个问题');
  });

  it('should return error when option count < 2', async () => {
    const result = await tool.execute('call-1', {
      questions: [
        {
          question: 'Test?',
          header: 'Test',
          options: [{ label: 'Only', description: 'Single option' }],
          multiSelect: false,
        },
      ],
    });
    expect(getText(result)).toContain('至少需要 2 个选项');
  });

  it('should return error when header > 12 chars', async () => {
    const result = await tool.execute('call-1', {
      questions: [
        {
          question: 'Test?',
          header: 'This header is way too long',
          options: [
            { label: 'A', description: 'A' },
            { label: 'B', description: 'B' },
          ],
          multiSelect: false,
        },
      ],
    });
    expect(getText(result)).toContain('header 超过 12 个字符');
  });

  it('should return error when no provider', async () => {
    resetQuestionManager();
    const manager = getQuestionManager();
    // No provider set
    expect(manager.hasProvider()).toBe(false);

    const result = await tool.execute('call-1', {
      questions: [
        {
          question: 'Which lib?',
          header: 'Lib',
          options: [
            { label: 'A', description: 'First' },
            { label: 'B', description: 'Second' },
          ],
          multiSelect: false,
        },
      ],
    });
    expect(getText(result)).toContain('headless 模式');
  });

  it('should return formatted answers from provider', async () => {
    resetQuestionManager();
    const manager = getQuestionManager();
    manager.setProvider(makeProvider({ 'Which lib?': 'date-fns' }));

    const result = await tool.execute('call-1', {
      questions: [
        {
          question: 'Which lib?',
          header: 'Lib',
          options: [
            { label: 'date-fns', description: 'Modern' },
            { label: 'dayjs', description: 'Lightweight' },
          ],
          multiSelect: false,
        },
      ],
    });

    expect(getText(result)).toContain('Which lib?');
    expect(getText(result)).toContain('date-fns');
    expect(result.details).toBeDefined();
  });

  it('should handle multi-select answers', async () => {
    resetQuestionManager();
    const manager = getQuestionManager();
    manager.setProvider(makeProvider({ 'Which features?': 'Auth, API, UI' }));

    const result = await tool.execute('call-1', {
      questions: [
        {
          question: 'Which features?',
          header: 'Features',
          options: [
            { label: 'Auth', description: 'Authentication' },
            { label: 'API', description: 'API layer' },
            { label: 'UI', description: 'User interface' },
          ],
          multiSelect: true,
        },
      ],
    });

    expect(getText(result)).toContain('Which features?');
  });

  it('should handle provider cancellation', async () => {
    resetQuestionManager();
    const manager = getQuestionManager();
    manager.setProvider({
      showQuestions: async () => {
        throw new Error('用户取消了提问');
      },
    });

    const result = await tool.execute('call-1', {
      questions: [
        {
          question: 'Cancel test?',
          header: 'Cancel',
          options: [
            { label: 'Yes', description: 'Confirm' },
            { label: 'No', description: 'Deny' },
          ],
          multiSelect: false,
        },
      ],
    });

    expect(getText(result)).toContain('提问被取消');
  });

  describe('checkPermission', () => {
    it('should return medium risk with requiresApproval false', () => {
      const tool = createAskUserQuestionTool();
      const result = tool.checkPermission?.({});
      expect(result).toBeDefined();
      expect(result?.risk).toBe('medium');
      expect(result?.requiresApproval).toBe(false);
      expect(result?.reason).toContain('AskUserQuestion');
    });
  });

  describe('background agent rejection', () => {
    it('should throw SecurityBlockedError when isBackgroundAgent is true', async () => {
      const tool = createAskUserQuestionTool();
      await expect(
        runWithToolGuardContext({ isBackgroundAgent: true }, () =>
          tool.execute('call-1', {
            questions: [
              {
                question: 'Can I ask?',
                header: 'Ask',
                options: [
                  { label: 'Yes', description: 'Yes' },
                  { label: 'No', description: 'No' },
                ],
                multiSelect: false,
              },
            ],
          })
        )
      ).rejects.toThrow(SecurityBlockedError);
    });

    it('should allow when not background agent', async () => {
      resetQuestionManager();
      const manager = getQuestionManager();
      manager.setProvider(makeProvider({ 'Can I ask?': 'Yes' }));

      const tool = createAskUserQuestionTool();
      const result = await runWithToolGuardContext({ isBackgroundAgent: false }, () =>
        tool.execute('call-1', {
          questions: [
            {
              question: 'Can I ask?',
              header: 'Ask',
              options: [
                { label: 'Yes', description: 'Yes' },
                { label: 'No', description: 'No' },
              ],
              multiSelect: false,
            },
          ],
        })
      );
      expect(getText(result)).toContain('Can I ask?');
    });
  });
});
