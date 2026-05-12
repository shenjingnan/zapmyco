/**
 * AskUserQuestion 核心模块
 *
 * @module core/question
 */

export { getQuestionManager, QuestionManager, resetQuestionManager } from './question-manager';
export type {
  AskUserQuestionParams,
  AskUserQuestionResult,
  Deferred,
  PendingQuestionRequest,
  QuestionAnnotation,
  QuestionAnswer,
  QuestionAnswers,
  QuestionDefinition,
  QuestionOption,
  QuestionProvider,
} from './types';
export { createDeferred } from './types';
