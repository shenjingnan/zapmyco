/**
 * /clear 命令
 *
 * 清空会话上下文，重置 Agent 状态。
 * 效果等价于"新开一个会话"——保留配置、记忆、持久化任务和定时任务。
 */

import type { CommandDefinition } from '@/cli/repl/types';

/**
 * 创建 clear 命令定义
 */
export function createClearCommand(): CommandDefinition {
  return {
    name: 'clear',
    aliases: ['reset', 'new'],
    description: '清空会话上下文，重置 Agent 状态',
    usage: '/clear',
    handler(_args, session) {
      // 清空 Agent 会话上下文（消息、统计、缓存等）
      session.clearAgentContext();

      // 重置输入解析器的多行缓冲
      const parser = session.getInputParser() as { reset(): void };
      parser.reset();
    },
  };
}
