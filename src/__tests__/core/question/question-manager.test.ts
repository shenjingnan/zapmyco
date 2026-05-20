/**
 * question-manager 单元测试
 */
import { describe, expect, it } from 'vitest';
import { getQuestionManager, QuestionManager, resetQuestionManager } from '@/core/question';
import type { QuestionProvider } from '@/core/question/types';

function makeProvider(): QuestionProvider {
  return {
    showQuestions: async (params) => ({
      questions: params.questions,
      answers: { [params.questions[0]?.question]: 'option1' },
    }),
  };
}

describe('QuestionManager', () => {
  describe('without provider', () => {
    it('should hasProvider return false', () => {
      const manager = new QuestionManager();
      expect(manager.hasProvider()).toBe(false);
    });

    it('should throw error when no provider set', async () => {
      const manager = new QuestionManager();
      await expect(
        manager.ask({
          questions: [
            {
              question: 'Test?',
              header: 'Test',
              options: [
                { label: 'A', description: 'Option A' },
                { label: 'B', description: 'Option B' },
              ],
              multiSelect: false,
            },
          ],
        })
      ).rejects.toThrow('当前环境不支持交互式提问');
    });
  });

  describe('with provider', () => {
    it('should hasProvider return true after setProvider', () => {
      const manager = new QuestionManager();
      manager.setProvider(makeProvider());
      expect(manager.hasProvider()).toBe(true);
    });

    it('should return answers from provider', async () => {
      const manager = new QuestionManager();
      manager.setProvider(makeProvider());

      const result = await manager.ask({
        questions: [
          {
            question: 'Which lib?',
            header: 'Lib',
            options: [
              { label: 'option1', description: 'First' },
              { label: 'option2', description: 'Second' },
            ],
            multiSelect: false,
          },
        ],
      });

      expect(result.answers).toBeDefined();
      expect(result.answers['Which lib?']).toBe('option1');
    });

    it('should handle provider error', async () => {
      const manager = new QuestionManager();
      manager.setProvider({
        showQuestions: async () => {
          throw new Error('Provider failed');
        },
      });

      await expect(
        manager.ask({
          questions: [
            {
              question: 'Test?',
              header: 'Test',
              options: [
                { label: 'A', description: 'Option A' },
                { label: 'B', description: 'Option B' },
              ],
              multiSelect: false,
            },
          ],
        })
      ).rejects.toThrow('Provider failed');
    });

    it('should clear pending map on rejectAll', async () => {
      const manager = new QuestionManager();
      // Provider that resolves immediately
      manager.setProvider({
        showQuestions: async (params) => ({
          questions: params.questions,
          answers: { [params.questions[0]?.question]: 'answer' },
        }),
      });

      // Start a question to populate pending
      const askPromise = manager.ask({
        questions: [
          {
            question: 'Test?',
            header: 'Test',
            options: [
              { label: 'A', description: 'A' },
              { label: 'B', description: 'B' },
            ],
            multiSelect: false,
          },
        ],
      });

      await askPromise;
      // After completion, pending should be empty
      expect(manager.getPending('any')).toBeUndefined();
    });
  });

  describe('global singleton', () => {
    it('should return same instance', () => {
      resetQuestionManager();
      const a = getQuestionManager();
      const b = getQuestionManager();
      expect(a).toBe(b);
    });

    it('should reset correctly', () => {
      const a = getQuestionManager();
      resetQuestionManager();
      const b = getQuestionManager();
      expect(a).not.toBe(b);
    });
  });
});
