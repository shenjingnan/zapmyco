/**
 * 上下文压缩模块
 *
 * 提供 Token 追踪、上下文窗口感知、工具输出剪枝、
 * 自动压缩和错误恢复能力。
 *
 * @module core/context
 */

export { buildCompactionPrompt, COMPACTION_SUMMARY_TEMPLATE } from './compaction-prompt';
// 自动压缩
export { Compactor } from './compactor';
// 上下文窗口
export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_OUTPUT_RESERVE,
  getEffectiveContextWindow,
  getKnownContextWindow,
  getUsagePercent,
  resolveContextWindow,
  shouldTriggerCompaction,
} from './context-window';
// 错误恢复
export { ContextErrorRecovery, isContextOverflowError } from './error-recovery';
// Token 追踪
export { estimateMessagesTokens, roughTokenEstimate, TokenTracker } from './token-tracker';
// 工具输出剪枝
export { ToolResultPruner } from './tool-result-pruner';
// 类型
export type {
  CompactionConfig,
  CompactionResult,
  ContextWindowInfo,
  SummaryMessage,
  TokenUsageSnapshot,
  ToolPruningConfig,
} from './types';
export { DEFAULT_COMPACTION_CONFIG, DEFAULT_TOOL_PRUNING_CONFIG } from './types';
