/**
 * 上下文压缩模块类型定义
 *
 * @module core/context
 */

// ============ Token 追踪 ============

/** Token 用量快照 */
export interface TokenUsageSnapshot {
  /** 最后一次 API 调用返回的 input tokens */
  inputTokens: number;
  /** 最后一次 API 调用返回的 output tokens */
  outputTokens: number;
  /** 累积总 tokens（input + output，不含 cache） */
  totalTokens: number;
  /** 估算的缓存读取 tokens */
  cacheReadTokens: number;
  /** 估算的缓存写入 tokens */
  cacheWriteTokens: number;
  /** 当前消息列表的长度 */
  messageCount: number;
  /** 时间戳 */
  timestamp: number;
}

// ============ 上下文窗口 ============

/** 上下文窗口信息 */
export interface ContextWindowInfo {
  /** 模型的总上下文窗口大小（tokens） */
  contextWindow: number;
  /** 预留的输出空间（tokens） */
  outputReserve: number;
  /** 有效上下文窗口 = contextWindow - outputReserve */
  effectiveWindow: number;
  /** 模型 ID */
  modelId: string;
  /** 提供商名称 */
  provider: string;
}

// ============ 压缩配置 ============

/** 压缩配置 */
export interface CompactionConfig {
  /** 是否启用自动压缩（默认 true） */
  enabled: boolean;
  /** 是否启用自动触发（默认 true） */
  autoTrigger: boolean;
  /** 触发压缩的阈值百分比（0-1，默认 0.70） */
  thresholdPercent: number;
  /** 摘要模型标识（如 anthropic/claude-haiku-4-5-20251001），不设置则使用默认模型 */
  summaryModel?: string;
  /** 尾部保护消息数（默认 20） */
  protectLastMessages: number;
  /** 尾部 token 预算（默认 min(8000, window * 0.25)） */
  preserveRecentTokens: number;
  /** 是否启用反抖保护（默认 true） */
  antiThrashEnabled: boolean;
  /** 是否通知用户压缩状态（默认 true） */
  notifyUser: boolean;
}

/** 默认压缩配置 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  autoTrigger: true,
  thresholdPercent: 0.7,
  protectLastMessages: 20,
  preserveRecentTokens: 8000,
  antiThrashEnabled: true,
  notifyUser: true,
};

// ============ 压缩结果 ============

/** 压缩结果 */
export interface CompactionResult {
  /** 压缩前消息数 */
  beforeMessageCount: number;
  /** 压缩后消息数 */
  afterMessageCount: number;
  /** 压缩前估算 tokens */
  beforeEstimatedTokens: number;
  /** 压缩后估算 tokens */
  afterEstimatedTokens: number;
  /** 节省的 token 比例 */
  savingsRatio: number;
  /** 压缩是否成功 */
  success: boolean;
  /** 压缩耗时（毫秒） */
  durationMs: number;
  /** 错误信息（仅失败时） */
  error?: string;
}

// ============ 工具剪枝配置 ============

/** 工具输出剪枝配置 */
export interface ToolPruningConfig {
  /** 是否启用剪枝（默认 true） */
  enabled: boolean;
  /** 保护最后 N 条消息（默认 10） */
  protectLastMessages: number;
  /** 摘要最大长度（字符数，默认 200） */
  maxSummaryLength: number;
}

/** 默认剪枝配置 */
export const DEFAULT_TOOL_PRUNING_CONFIG: ToolPruningConfig = {
  enabled: true,
  protectLastMessages: 10,
  maxSummaryLength: 200,
};

// ============ 摘要消息类型 ============

/**
 * 自定义摘要消息类型
 *
 * 通过 declaration merging 扩展 pi-agent-core 的 CustomAgentMessages
 */
export interface SummaryMessage {
  role: 'summary';
  text: string;
  timestamp: number;
}

// ============ 模块级声明合并 ============

declare module '@mariozechner/pi-agent-core' {
  interface CustomAgentMessages {
    summary: SummaryMessage;
  }
}
