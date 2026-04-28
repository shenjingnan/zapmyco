/**
 * /clear 命令
 *
 * 清屏并重置多行输入缓冲区。
 */

import type { CommandDefinition } from '../types.js';

/**
 * 创建 clear 命令定义
 */
export function createClearCommand(): CommandDefinition {
  return {
    name: 'clear',
    aliases: ['cl'],
    description: '清除屏幕',
    usage: '/clear',
    handler(_args, session) {
      // 清空输出区域（TUI 模式下替代 clearScreen）
      session.clearOutput();

      // 重置输入解析器的多行缓冲
      const s = session as unknown as { getInputParser(): { reset(): void } };
      s.getInputParser().reset();
    },
  };
}
