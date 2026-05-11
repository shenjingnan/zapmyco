/**
 * Agent Team 系统
 *
 * 提供 Agent 类型系统、团队协作和 Agent 间通信能力。
 * Phase 1 实现：类型系统基础设施。
 *
 * @module core/agent-team
 */

// 功能模块导出
export { createAgentFromType } from './agent-factory';
export {
  AgentInstanceManager,
  getAgentInstanceManager,
  resetAgentInstanceManager,
} from './agent-instance-manager';
export {
  AgentTypeRegistry,
  getAgentTypeRegistry,
  resetAgentTypeRegistry,
} from './agent-type-registry';
// 内置类型导出
export {
  BUILTIN_AGENT_TYPES,
  coderType,
  generalPurposeType,
  plannerType,
  researcherType,
  reviewerType,
} from './builtin-types';
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
