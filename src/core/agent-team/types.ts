/**
 * Agent Team 系统核心类型定义
 *
 * 定义 Agent 类型系统、实例管理、团队协作、A2A 通信的所有类型。
 *
 * @module core/agent-team
 */

import type { LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import type { Artifact, TaskError, TokenUsage } from '@/core/result/types';
import type { Capability } from '@/protocol/capability';
import type { AgentSecurityOverride } from '@/security/types';

// ============ Agent 角色 ============

/** Agent 角色 */
export type AgentRole = 'coordinator' | 'worker' | 'universal';

/** Agent 类型来源 */
export type AgentTypeSource = 'builtin' | 'project' | 'user';

// ============ 工具策略 ============

/** Agent 工具策略 */
export type AgentToolPolicy =
  | { mode: 'inherit' }
  | { mode: 'safe' }
  | { mode: 'standard' }
  | { mode: 'full' }
  | { mode: 'custom'; tools: string[]; disallowedTools?: string[] };

/** 权限模式 */
export type AgentPermissionMode = 'inherit' | 'restricted' | 'bubble' | 'yolo';

// ============ Agent 系统提示词上下文 ============

/** 系统提示词构建上下文 */
export interface AgentSystemPromptContext {
  /** 任务描述 */
  taskDescription: string;
  /** 背景上下文（来自父 Agent） */
  context?: string;
  /** 上游结果 */
  upstreamResults?: string[];
  /** 工作目录 */
  workdir: string;
  /** 记忆快照（按类型隔离） */
  memorySnapshot?: string;
  /** 注入的 Skill 内容 */
  skillContents?: string[];
}

// ============ Agent 类型定义 ============

/**
 * Agent 类型定义
 *
 * 每个 Agent 类型的差异由三个要素定义：
 * 1. 工具策略（toolPolicy）— 决定该类型能使用哪些工具
 * 2. 权限模式（permissionMode）— 决定安全框架如何对待该类型的操作
 * 3. 系统提示词（getSystemPrompt）— 决定该类型的行为模式
 *
 * 借鉴 OpenCode 的 Agent = Permission + Model + Prompt 设计。
 */
export interface AgentTypeDefinition {
  /** 类型唯一标识（如 'researcher'、'coder'、'reviewer'） */
  typeId: string;
  /** 显示名称 */
  displayName: string;
  /**
   * 何时使用的描述
   *
   * 注入到父 Agent 的 AgentTool 描述中，帮助 LLM 选择合适的子 Agent 类型。
   */
  whenToUse: string;
  /** Agent 角色 */
  role: AgentRole;
  /** 能力声明 */
  capabilities: Capability[];
  /** 工具策略 */
  toolPolicy: AgentToolPolicy;
  /** 权限模式 */
  permissionMode: AgentPermissionMode;
  /** 来源 */
  source: AgentTypeSource;
  /** 基础目录（project/user 类型时指向配置文件目录） */
  baseDir?: string;
  /** 系统提示词构建函数 */
  getSystemPrompt: (ctx: AgentSystemPromptContext) => string;
  /** 最大对话轮次 */
  maxTurns: number;
  /**
   * 最大可再 spawn 的深度
   *
   * 0 = 不能再 spawn 子 Agent
   * 1 = 可再 spawn 一层
   * 全局 maxGlobalDepth 检查在编排器中进行
   */
  maxSpawnDepth: number;
  /** 偏好的模型（可选，不设置则继承父 Agent） */
  model?: string;
  /** 颜色标识（用于 TUI 显示） */
  color?: string;
  /** 是否隐藏（不显示在 Agent 类型选择列表中） */
  hidden?: boolean;
  /** 该 Agent 类型应加载的 Skill 名称列表 */
  skills?: string[];
  /**
   * Security 配置覆盖
   *
   * 每个 Agent 类型可以有独立的安全策略（更严格或更宽松）。
   */
  securityOverride?: AgentSecurityOverride;
}

// ============ Agent 实例 ============

/** Agent 实例状态 */
export type AgentInstanceState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Agent 当前活动信息（用于 UI 实时状态栏） */
export interface AgentCurrentActivity {
  /** 当前正在执行的工具名称 */
  toolName: string;
  /** 累计工具调用次数 */
  toolUses: number;
  /** 工具参数摘要（可选） */
  args?: string;
  /** 开始时间戳 */
  startedAt: number;
}

/**
 * Agent 实例（运行时包装）
 *
 * 每个 AgentTypeDefinition 可以被实例化为多个 AgentInstance。
 * 每个实例有独立的底层 LlmBasedAgent、消息通道和生命周期状态。
 */
export interface AgentInstance {
  /** 实例唯一标识 */
  instanceId: string;
  /** 关联的 Agent 类型 ID */
  typeId: string;
  /** 在 spawn 树中的深度（0 = root coordinator） */
  depth: number;
  /** 父实例 ID（null = root） */
  parentInstanceId: string | null;
  /** 子实例 ID 列表 */
  childInstanceIds: string[];
  /** 当前状态 */
  status: AgentInstanceState;
  /** 底层 LlmBasedAgent */
  agent: LlmBasedAgent;
  /** 消息收件箱（其他 Agent 发来的 A2A 消息） */
  inbox: AgentMessage[];
  /** 任务规格 */
  task: AgentTaskSpec;
  /** 创建时间 */
  createdAt: number;
  /** 当前活动信息（实时更新，用于 UI 状态栏） */
  currentActivity?: AgentCurrentActivity;
}

// ============ 任务规格 ============

/** Agent 任务规格 */
export interface AgentTaskSpec {
  /** 任务 ID */
  taskId: string;
  /** 任务描述 */
  description: string;
  /** 期望的能力（用于类型匹配，可选） */
  requiredCapabilities?: Capability[];
  /** 运行模式 */
  mode: 'sync' | 'async';
  /** 超时（毫秒） */
  timeoutMs: number;
  /** 是否继承父级上下文（fork 模式） */
  inheritContext: boolean;
}

// ============ Agent 团队 ============

/** Agent 团队（coordinator + workers） */
export interface AgentTeam {
  /** 团队 ID */
  teamId: string;
  /** Coordinator 实例 ID */
  coordinatorId: string;
  /** Worker 实例 ID 集合 */
  workerIds: Set<string>;
  /** 团队创建时间 */
  createdAt: number;
}

// ============ Agent 间消息 ============

/** Agent 消息类型 */
export type AgentMessageType =
  | 'task_assign'
  | 'task_result'
  | 'question'
  | 'clarification'
  | 'progress'
  | 'cancel'
  | 'heartbeat';

/** Agent 间消息 */
export interface AgentMessage {
  /** 消息 ID */
  messageId: string;
  /** 发送方实例 ID */
  fromAgentId: string;
  /** 接收方实例 ID（'parent' 表示父 Agent，'coordinator' 表示根 Coordinator） */
  toAgentId: string;
  /** 消息类型 */
  type: AgentMessageType;
  /** 消息载荷 */
  payload: string;
  /** 时间戳 */
  timestamp: number;
  /** 是否需要回复 */
  requiresResponse: boolean;
  /** 关联的任务 ID（可选） */
  taskId?: string;
}

// ============ SendMessage 工具参数 ============

/** SendMessage 工具参数 */
export interface SendMessageParams {
  /** 目标 Agent 实例 ID */
  toAgentId: string;
  /** 消息内容 */
  message: string;
  /** 消息类型 */
  messageType?: 'question' | 'progress' | 'result';
}

// ============ Worker 结果 ============

/** Worker 执行结果条目 */
export interface WorkerResult {
  /** Worker 实例 ID */
  instanceId: string;
  /** Worker 类型 ID */
  typeId: string;
  /** 任务描述 */
  taskDescription: string;
  /** 执行状态 */
  status: 'success' | 'failure' | 'partial';
  /** 输出文本 */
  output: string | null;
  /** 产生的制品 */
  artifacts: Artifact[];
  /** 错误信息 */
  error?: TaskError;
  /** 执行耗时（毫秒） */
  duration: number;
  /** Token 使用 */
  tokenUsage: TokenUsage;
}

// ============ Team 执行结果 ============

/** Team 执行结果 */
export interface TeamResult {
  /** 团队 ID */
  teamId: string;
  /** 所有 worker 结果 */
  workerResults: WorkerResult[];
  /** 汇总文本（供 Coordinator 阅读） */
  summary: string;
  /** 总耗时 */
  totalDuration: number;
  /** 总 Token */
  totalTokenUsage: TokenUsage;
  /** 统计 */
  stats: { total: number; succeeded: number; failed: number };
}

// ============ AgentTool 参数 ============

/**
 * AgentTool（增强版 SpawnSubAgents）参数
 *
 * 向后兼容旧的 agents: [...] 批量参数，
 * 同时支持新的 subagent_type 单 Agent 创建。
 */
export interface AgentToolParams {
  /** 任务描述 */
  description: string;
  /**
   * Agent 类型 ID
   *
   * 不指定时使用 'general-purpose'（或 fork 模式如已启用）。
   */
  subagent_type?: string;
  /** 是否后台运行（默认 false = 同步等待） */
  run_in_background?: boolean;
  /** 是否继承父级上下文（fork 模式） */
  inherit_context?: boolean;
  /**
   * @deprecated 兼容旧版 SpawnSubAgents 的批量参数
   */
  agents?: Array<{
    id: string;
    description: string;
    allowedTools?: string[];
  }>;
  /** 可选的背景上下文 */
  context?: string;
  /** 隔离模式（默认 undefined = 无隔离） */
  isolation?: 'worktree';
}

// ============ Agent Team 配置 ============

/**
 * Agent Team 系统配置
 *
 * 追加到 ZapmycoConfig.agentTeam 中。
 */
export interface AgentTeamConfig {
  /** 是否启用 Agent Team 系统（默认 false，向后兼容） */
  enabled: boolean;
  /** 默认模式：coordinator 或 flat */
  defaultMode: 'coordinator' | 'flat';
  /** 全局最大嵌套深度（默认 2） */
  maxGlobalDepth: number;
  /** A2A 消息超时（毫秒） */
  messageTimeoutMs: number;
  /** 结果聚合最大输出字符数 */
  maxAggregateOutputChars: number;
  /** 用户定义的 Agent 类型列表 */
  agentTypes?: AgentTypeConfigEntry[];
}

/** 用户配置的 Agent 类型条目（简化版，用于配置文件） */
export interface AgentTypeConfigEntry {
  /** 类型 ID */
  typeId: string;
  /** 显示名称 */
  displayName: string;
  /** 何时使用 */
  whenToUse: string;
  /** 角色 */
  role: AgentRole;
  /** 工具模式 */
  tools: 'safe' | 'standard' | 'full' | string[];
  /** 最大嵌套深度 */
  maxSpawnDepth?: number;
  /** 最大轮次 */
  maxTurns?: number;
  /** 偏好的模型 */
  model?: string;
  /** 颜色 */
  color?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 注入的 Skill 列表 */
  skills?: string[];
  /** 权限模式 */
  permissionMode?: AgentPermissionMode;
}

// ============ 类型工具函数 ============

/**
 * Agent 默认安全工具集
 *
 * 只读和搜索工具，不含任何可能产生副作用的操作。
 * 子 Agent 默认使用此集合。
 */
export const AGENT_SAFE_TOOLS = [
  'ReadFile',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'GetCurrentTime',
  'GetWorkdirInfo',
] as const;

/**
 * Agent 标准工具集
 *
 * safe + 文件写入 + Shell 执行。
 */
export const AGENT_STANDARD_TOOLS = [
  ...AGENT_SAFE_TOOLS,
  'WriteFile',
  'EditFile',
  'Exec',
  'Process',
  'TaskManage',
  'Memory',
] as const;

/**
 * Coordinator 专用工具集
 *
 * 借鉴 Claude Code：Coordinator 只保留编排相关工具，
 * 强制专注于任务分解和结果整合。
 */
export const COORDINATOR_TOOLS = ['AgentTool', 'SendMessage', 'TaskStop'] as const;
