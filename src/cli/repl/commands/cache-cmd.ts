/**
 * /cache 命令 — 显示 Prompt 缓存状态
 *
 * 展示当前会话的 prompt 缓存命中率、缓存读取比例等指标。
 *
 * @module cli/repl/commands/cache-cmd
 */

import chalk from 'chalk';
import type { CommandDefinition } from '@/cli/repl/types';
import type { LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';

/**
 * 创建 /cache 命令
 */
export function createCacheCommand(): CommandDefinition {
  return {
    name: 'cache',
    aliases: [],
    description: '显示 prompt 缓存状态',
    usage: '/cache',
    handler: async (_args: string[], session: import('@/cli/repl/types').ReplSession) => {
      // 通过内部属性获取 LlmBasedAgent 实例
      const replSession = session as unknown as {
        agent: LlmBasedAgent;
        appendOutput: (lines: string[]) => void;
      };

      const agent = replSession.agent;
      const stats = agent.getCacheStats();
      const schemaStats = agent.toolSchemaCache.getStats();

      const lines: string[] = [];
      lines.push('');
      lines.push(chalk.cyan('  Prompt 缓存状态'));
      lines.push(`  ${chalk.gray('─'.repeat(40))}`);
      lines.push(chalk.gray('  缓存命中率: ') + formatPercent(stats.hitRate));
      lines.push(chalk.gray('  平均缓存读取比例: ') + formatPercent(stats.averageCacheRatio));
      lines.push(chalk.gray('  总调用次数: ') + chalk.white(String(stats.totalCalls)));

      if (stats.lastBreak) {
        const breakStatus = stats.lastBreak.broken
          ? chalk.red('⚠ 检测到缓存断裂')
          : chalk.green('✓ 缓存正常');
        lines.push(chalk.gray('  断裂检测: ') + breakStatus);
        if (stats.lastBreak.broken) {
          lines.push(
            chalk.gray('    前次读取: ') + chalk.white(formatTokens(stats.lastBreak.previousRead))
          );
          lines.push(
            chalk.gray('    当前读取: ') + chalk.red(formatTokens(stats.lastBreak.currentRead))
          );
        }
      }

      if (schemaStats.size > 0) {
        lines.push('');
        lines.push(chalk.gray('  工具 Schema 缓存: ') + chalk.white(`${schemaStats.size} 个工具`));
      }

      lines.push('');
      replSession.appendOutput(lines);
    },
  };
}

function formatPercent(ratio: number): string {
  const pct = (ratio * 100).toFixed(1);
  if (ratio > 0.8) return chalk.green(`${pct}%`);
  if (ratio > 0.5) return chalk.yellow(`${pct}%`);
  if (ratio > 0) return chalk.red(`${pct}%`);
  return chalk.gray('N/A');
}

function formatTokens(tokens: number): string {
  if (tokens > 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens > 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
}
