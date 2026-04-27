/**
 * 意图理解引擎类型定义
 *
 * 将用户的自然语言输入转化为结构化的 Goal 对象。
 */

/** 用户目标的类型 */
export type GoalType =
  | 'code-review' // 代码审查
  | 'security-audit' // 安全审计
  | 'bug-fix' // Bug 修复
  | 'feature-dev' // 功能开发
  | 'refactor' // 重构
  | 'test-generation' // 测试生成
  | 'doc-generation' // 文档生成
  | 'research' // 信息搜集/研究
  | 'planning' // 规划/安排
  | 'data-analysis' // 数据分析
  | 'chat' // 对话/创意
  | 'generic'; // 通用

/** 项目上下文（自动收集） */
export interface ProjectContext {
  /** 项目根目录路径 */
  rootPath: string;
  /** 包管理器类型 */
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  /** 检测到的框架/技术栈 */
  techStack: string[];
  /** git 分支信息 */
  gitBranch?: string;
  /** 是否有未提交的更改 */
  hasUncommittedChanges?: boolean;
}

/** 目标约束条件 */
export interface GoalConstraints {
  /** 最大并行度（覆盖全局配置） */
  maxParallelism?: number;
  /** 是否允许修改文件 */
  allowFileModification?: boolean;
  /** 是否需要确认后执行 */
  requireConfirmation?: boolean;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * 结构化目标
 *
 * 意图理解引擎的输出，是整个编排管线的输入。
 */
export interface Goal {
  /** 目标唯一 ID */
  id: string;
  /** 目标类型 */
  type: GoalType;
  /** 目标描述（由引擎提炼） */
  description: string;
  /** 原始用户输入 */
  rawInput: string;
  /** 项目上下文（自动收集） */
  context: ProjectContext;
  /** 约束条件 */
  constraints: GoalConstraints;
  /** 引擎置信度 (0-1) */
  confidence: number;
}
