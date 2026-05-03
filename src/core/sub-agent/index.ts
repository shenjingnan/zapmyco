/**
 * Sub-Agent 系统
 *
 * 提供并行子 Agent 调度能力，允许父 Agent 将独立子任务
 * 派发给隔离的子 Agent 并行执行。
 *
 * @module core/sub-agent
 */

export type { SubAgentInstance } from './sub-agent-factory';
export { buildSubAgentSystemPrompt, createSubAgent, DEFAULT_SAFE_TOOLS } from './sub-agent-factory';
export { SubAgentManager } from './sub-agent-manager';
export type {
  SpawnSubAgentsParams,
  SubAgentResultEntry,
  SubAgentResults,
  SubAgentSpec,
} from './types';
