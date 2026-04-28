/**
 * /agents 命令
 *
 * 列出所有已注册的 Agent 及其状态。
 */

import type { AgentRegistration } from '../../../protocol/capability.js';
import type { CommandDefinition } from '../types.js';

/**
 * 创建 agents 命令定义
 */
export function createAgentsCommand(): CommandDefinition {
  return {
    name: 'agents',
    aliases: ['ag'],
    description: '列出已注册 Agent 及其状态',
    usage: '/agents',
    handler(_args, session) {
      const agents = buildAgentList(session.config);
      const lines = session.getRenderer().renderAgents(agents);
      session.appendOutput(lines);
    },
  };
}

/**
 * 从配置构建 AgentRegistration 列表
 *
 * 当前阶段：引擎尚未完全实现，从配置中的 agents 列表构造基本信息。
 * 未来：从 Agent 注册中心获取实时状态。
 */
function buildAgentList(config: import('../types.js').ReplSession['config']): AgentRegistration[] {
  return config.agents
    .filter((agent) => agent.enabled)
    .map((agent) => {
      const result: AgentRegistration = {
        agentId: agent.id,
        displayName: agent.id,
        capabilities: [],
        status: 'online' as AgentRegistration['status'],
        currentLoad: 0,
        maxConcurrency: 3,
      };
      if (agent.endpoint !== undefined) {
        result.endpoint = agent.endpoint;
      }
      return result;
    });
}
