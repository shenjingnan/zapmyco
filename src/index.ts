/**
 * zapmyco - AI 原生并行任务编排系统
 *
 * 公共 API 导出入口。
 *
 * @packageDocumentation
 */

// __VERSION__ 由 tsdown 构建时从 package.json 注入
import { __VERSION__ } from './infra/constants.js';

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
} from './protocol/agent.js';

// ============ Core 类型导出 ============

export type {
  ProgressEvent,
  ProgressEventType,
  ProgressPayload,
} from './core/aggregator/types.js';
export type {
  Goal,
  GoalConstraints,
  GoalType,
  ProjectContext,
} from './core/intent/types.js';
export type {
  Artifact,
  ArtifactType,
  FinalResult,
  TaskError,
  TaskResult,
  TokenUsage,
} from './core/result/types.js';
export type {
  SubTask,
  TaskGraph,
  TaskStatus,
} from './core/task/types.js';

// ============ LLM 层导出 ============

export { CostTracker, costTracker } from './llm/cost-tracker.js';
export type { ILlmProvider } from './llm/provider.js';
export type {
  ChatMessage,
  ChatRole,
  LlmCallOptions,
  LlmResponse,
  StructuredOutputSchema,
} from './llm/types.js';

// ============ Config 层导出 ============

export { DEFAULT_CONFIG } from './config/defaults.js';
export { loadConfig } from './config/loader.js';
export type { ZapmycoConfig } from './config/types.js';

// ============ Infra 层导出 ============

export {
  AgentError,
  DecomposeError,
  IntentError,
  LlmError,
  SchedulerError,
  ZapmycoError,
  ZapmycoErrorCode,
} from './infra/errors.js';
export type { EventMap } from './infra/event-bus.js';
export { eventBus } from './infra/event-bus.js';
export type { LogEntry, LogLevel } from './infra/logger.js';
export { Logger, logger } from './infra/logger.js';

// 默认导出
export default {
  VERSION,
  APP_NAME,
};
