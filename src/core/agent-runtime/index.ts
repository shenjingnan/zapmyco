/**
 * Agent Runtime 适配层
 *
 * zapmyco 核心抽象与 pi-agent-core 之间的隔离边界。
 *
 * @module core/agent-runtime
 */

// 适配器（核心）
export { createLlmBasedAgent, createRequestFromSubTask, LlmBasedAgent } from './agent-adapter';
// 事件桥接
export {
  adaptAgentEvent,
  createEventBridgeListener,
  dispatchToEventBus,
} from './event-bridge';
export type { ToolExecuteFn, ToolRegistration } from './tool-bridge';
// 工具桥接
export {
  createToolFromCapability,
  createToolsFromCapabilities,
  toAgentTool,
  toAgentTools,
} from './tool-bridge';

// 类型定义（内部使用，不暴露 pi-agent-core 类型）
export type {
  AdaptedAgentEvent,
  AgentAdapterOptions,
  AgentRuntimeConfig,
  SubTaskExecutionContext,
  ToolExecutionMode,
} from './types';
