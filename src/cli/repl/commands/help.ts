/**
 * /help 命令
 *
 * 显示所有可用命令及用法摘要。
 */

import chalk, { Chalk } from 'chalk';
import type { CommandDefinition, ReplSession } from '../types.js';

/**
 * 创建 help 命令定义
 */
export function createHelpCommand(): CommandDefinition {
  return {
    name: 'help',
    aliases: ['h', '?'],
    description: '显示帮助信息',
    usage: '/help',
    handler(_args, session) {
      const { c } = getColorEnabled(session);
      const commands = getCommandRegistry(session).listCommands();
      const lines: string[] = ['', c.bold('  可用命令:'), ''];

      for (const cmd of commands) {
        const aliasStr = cmd.aliases.length > 0 ? `, /${cmd.aliases.join(', /')}` : '';
        lines.push(`  ${c.cyan.bold(`/${cmd.name}`)}${c.gray(aliasStr)}`);
        lines.push(`    ${c.gray(cmd.description)}`);
        if (cmd.usage && cmd.usage !== `/${cmd.name}`) {
          lines.push(`    ${c.gray(`用法: ${cmd.usage}`)}`);
        }
        lines.push('');
      }

      lines.push(c.gray('  ───────────────────────────────────────'));
      lines.push(c.gray('  提示: 直接输入自然语言即可提交目标给 AI 总管执行。'));
      lines.push(c.gray('  多行输入请在行末加 "\\" 续行。按 Ctrl+C 取消当前任务。'));
      lines.push('');

      session.appendOutput(lines);
    },
  };
}

// ============ 辅助函数 ============

function getColorEnabled(session: ReplSession): { c: typeof chalk } {
  const c = session.replOptions.color
    ? chalk
    : (new Chalk({ level: 0 }) as unknown as typeof chalk);
  return { c };
}

function getCommandRegistry(session: ReplSession) {
  return (
    session as unknown as { getCommandRegistry(): { listCommands(): CommandDefinition[] } }
  ).getCommandRegistry();
}
