/**
 * AskUserQuestion 类型定义
 *
 * 定义 Agent 向用户提问所需的所有类型。
 * 参考 Claude Code 的 AskUserQuestionTool schema，适配 zapmyco 架构。
 *
 * @module core/question/types
 */

// ============ 问题定义 ============

/** 单个选项 */
export interface QuestionOption {
  /** 显示文本（1-5 个词） */
  label: string;
  /** 选项说明 */
  description: string;
  /** 可选的预览内容（markdown 文本，用于代码/配置对比） */
  preview?: string;
}

/** 单个问题 */
export interface QuestionDefinition {
  /** 完整问题文本，以问号结尾 */
  question: string;
  /** 短标签，用于 Tab 导航（最多 12 个字符） */
  header: string;
  /** 2-4 个选项 */
  options: QuestionOption[];
  /** 是否允许多选 */
  multiSelect: boolean;
}

// ============ 工具参数/结果 ============

/** AskUserQuestion 工具输入参数 */
export interface AskUserQuestionParams {
  /** 1-4 个问题 */
  questions: QuestionDefinition[];
}

/** 用户答案（单选为 string，多选为 string[]） */
export type QuestionAnswer = string | string[];

/** 答案映射：question text → answer */
export type QuestionAnswers = Record<string, QuestionAnswer>;

/** 单个问题的用户注解 */
export interface QuestionAnnotation {
  /** 所选选项的预览内容 */
  preview?: string;
  /** 用户自由文本备注 */
  notes?: string;
}

/** AskUserQuestion 工具返回结果 */
export interface AskUserQuestionResult {
  /** 原始问题列表 */
  questions: QuestionDefinition[];
  /** 用户答案 */
  answers: QuestionAnswers;
  /** 可选的注解信息 */
  annotations?: Record<string, QuestionAnnotation> | undefined;
}

// ============ Provider 接口 ============

/**
 * 问题提供者接口
 *
 * 由 TUI 层实现，注入到 QuestionManager。
 * 在 headless 模式下无 provider，自动报错。
 */
export interface QuestionProvider {
  /** 向用户展示问题并等待回答 */
  showQuestions(params: AskUserQuestionParams): Promise<AskUserQuestionResult>;
}

// ============ 内部状态 ============

/** 简单的 Deferred 模式（不引入外部依赖） */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  isSettled: boolean;
}

/** 待处理的问题请求（内部状态） */
export interface PendingQuestionRequest {
  requestId: string;
  questions: QuestionDefinition[];
  deferred: Deferred<AskUserQuestionResult>;
  createdAt: number;
}

// ============ 工具函数 ============

/** 创建 Deferred */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  let isSettled = false;

  const promise = new Promise<T>((res, rej) => {
    resolve = (value: T) => {
      if (!isSettled) {
        isSettled = true;
        res(value);
      }
    };
    reject = (error: Error) => {
      if (!isSettled) {
        isSettled = true;
        rej(error);
      }
    };
  });

  return { promise, resolve, reject, isSettled };
}
