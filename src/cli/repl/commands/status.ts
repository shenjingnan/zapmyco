/**
 * /status 命令
 *
 * 显示当前会话状态和统计信息。
 */

import type { CommandDefinition } from '../types.js';

/**
 * 创建 status 命令定义
 */
export function createStatusCommand(): CommandDefinition {
  return {
    name: 'status',
    aliases: ['st'],
    description: '查看会话状态统计',
    usage: '/status',
    handler(_args, session) {
      const stats = session.getStats();
      const lines = session.getRenderer().renderStatus(stats);
      session.appendOutput(lines);
    },
  };
}
