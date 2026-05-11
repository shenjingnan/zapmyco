/**
 * Agent Team 系统
 *
 * 提供 Agent 类型系统、团队协作和 Agent 间通信能力。
 * Phase 1: 类型系统基础设施。
 * Phase 2: 编排器升级（Coordinator 模式）。
 * Phase 3: 用户自定义 Agent 类型、Agent Memory、自动生成。
 *
 * @module core/agent-team
 */

// 功能模块导出
export { createAgentFromType } from './agent-factory';
export type { AgentGeneratorConfig, AgentGeneratorResult } from './agent-generator';
// Phase 3: Agent 生成器
export { generateAgentType, generateAgentTypes } from './agent-generator';
export {
  AgentInstanceManager,
  getAgentInstanceManager,
  resetAgentInstanceManager,
} from './agent-instance-manager';
// Phase 3: Agent 类型记忆
export {
  appendAgentMemory,
  clearAgentMemory,
  freezeAgentMemorySnapshots,
  getAgentMemorySnapshot,
  getMemoryFilePath,
  initAgentMemory,
  readAgentMemory,
  resetMemorySnapshots,
} from './agent-memory';
export type { MessageCallback } from './agent-message-bus';
// Agent 间通信
export {
  AgentMessageBus,
  getAgentMessageBus,
  resetAgentMessageBus,
} from './agent-message-bus';
export type { SpawnWorkerOptions, WorkerSpec } from './agent-orchestrator';
// 编排器
export { AgentOrchestrator } from './agent-orchestrator';
// 结果聚合
export { aggregateResults, buildTeamSummary } from './agent-result-aggregator';
export {
  AgentTypeRegistry,
  getAgentTypeRegistry,
  resetAgentTypeRegistry,
} from './agent-type-registry';
// 内置类型导出
export {
  BUILTIN_AGENT_TYPES,
  coderType,
  coordinatorType,
  generalPurposeType,
  plannerType,
  researcherType,
  reviewerType,
} from './builtin-types';
export type { ParseResult } from './markdown-agent-parser';
// Phase 3: 用户自定义 Agent 类型
export { parseAgentMarkdown, parseAgentMarkdownBatch } from './markdown-agent-parser';
// 类型导出
export type {
  AgentInstance,
  AgentInstanceState,
  AgentMessage,
  AgentMessageType,
  AgentPermissionMode,
  AgentRole,
  AgentSystemPromptContext,
  AgentTaskSpec,
  AgentTeam,
  AgentTeamConfig,
  AgentToolParams,
  AgentToolPolicy,
  AgentTypeConfigEntry,
  AgentTypeDefinition,
  AgentTypeSource,
  SendMessageParams,
  TeamResult,
  WorkerResult,
} from './types';
export {
  AGENT_SAFE_TOOLS,
  AGENT_STANDARD_TOOLS,
  COORDINATOR_TOOLS,
} from './types';
export type { LoadResult } from './user-agent-loader';
// Phase 3: Agent 加载器
export {
  getProjectAgentsDir,
  getUserAgentsDir,
  loadAllAgents,
  loadProjectAgents,
  loadUserAgents,
  reloadAgents,
} from './user-agent-loader';
