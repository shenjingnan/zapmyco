/**
 * /history 命令
 *
 * 查看会话历史记录。
 */

import type { CommandDefinition } from '@/cli/repl/types';

/** 默认显示条数 */
const DEFAULT_COUNT = 10;

/**
 * 创建 history 命令定义
 */
export function createHistoryCommand(): CommandDefinition {
  return {
    name: 'history',
    aliases: ['hi'],
    description: '查看历史记录 [n]',
    usage: '/history [n]',
    handler(args, session) {
      const store = session.getHistoryStore();
      const count = args[0] ? parseInt(args[0], 10) : DEFAULT_COUNT;

      if (Number.isNaN(count) || count <= 0) {
        session.appendOutput(['', '  参数错误: 请输入有效的数字，如 /history 20', '']);
        return;
      }

      const entries = store.getLast(count);
      const lines = session.getRenderer().renderHistory(entries);
      session.appendOutput(lines);
    },
  };
}
