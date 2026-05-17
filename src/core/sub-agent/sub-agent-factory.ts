/**
 * Sub-Agent 工厂
 *
 * 创建隔离的 LlmBasedAgent 实例用于执行子任务。
 *
 * @module core/sub-agent
 */

import type { SubAgentConfig } from '@/config/types';
import { createLlmBasedAgent, type LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import type { ToolGuard } from '@/security/tool-guard';
import type { SubAgentSpec } from './types';

// ============ 默认安全工具白名单 ============

/**
 * 子 Agent 默认安全工具集
 *
 * 只包含只读和搜索工具，排除所有可能产生副作用的工具：
 * - WriteFile / EditFile → 可能破坏工作区
 * - Exec / Process → 可能执行危险命令
 * - Memory → 子 Agent 不应跨会话记忆
 * - Skill → 防止递归技能调用
 * - TaskManage → 子 Agent 只执行单一任务，不需要规划
 * - SpawnSubAgents → 防止递归爆炸
 */
export const DEFAULT_SAFE_TOOLS: string[] = [
  'ReadFile',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'GetCurrentTime',
  'GetWorkdirInfo',
];

// ============ 子 Agent 实例类型 ============

/**
 * 子 Agent 实例包装
 */
export interface SubAgentInstance {
  /** 内部 LlmBasedAgent */
  agent: LlmBasedAgent;
  /** 关联的 spec */
  spec: SubAgentSpec;
  /** 创建时间 */
  createdAt: number;
}

// ============ 工厂函数 ============

/**
 * 创建子 Agent 实例
 *
 * 基于父 Agent 的配置创建一个隔离的 LlmBasedAgent：
 * - 独立的 PiAgent 实例（消息历史隔离）
 * - 共享父 Agent 的 Model 和 API Key
 * - 仅注册白名单工具
 * - 自定义的 isolated 系统提示词
 *
 * @param spec - 子任务规格
 * @param parentAgent - 父 LlmBasedAgent（用于共享 Model/API Key）
 * @param availableTools - 父 Agent 的所有已注册工具（用于白名单过滤）
 * @param config - Sub-Agent 系统配置
 * @param context - 可选的背景摘要
 * @returns 子 Agent 实例
 */
export function createSubAgent(
  spec: SubAgentSpec,
  parentAgent: LlmBasedAgent,
  availableTools: ToolRegistration[],
  config: SubAgentConfig,
  _context?: string,
  toolGuard?: ToolGuard
): SubAgentInstance {
  // 1. 解析 thinkingLevel：'inherit' 时读取父 Agent 的配置
  const thinkingLevel = resolveSubAgentThinkingLevel(config.thinkingLevel, parentAgent);

  // 2. 创建隔离的 LlmBasedAgent
  const subAgent = createLlmBasedAgent({
    agentId: `sub-${spec.id}-${Date.now()}`,
    displayName: `子助手 (${spec.id})`,
    capabilities: [
      {
        id: 'sub-agent',
        name: '子任务执行',
        description: '执行父 Agent 分配的独立子任务',
        category: 'code-analysis',
      },
    ],
    runtimeConfig: {
      enabled: true,
      toolExecution: 'sequential',
      maxTurns: config.maxTurns,
      thinkingLevel,
    },
  });

  // 2. 共享父 Agent 的 Model 和 API Key
  shareParentResources(subAgent, parentAgent);

  // 3. 解析工具白名单并注册工具（如有 ToolGuard 则包装）
  const whitelist = resolveToolWhitelist(spec, config);
  const filteredTools = filterTools(availableTools, whitelist);
  const guardedTools = toolGuard ? filteredTools.map((t) => toolGuard.wrap(t)) : filteredTools;
  subAgent.registerTools(guardedTools);

  // 4. 注入 isolated 系统提示词（在 execute 时通过 buildSystemPrompt 生效）
  //    注意：LlmBasedAgent.buildSystemPrompt 是 private，我们通过设置内存快照来注入
  //    实际上子 Agent 调用 execute() 时会走自己的 buildSystemPrompt，所以需要另一种方式。
  //    我们将在 SubAgentManager 中通过直接设置 innerAgent.state.systemPrompt 来实现。

  return {
    agent: subAgent,
    spec,
    createdAt: Date.now(),
  };
}

/**
 * 为子 Agent 构建 isolated 系统提示词
 *
 * 简洁、任务导向的提示词，不包含父 Agent 的记忆、技能等上下文。
 */
export function buildSubAgentSystemPrompt(spec: SubAgentSpec, context?: string): string {
  const parts: string[] = [
    '你是一个专注于单一任务的 AI 子助手。',
    '你被父 Agent 派来执行以下独立任务。',
    '请专注于完成你的任务，不要尝试执行任务范围之外的操作。',
    '完成你的任务后直接返回结果，不要继续探索或发起新的任务。',
    '',
    '## 你的任务',
    spec.description,
  ];

  if (context) {
    parts.push('', '## 背景上下文（来自父 Agent）', context);
  }

  parts.push(
    '',
    '## 工作规则',
    '- 只执行分配给你的任务，严格遵守任务范围',
    '- 不要试图与其他 Agent 协调或通信',
    '- 不要在完成主任务后主动探索其他方向',
    '- 工作目录：' + process.cwd(),
    '- 完成后直接输出你的结论，不要等待进一步指令'
  );

  return parts.join('\n');
}

// ============ Thinking 级别解析 ============

/**
 * 解析子 Agent 的 thinkingLevel
 *
 * 处理 'inherit' 值：从父 Agent 读取当前 thinkingLevel。
 * 其他值直接透传（包括 'off' 和具体级别）。
 */
function resolveSubAgentThinkingLevel(
  level: string | undefined,
  parentAgent: LlmBasedAgent
): string {
  if (level === 'inherit') {
    const parentLevel = parentAgent.innerAgent.state.thinkingLevel;
    // 父 Agent 可能未设置 thinkingLevel（undefined），此时默认 'medium'
    return parentLevel ?? 'medium';
  }
  // 'off' / 'minimal' / 'low' / 'medium' / 'high' / 'xhigh' / undefined → 透传给 DEFAULT_RUNTIME_CONFIG
  return level ?? 'off';
}

// ============ 内部辅助函数 ============

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
    // 子 Agent 默认使用父 Agent 的模型
    subAgent.innerAgent.state.model = parentInner.state.model;
    // 但通过 facade 获取 Key（支持凭据池轮转）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (subAgent.innerAgent as any).getApiKey = parentAgent.llmFacade.createGetApiKeyFn();
    return;
  }

  // 方式 B：直接复制 Model + Key 闭包（向后兼容）
  subAgent.innerAgent.state.model = parentInner.state.model;

  // 共享 API Key 解析函数
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parentGetApiKey = (parentInner as any).getApiKey as
    | ((provider: string) => string | undefined)
    | undefined;

  if (parentGetApiKey) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (subAgent.innerAgent as any).getApiKey = parentGetApiKey;
  }
}

/**
 * 解析工具白名单
 *
 * 优先级：
 * 1. spec.allowedTools = ['*'] → 全部工具
 * 2. spec.allowedTools = [...] → 指定工具
 * 3. spec.allowedTools 未指定 → DEFAULT_SAFE_TOOLS
 */
function resolveToolWhitelist(spec: SubAgentSpec, _config: SubAgentConfig): string[] | '*' {
  if (spec.allowedTools && spec.allowedTools.length > 0) {
    if (spec.allowedTools.includes('*')) {
      return '*';
    }
    return spec.allowedTools;
  }
  return DEFAULT_SAFE_TOOLS;
}

/**
 * 根据白名单过滤工具注册列表
 */
function filterTools(
  availableTools: ToolRegistration[],
  whitelist: string[] | '*'
): ToolRegistration[] {
  if (whitelist === '*') {
    // 全部工具，但排除 spawn_subagents（防止递归）
    return availableTools.filter((t) => t.id !== 'SpawnSubAgents');
  }

  const whitelistSet = new Set(whitelist);
  return availableTools.filter((t) => whitelistSet.has(t.id));
}
