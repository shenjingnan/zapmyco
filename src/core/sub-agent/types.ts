/**
 * Sub-Agent 系统类型定义
 *
 * 定义子 Agent 的创建规格、执行结果和系统配置。
 *
 * @module core/sub-agent
 */

/**
 * 子 Agent 任务规格
 *
 * 父 LLM 通过 spawn_subagents 工具传入的任务定义。
 */
export interface SubAgentSpec {
  /** 子任务唯一标识（父 LLM 自行分配，如 "search-libs"） */
  id: string;
  /** 任务描述（纯文本，作为子 Agent 的 prompt） */
  description: string;
  /**
   * 允许的工具 ID 白名单
   *
   * - 为空或不传时使用默认安全工具集（read_file, glob, grep, web_fetch, web_search 等）
   * - 设为 ['*'] 表示继承父 Agent 的全部工具（危险，不推荐）
   */
  allowedTools?: string[];
}

/**
 * spawn_subagents 工具入参
 */
export interface SpawnSubAgentsParams {
  /** 要并行创建的子 Agent 列表 */
  agents: SubAgentSpec[];
  /**
   * 上下文摘要
   *
   * 父 Agent 对当前任务的背景总结，注入到每个子 Agent 的系统提示中。
   */
  context?: string;
}

/**
 * 单个子 Agent 的执行结果
 */
export interface SubAgentResultEntry {
  /** 对应的 spec ID */
  specId: string;
  /** 执行状态 */
  status: 'success' | 'failure';
  /** 输出文本（已截断到 maxOutputChars） */
  output: string | null;
  /** 错误信息（status === 'failure' 时有值） */
  error?: string;
  /** 执行耗时（毫秒） */
  duration: number;
}

/**
 * spawn_subagents 工具返回
 *
 * 作为 tool result 返回给父 LLM，包含结构化结果和人类可读的汇总文本。
 */
export interface SubAgentResults {
  /** 总任务数 */
  total: number;
  /** 成功数 */
  succeeded: number;
  /** 失败数 */
  failed: number;
  /** 各子 Agent 结果（按输入顺序） */
  results: SubAgentResultEntry[];
  /** 汇总文本（供父 LLM 直接阅读） */
  summary: string;
}

// SubAgentConfig 定义在 @/config/types 中，此处不再重复导出
