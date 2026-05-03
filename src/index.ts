/**
 * zapmyco - AI 原生并行任务编排系统
 *
 * 公共 API 导出入口。
 *
 * @packageDocumentation
 */

// __VERSION__ 由 tsdown 构建时从 package.json 注入
import { __VERSION__ } from '@/infra/constants';

/** 当前版本号 */
export const VERSION: string = __VERSION__;

/** 应用名称 */
export const APP_NAME = 'zapmyco';

// ============ Protocol 层导出（核心契约） ============

export type {
  AgentExecuteOptions,
  AgentExecuteRequest,
  AgentHealthStatus,
  AgentRegistration,
  AgentRegistrationStatus,
  AgentStatus,
  Capability,
  CapabilityCategory,
  IAgent,
  IStreamingAgent,
} from '@/protocol/agent';

// ============ Core 类型导出 ============

export type {
  ProgressEvent,
  ProgressEventType,
  ProgressPayload,
} from '@/core/aggregator/types';
export type {
  Goal,
  GoalConstraints,
  GoalType,
  ProjectContext,
} from '@/core/intent/types';
export type {
  Artifact,
  ArtifactType,
  FinalResult,
  TaskError,
  TaskResult,
  TokenUsage,
} from '@/core/result/types';
export type {
  SubTask,
  TaskGraph,
  TaskStatus,
} from '@/core/task/types';

// ============ Skill 系统导出 ============

export type {
  Skill,
  SkillConfigEntry,
  SkillEntry,
  SkillFrontmatter,
  SkillLoadConfig,
  SkillSnapshot,
  SkillSource,
} from '@/core/skill';
export {
  buildSkillSnapshot,
  loadSkills,
  parseFrontmatter,
  syncBundledSkills,
} from '@/core/skill';

// ============ Agent Runtime 导出（pi-agent-core 集成层） ============

export type {
  AdaptedAgentEvent,
  AgentAdapterOptions,
  AgentRuntimeConfig,
  ToolExecutionMode,
  ToolRegistration,
} from '@/core/agent-runtime';
export {
  adaptAgentEvent,
  createEventBridgeListener,
  createLlmBasedAgent,
  createRequestFromSubTask,
  createToolFromCapability,
  createToolsFromCapabilities,
  dispatchToEventBus,
  LlmBasedAgent,
  toAgentTool,
  toAgentTools,
} from '@/core/agent-runtime';

// ============ LLM 层导出 ============

export { CostTracker, costTracker } from '@/llm/cost-tracker';
export type { ILlmProvider } from '@/llm/provider';
export type {
  ChatMessage,
  ChatRole,
  LlmCallOptions,
  LlmResponse,
  StructuredOutputSchema,
} from '@/llm/types';

// ============ Config 层导出 ============

export { DEFAULT_CONFIG } from '@/config/defaults';
export { loadConfig } from '@/config/loader';
export type { SkillConfig, ZapmycoConfig } from '@/config/types';

// ============ Infra 层导出 ============

export {
  AgentError,
  DecomposeError,
  IntentError,
  LlmError,
  SchedulerError,
  ZapmycoError,
  ZapmycoErrorCode,
} from '@/infra/errors';
export type { EventMap } from '@/infra/event-bus';
export { eventBus } from '@/infra/event-bus';
export type { LogEntry, LogLevel } from '@/infra/logger';
export { Logger, logger } from '@/infra/logger';

// 默认导出
export default {
  VERSION,
  APP_NAME,
};
