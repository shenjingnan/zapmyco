/**
 * 输出区域组件
 *
 * 负责渲染 REPL 中的所有输出内容：
 * 欢迎信息、执行结果、错误信息、系统消息等。
 */

import chalk, { Chalk } from 'chalk';
import type { ZapmycoConfig } from '../../../config/types.js';
import type { FinalResult } from '../../../core/result/types.js';
import type { TaskGraph } from '../../../core/task/types.js';
import type { AgentRegistration } from '../../../protocol/capability.js';
import type { HistoryEntry } from '../types.js';

/**
 * 格式化输出内容的工具类
 *
 * 从原 Renderer 中提取的纯格式化逻辑，不依赖 console.log。
 */
export class OutputFormatter {
  private readonly c: typeof chalk;
  private readonly cDisabled: typeof chalk;

  constructor(private readonly color: boolean) {
    this.c = chalk;
    // 预创建禁用颜色的实例（level: 0）
    this.cDisabled = new Chalk({ level: 0 }) as unknown as typeof chalk;
  }

  /** 获取 chalk 实例 */
  private getColor(colorEnabled = this.color): typeof chalk {
    return colorEnabled ? this.c : this.cDisabled;
  }

  /** 格式化欢迎信息 */
  formatWelcome(version: string): string[] {
    const c = this.getColor();
    return [
      '',
      `  🍄 ${c.bold(`zapmyco@${version}`)}`,
      '',
      '  欢迎回来！',
      '',
      c.gray('─'.repeat(90)),
      '',
    ];
  }

  /** 格式化错误信息 */
  formatError(error: Error): string[] {
    const c = this.getColor();
    const lines: string[] = ['', ''];

    const zapmycoError = error as { code?: string; context?: Record<string, unknown> };

    if (zapmycoError.code) {
      lines.push(`${c.red.bold(`  ✗ [${zapmycoError.code}]`)} ${error.message}`);
      if (zapmycoError.context && Object.keys(zapmycoError.context).length > 0) {
        lines.push(c.gray(`  详情: ${JSON.stringify(zapmycoError.context)}`));
      }
    } else {
      lines.push(`${c.red.bold('  ✗ 执行失败:')} ${error.message}`);
    }

    lines.push('');
    return lines;
  }

  /** 格式化执行结果 */
  formatResult(result: FinalResult): string[] {
    const c = this.getColor();
    const statusIcon =
      result.overallStatus === 'success'
        ? '✅'
        : result.overallStatus === 'partial-failure'
          ? '⚠️'
          : '❌';

    const lines: string[] = [
      '',
      c.gray('  ┌────────────────────────────────────────────┐'),
      `  │  ${statusIcon}  ${c.bold('执行完成')}`,
      c.gray('  ├────────────────────────────────────────────┤'),
      `  │  ${c.gray('目标:')} ${result.summary.slice(0, 40)}`,
      `  │  ${c.gray('状态:')} ${
        result.overallStatus === 'success'
          ? c.green('成功')
          : result.overallStatus === 'partial-failure'
            ? c.yellow('部分成功')
            : c.red('失败')
      }`,
      `  │  ${c.gray('耗时:')} ${(result.totalDuration / 1000).toFixed(1)}s  ·  ${c.gray('Token:')} ${result.totalTokenUsage.totalTokens.toLocaleString()}`,
      `  │  ${c.gray('成本:')} $${result.totalTokenUsage.estimatedCostUsd.toFixed(4)}`,
    ];

    if (result.taskResults.length > 0) {
      lines.push(c.gray('  ├────────────────────────────────────────────┤'));
      lines.push(`  │  ${c.bold('任务拆分')} (${result.taskResults.length} 个子任务):`);
      for (const tr of result.taskResults) {
        const icon =
          tr.status === 'success'
            ? c.green('✓')
            : tr.status === 'partial'
              ? c.yellow('~')
              : c.red('✗');
        lines.push(`  │    ${icon} ${tr.taskId.slice(0, 12)}...`);
      }
    }

    if (result.allArtifacts.length > 0) {
      lines.push(c.gray('  ├────────────────────────────────────────────┤'));
      lines.push(`  │  ${c.bold('制品:')}`);
      for (const artifact of result.allArtifacts) {
        const icon = artifact.type === 'pull-request' ? '🔗' : '📄';
        lines.push(`  │    ${icon} ${artifact.description} (${artifact.reference})`);
      }
    }

    if (result.nextSteps && result.nextSteps.length > 0) {
      lines.push(c.gray('  ├────────────────────────────────────────────┤'));
      lines.push(`  │  ${c.bold('建议:')}`);
      for (let i = 0; i < result.nextSteps.length; i++) {
        lines.push(`  │    ${i + 1}. ${result.nextSteps[i]}`);
      }
    }

    lines.push(c.gray('  └────────────────────────────────────────────┘'));
    lines.push('');
    return lines;
  }

  /** 格式化任务拆分概览 */
  formatTaskGraph(graph: TaskGraph): string[] {
    const c = this.getColor();
    const lines: string[] = [
      '',
      c.bold('  📋 任务拆分概览'),
      c.gray(`  共 ${graph.nodes.size} 个子任务，${graph.layers.length} 层并行`),
      '',
    ];

    for (let layerIdx = 0; layerIdx < graph.layers.length; layerIdx++) {
      const layer = graph.layers[layerIdx];
      if (!layer) continue;
      lines.push(c.gray(`  第 ${layerIdx + 1} 层 (可并行):`));
      for (const taskId of layer) {
        const task = graph.nodes.get(taskId);
        if (task) {
          const statusIcon = this.statusToIcon(task.status, c);
          lines.push(`    ${statusIcon} ${c.cyan(task.name)} - ${task.description.slice(0, 50)}`);
        }
      }
      lines.push('');
    }

    return lines;
  }

  /** 格式化 Agent 列表 */
  formatAgents(agents: AgentRegistration[]): string[] {
    const c = this.getColor();
    const lines: string[] = ['', c.bold('  🤖 已注册 Agent'), ''];

    if (agents.length === 0) {
      lines.push(c.gray('  暂无已注册的 Agent'));
      lines.push('');
      return lines;
    }

    lines.push(
      `  ${c.bold('ID').padEnd(20)} ${c.bold('状态').padEnd(10)} ${c.bold('负载').padEnd(8)} ${c.bold('能力')}`
    );
    lines.push(c.gray(`  ${'─'.repeat(60)}`));

    for (const agent of agents) {
      const statusDot =
        agent.status === 'online'
          ? c.green('●')
          : agent.status === 'busy'
            ? c.yellow('●')
            : c.gray('○');
      const capabilities = agent.capabilities.map((cap) => cap.name).join(', ');

      lines.push(
        `  ${agent.agentId.padEnd(20)} ${statusDot} ${String(agent.status).padEnd(8)} ${String(agent.currentLoad).padEnd(8)} ${capabilities}`
      );
    }

    lines.push('');
    return lines;
  }

  /** 格式化配置信息 */
  formatConfig(config: ZapmycoConfig): string[] {
    const c = this.getColor();
    const lines: string[] = ['', c.bold('  ⚙️  当前配置'), '', c.bold('  LLM:')];

    lines.push(`    提供商: ${config.llm.provider}`);
    lines.push(`    模型: ${config.llm.model ?? c.gray('(默认)')}`);
    lines.push(`    API Key: ${config.llm.apiKey ? c.gray('***已配置***') : c.red('(未配置)')}`);

    lines.push(c.bold('  调度器:'));
    lines.push(`    最大并行: ${config.scheduler.maxConcurrency}`);
    lines.push(`    单 Agent 最大并发: ${config.scheduler.maxPerAgent}`);
    lines.push(`    任务超时: ${(config.scheduler.taskTimeoutMs / 1000 / 60).toFixed(0)} 分钟`);
    lines.push(`    最大重试: ${config.scheduler.maxRetries}`);

    lines.push(c.bold('  CLI:'));
    lines.push(`    颜色输出: ${config.cli.color ? c.green('开启') : c.gray('关闭')}`);
    lines.push(`    调试模式: ${config.cli.debug ? c.green('开启') : c.gray('关闭')}`);
    lines.push(`    输出格式: ${config.cli.outputFormat}`);

    lines.push(c.bold('  Agents:'));
    for (const agent of config.agents) {
      const statusIcon = agent.enabled ? c.green('✓') : c.gray('✗');
      lines.push(`    ${statusIcon} ${agent.id}`);
    }

    lines.push('');
    return lines;
  }

  /** 格式化历史记录 */
  formatHistory(entries: HistoryEntry[]): string[] {
    const c = this.getColor();
    const lines: string[] = ['', c.bold('  📜 会话历史'), ''];

    if (entries.length === 0) {
      lines.push(c.gray('  暂无历史记录'));
      lines.push('');
      return lines;
    }

    for (const entry of entries) {
      const time = new Date(entry.timestamp).toTimeString().slice(0, 8);
      const inputPreview = entry.input.length > 50 ? `${entry.input.slice(0, 47)}...` : entry.input;

      let line = `  #${String(entry.id).padStart(3)}  ${c.gray(`[${time}]`)}  ${inputPreview}`;

      if (entry.durationMs !== undefined) {
        line += c.gray(`  (${(entry.durationMs / 1000).toFixed(1)}s)`);
      }

      lines.push(line);
    }

    lines.push('');
    return lines;
  }

  /** 格式化会话状态 */
  formatStatus(stats: {
    totalRequests: number;
    successCount: number;
    failureCount: number;
    totalTokens: number;
    totalCostUsd: number;
    state: string;
  }): string[] {
    const c = this.getColor();
    const lines: string[] = ['', c.bold('  📊 会话状态'), ''];

    const stateLabel =
      stats.state === 'idle'
        ? c.green('空闲')
        : stats.state === 'executing'
          ? c.magenta('执行中')
          : c.gray('关闭中');

    lines.push(`  状态:       ${stateLabel}`);
    lines.push(`  总请求数:   ${stats.totalRequests}`);
    lines.push(`  成功:       ${c.green(String(stats.successCount))}`);
    lines.push(
      `  失败:       ${stats.failureCount > 0 ? c.red(String(stats.failureCount)) : String(stats.failureCount)}`
    );
    lines.push(`  Token 消耗: ${stats.totalTokens.toLocaleString()}`);
    lines.push(`  总成本:     $${stats.totalCostUsd.toFixed(4)}`);
    lines.push('');
    return lines;
  }

  private statusToIcon(status: string, c: typeof chalk): string {
    switch (status) {
      case 'succeeded':
        return `${c.green(' ✓')}`;
      case 'running':
        return `${c.magenta(' ⟳')}`;
      case 'failed':
        return `${c.red(' ✗')}`;
      case 'cancelled':
        return `${c.gray(' ⊘')}`;
      case 'skipped':
        return `${c.gray(' ⊘')}`;
      default:
        return `${c.gray(' ○')}`;
    }
  }
}
