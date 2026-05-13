/**
 * /agents 命令（Phase 4 增强版）
 *
 * 连接到 AgentTypeRegistry + AgentInstanceManager，展示：
 * - /agents          → 概览（类型 + 运行中实例）
 * - /agents types    → Agent 类型列表
 * - /agents instances → Agent 实例树
 * - /agents team     → 团队状态统计 + 消息摘要
 *
 * @module cli/repl/commands
 */

import {
  formatAgentMessageSummary,
  formatAgentStatusStats,
} from '@/cli/repl/components/agent-status-panel';
import {
  formatAgentInstanceTree,
  formatAgentOverview,
  formatAgentTypes,
} from '@/cli/repl/components/agent-team-view';
import type { CommandDefinition } from '@/cli/repl/types';
import { getAgentInstanceManager } from '@/core/agent-team/agent-instance-manager';
import { getAgentTypeRegistry } from '@/core/agent-team/agent-type-registry';
import type { AgentMessage } from '@/core/agent-team/types';

/**
 * 创建增强版 agents 命令
 */
export function createAgentsCommand(): CommandDefinition {
  return {
    name: 'agents',
    aliases: [],
    description: 'Agent 团队管理：查看类型、实例、团队状态',
    usage: '/agents [types | instances | team]',
    handler(args, session) {
      const registry = getAgentTypeRegistry();
      const instanceManager = getAgentInstanceManager();

      const subCommand = args[0] ?? 'overview';

      switch (subCommand) {
        case 'types':
        case 'type':
        case 't': {
          const types = registry.listAll();
          const lines = formatAgentTypes(types, { color: session.replOptions.color });
          session.appendOutput(lines);
          break;
        }

        case 'instances':
        case 'instance':
        case 'i': {
          const instances = instanceManager.listAll();
          const lines = formatAgentInstanceTree(instances, { color: session.replOptions.color });
          session.appendOutput(lines);
          break;
        }

        case 'team':
        case 'status':
        case 's': {
          const instances = instanceManager.listAll();
          const lines = [
            ...formatAgentStatusStats(instances, { color: session.replOptions.color }),
            ...formatAgentMessageSummary(
              instances,
              (instanceId) => getInboxMessages(instanceId, instanceManager),
              { color: session.replOptions.color }
            ),
          ];
          session.appendOutput(lines);
          break;
        }

        default: {
          // 概览：类型一览 + 实例统计
          const types = registry.listAll();
          const instances = instanceManager.listAll();
          const lines = formatAgentOverview(types, instances, {
            color: session.replOptions.color,
          });
          session.appendOutput(lines);
          break;
        }
      }
    },
  };
}

/**
 * 从 InstanceManager 获取指定实例的 inbox 消息
 */
function getInboxMessages(
  instanceId: string,
  instanceManager: ReturnType<typeof getAgentInstanceManager>
): AgentMessage[] {
  try {
    const instance = instanceManager.get(instanceId);
    return (instance?.inbox as AgentMessage[]) ?? [];
  } catch {
    return [];
  }
}
