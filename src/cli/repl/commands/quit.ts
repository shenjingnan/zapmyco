/**
 * /quit 命令
 *
 * 关闭 REPL 并退出进程。
 */

import type { CommandDefinition } from '../types.js';

/**
 * 创建 quit 命令定义
 */
export function createQuitCommand(): CommandDefinition {
  return {
    name: 'quit',
    aliases: ['exit', 'q', 'x'],
    description: '退出 REPL',
    usage: '/quit',
    async handler(_args, session) {
      await session.shutdown('用户主动退出');
    },
  };
}
