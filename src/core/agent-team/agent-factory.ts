/**
 * Agent 工厂
 *
 * 根据 AgentTypeDefinition 创建隔离的 LlmBasedAgent 实例。
 * 处理工具策略解析、系统提示词构建、安全配置注入。
 *
 * @module core/agent-team
 */

import { createLlmBasedAgent, type LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import type {
  AgentInstance,
  AgentSystemPromptContext,
  AgentTeamConfig,
  AgentTypeDefinition,
} from '@/core/agent-team/types';
import { AGENT_SAFE_TOOLS, AGENT_STANDARD_TOOLS } from '@/core/agent-team/types';
import { logger } from '@/infra/logger';

const log = logger.child('agent-factory');

/**
 * 创建 Agent 实例
 *
 * 根据类型定义创建一个隔离的 LlmBasedAgent，包括：
 * - 独立的 PiAgent 实例（消息历史隔离）
 * - 类型特定的工具集（根据 toolPolicy 解析）
 * - 类型特定的系统提示词
 * - Security 配置覆盖注入
 *
 * @param definition - Agent 类型定义
 * @param instance - Agent 实例（部分填充，含 depth/task 等）
 * @param parentAgent - 父 LlmBasedAgent（用于共享 Model/API Key）
 * @param availableTools - 可用的工具注册列表
 * @param config - Agent Team 系统配置
 * @returns 完全初始化的 LlmBasedAgent
 */
export function createAgentFromType(
  definition: AgentTypeDefinition,
  instance: Pick<AgentInstance, 'instanceId' | 'depth' | 'task'>,
  parentAgent: LlmBasedAgent,
  availableTools: ToolRegistration[],
  config: AgentTeamConfig
): LlmBasedAgent {
  const agent = createLlmBasedAgent({
    agentId: instance.instanceId,
    displayName: definition.displayName,
    capabilities: definition.capabilities,
    runtimeConfig: {
      enabled: true,
      toolExecution: 'sequential',
      maxTurns: definition.maxTurns,
    },
  });

  // 1. 共享父 Agent 的 Model 和 API Key
  shareParentResources(agent, parentAgent);

  // 2. 根据工具策略和深度过滤工具
  const tools = resolveTools(definition, availableTools, instance.depth, config);
  agent.registerTools(tools);

  // 3. 构建并设置系统提示词
  const systemPrompt = buildSystemPrompt(definition, instance.task.description, config);
  agent.systemPromptOverride = systemPrompt;

  log.debug('创建 Agent 实例', {
    typeId: definition.typeId,
    instanceId: instance.instanceId,
    depth: instance.depth,
    toolCount: tools.length,
  });

  return agent;
}

// ============ 工具解析 ============

/**
 * 根据 Agent 类型的工具策略和当前深度解析工具集
 */
function resolveTools(
  definition: AgentTypeDefinition,
  availableTools: ToolRegistration[],
  depth: number,
  config: AgentTeamConfig
): ToolRegistration[] {
  let whitelist: string[] | '*';

  switch (definition.toolPolicy.mode) {
    case 'inherit':
      whitelist = '*';
      break;
    case 'safe':
      whitelist = [...AGENT_SAFE_TOOLS];
      break;
    case 'standard':
      whitelist = [...AGENT_STANDARD_TOOLS];
      break;
    case 'full':
      whitelist = '*';
      break;
    case 'custom':
      whitelist = definition.toolPolicy.tools;
      break;
  }

  let tools: ToolRegistration[];

  // 递归防护：检查是否还能再 spawn
  const canSpawn = definition.maxSpawnDepth > 0 && depth < config.maxGlobalDepth;

  if (whitelist === '*') {
    // 继承全部工具
    // Coordinator 保留 AgentTool（需要 spawn workers），其他角色排除防止递归
    if (definition.role === 'coordinator') {
      tools = availableTools.filter((t) => t.id !== 'SpawnSubAgents');
    } else {
      tools = availableTools.filter((t) => t.id !== 'AgentTool' && t.id !== 'SpawnSubAgents');
    }
  } else {
    const whitelistSet = new Set(whitelist);
    // 如果该类型可以 spawn 子 Agent，将 AgentTool 加入白名单
    if (canSpawn) {
      whitelistSet.add('AgentTool');
      whitelistSet.add('SendMessage');
    }
    tools = availableTools.filter((t) => whitelistSet.has(t.id));
  }

  // 不可 spawn 的非 coordinator 角色：移除 spawn/通信工具
  if (!canSpawn && definition.role !== 'coordinator') {
    tools = tools.filter(
      (t) => t.id !== 'AgentTool' && t.id !== 'SpawnSubAgents' && t.id !== 'SendMessage'
    );
  }

  // Coordinator 工具集裁剪：只保留编排相关工具
  if (definition.role === 'coordinator') {
    const coordinatorToolIds = new Set(['AgentTool', 'SendMessage', 'TaskStop']);
    tools = tools.filter((t) => coordinatorToolIds.has(t.id));
  }

  return tools;
}

// ============ 系统提示词构建 ============

/**
 * 为 Agent 构建系统提示词
 */
function buildSystemPrompt(
  definition: AgentTypeDefinition,
  taskDescription: string,
  _config: AgentTeamConfig
): string {
  const ctx: AgentSystemPromptContext = {
    taskDescription,
    workdir: process.cwd(),
  };

  return definition.getSystemPrompt(ctx);
}

// ============ 资源共享 ============

/**
 * 共享父 Agent 的 Model 和 API Key 给子 Agent
 *
 * 优先使用 AgentLlmFacade（支持凭据池独立 Key 选择），
 * 回退到直接复制 Model + Key 闭包（向后兼容）。
 */
function shareParentResources(subAgent: LlmBasedAgent, parentAgent: LlmBasedAgent): void {
  const parentInner = parentAgent.innerAgent;

  // 方式 A：通过 AgentLlmFacade 共享（新架构）
  if (parentAgent.llmFacade) {
    subAgent.llmFacade = parentAgent.llmFacade;
    subAgent.innerAgent.state.model = parentInner.state.model;
    // biome-ignore lint/suspicious/noExplicitAny: pi-agent-core internal state does not expose getApiKey in public types
    (subAgent.innerAgent as any).getApiKey = parentAgent.llmFacade.createGetApiKeyFn();
    return;
  }

  // 方式 B：直接复制 Model + Key 闭包（向后兼容）
  subAgent.innerAgent.state.model = parentInner.state.model;

  // biome-ignore lint/suspicious/noExplicitAny: pi-agent-core internal state does not expose getApiKey in public types
  const parentGetApiKey = (parentInner as any).getApiKey as
    | ((provider: string) => string | undefined)
    | undefined;

  if (parentGetApiKey) {
    // biome-ignore lint/suspicious/noExplicitAny: pi-agent-core internal state does not expose getApiKey in public types
    (subAgent.innerAgent as any).getApiKey = parentGetApiKey;
  }
}
