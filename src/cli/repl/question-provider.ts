/**
 * TUI 问题提供者
 *
 * 桥接 QuestionManager 与 pi-tui UI 层。
 * 由 session.ts 在初始化时创建并注入 QuestionManager。
 *
 * @module cli/repl/question-provider
 */

import type { TUI } from '@mariozechner/pi-tui';
import { showAskUserQuestionDialog } from '@/cli/repl/components/ask-user-question';
import type {
  AskUserQuestionParams,
  AskUserQuestionResult,
  QuestionProvider,
} from '@/core/question/types';

/**
 * 创建基于 TUI 的问题提供者
 *
 * @param tui - TUI 实例
 * @returns QuestionProvider 实现
 */
export function createTuiQuestionProvider(tui: TUI): QuestionProvider {
  return {
    async showQuestions(params: AskUserQuestionParams): Promise<AskUserQuestionResult> {
      return showAskUserQuestionDialog(tui, params);
    },
  };
}
