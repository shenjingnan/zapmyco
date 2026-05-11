/**
 * 输出区域组件
 *
 * 负责渲染 REPL 中的所有输出内容：
 * 欢迎信息、执行结果、错误信息、系统消息等。
 */

import chalk, { Chalk } from 'chalk';
import type { HistoryEntry } from '@/cli/repl/types';
import type { ZapmycoConfig } from '@/config/types';
import type { FinalResult } from '@/core/result/types';
import type { TaskGraph } from '@/core/task/types';
import { t } from '@/i18n';
import type { AgentRegistration } from '@/protocol/capability';

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
      `  ${t('output.welcome')}`,
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
        lines.push(c.gray(`  ${t('output.error.detail')} ${JSON.stringify(zapmycoError.context)}`));
      }
    } else {
      lines.push(`${c.red.bold(`  ✗ ${t('output.error.executionFailed')}`)} ${error.message}`);
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
      `  │  ${statusIcon}  ${c.bold(t('output.result.title'))}`,
      c.gray('  ├────────────────────────────────────────────┤'),
      `  │  ${c.gray(t('output.result.goal'))} ${result.summary.slice(0, 40)}`,
      `  │  ${c.gray(t('output.result.status'))} ${
        result.overallStatus === 'success'
          ? c.green(t('output.result.success'))
          : result.overallStatus === 'partial-failure'
            ? c.yellow(t('output.result.partialSuccess'))
            : c.red(t('output.result.failed'))
      }`,
      `  │  ${c.gray(t('output.result.duration'))} ${(result.totalDuration / 1000).toFixed(1)}s  ·  ${c.gray(t('output.result.token'))} ${result.totalTokenUsage.totalTokens.toLocaleString()}`,
      `  │  ${c.gray(t('output.result.cost'))} $${result.totalTokenUsage.estimatedCostUsd.toFixed(4)}`,
    ];

    if (result.taskResults.length > 0) {
      lines.push(c.gray('  ├────────────────────────────────────────────┤'));
      lines.push(
        `  │  ${c.bold(t('output.result.taskBreakdown'))} (${result.taskResults.length} ${t('output.result.subtaskCount')}):`
      );
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
      lines.push(`  │  ${c.bold(t('output.result.artifacts'))}`);
      for (const artifact of result.allArtifacts) {
        const icon = artifact.type === 'pull-request' ? '🔗' : '📄';
        lines.push(`  │    ${icon} ${artifact.description} (${artifact.reference})`);
      }
    }

    if (result.nextSteps && result.nextSteps.length > 0) {
      lines.push(c.gray('  ├────────────────────────────────────────────┤'));
      lines.push(`  │  ${c.bold(t('output.result.suggestions'))}`);
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
      c.bold(`  📋 ${t('output.taskGraph.title')}`),
      c.gray(
        `  ${t('output.taskGraph.total', { count: graph.nodes.size, layers: graph.layers.length })}`
      ),
      '',
    ];

    for (let layerIdx = 0; layerIdx < graph.layers.length; layerIdx++) {
      const layer = graph.layers[layerIdx];
      if (!layer) continue;
      lines.push(c.gray(`  ${t('output.taskGraph.layer', { index: layerIdx + 1 })}`));
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
    const lines: string[] = ['', c.bold(`  🤖 ${t('output.agents.title')}`), ''];

    if (agents.length === 0) {
      lines.push(c.gray(`  ${t('output.agents.empty')}`));
      lines.push('');
      return lines;
    }

    lines.push(
      `  ${c.bold(t('output.agents.id')).padEnd(20)} ${c.bold(t('output.agents.status')).padEnd(10)} ${c.bold(t('output.agents.load')).padEnd(8)} ${c.bold(t('output.agents.capability'))}`
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
    const lines: string[] = [
      '',
      c.bold(`  ⚙️  ${t('output.config.title')}`),
      '',
      c.bold(`  ${t('output.config.llm')}`),
    ];

    lines.push(`    ${t('output.config.defaultModel')} ${config.llm.defaultModel}`);
    // 解析 defaultModel 获取 provider 和 model 名称
    const defaultModelKey = config.llm.defaultModel;
    const slashIdx = defaultModelKey.indexOf('/');
    const defaultProvider = slashIdx > 0 ? defaultModelKey.slice(0, slashIdx) : 'anthropic';
    const defaultModelName = slashIdx > 0 ? defaultModelKey.slice(slashIdx + 1) : defaultModelKey;
    const providerConfig = config.llm.providers[defaultProvider];
    const modelConfig = providerConfig?.models?.[defaultModelName];
    lines.push(`    ${t('output.config.provider')} ${defaultProvider}`);
    // 模型 ID：优先从配置读取，否则使用模型名（pi-ai 自动推断）
    lines.push(`    ${t('output.config.modelId')} ${modelConfig?.id ?? defaultModelName}`);
    if (modelConfig?.input && modelConfig.input.length > 0) {
      lines.push(`    ${t('output.config.inputType')} ${modelConfig.input.join(', ')}`);
    }
    lines.push(
      `    ${t('output.config.apiKey')} ${providerConfig?.apiKey ? c.gray(t('output.config.apiKeyConfigured')) : c.red(t('output.config.apiKeyNotConfigured'))}`
    );
    // API 格式从 pi-ai 自动推断，仅当用户显式配置时显示
    if (providerConfig?.apiFormat) {
      lines.push(`    ${t('output.config.apiFormat')} ${providerConfig.apiFormat}`);
    }

    lines.push(c.bold(`  ${t('output.config.scheduler')}`));
    lines.push(`    ${t('output.config.maxConcurrency')} ${config.scheduler.maxConcurrency}`);
    lines.push(`    ${t('output.config.maxPerAgent')} ${config.scheduler.maxPerAgent}`);
    lines.push(
      `    ${t('output.config.taskTimeout')} ${(config.scheduler.taskTimeoutMs / 1000 / 60).toFixed(0)} ${t('output.config.minutes')}`
    );
    lines.push(`    ${t('output.config.maxRetries')} ${config.scheduler.maxRetries}`);

    lines.push(c.bold(`  ${t('output.config.cli')}`));
    lines.push(
      `    ${t('output.config.colorEnabled')}: ${config.cli.color ? c.green(t('output.config.colorEnabled')) : c.gray(t('output.config.colorDisabled'))}`
    );
    lines.push(
      `    ${t('output.config.debugEnabled')}: ${config.cli.debug ? c.green(t('output.config.debugEnabled')) : c.gray(t('output.config.debugDisabled'))}`
    );
    lines.push(`    ${t('output.config.outputFormat')} ${config.cli.outputFormat}`);
    lines.push(`    ${t('output.config.uiLanguage')} ${config.locale ?? 'zh-CN'}`);

    lines.push(c.bold(`  ${t('output.config.agents')}`));
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
    const lines: string[] = ['', c.bold(`  📜 ${t('output.history.title')}`), ''];

    if (entries.length === 0) {
      lines.push(c.gray(`  ${t('output.history.empty')}`));
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
    const lines: string[] = ['', c.bold(`  📊 ${t('output.status.title')}`), ''];

    const stateLabel =
      stats.state === 'idle'
        ? c.green(t('output.status.idle'))
        : stats.state === 'executing'
          ? c.magenta(t('output.status.executing'))
          : c.gray(t('output.status.closing'));

    lines.push(`  ${t('output.status.state').padEnd(10)} ${stateLabel}`);
    lines.push(`  ${t('output.status.totalRequests').padEnd(10)} ${stats.totalRequests}`);
    lines.push(`  ${t('output.status.success').padEnd(10)} ${c.green(String(stats.successCount))}`);
    lines.push(
      `  ${t('output.status.failure').padEnd(10)} ${stats.failureCount > 0 ? c.red(String(stats.failureCount)) : String(stats.failureCount)}`
    );
    lines.push(
      `  ${t('output.status.tokenConsumption').padEnd(10)} ${stats.totalTokens.toLocaleString()}`
    );
    lines.push(`  ${t('output.status.totalCost').padEnd(10)} $${stats.totalCostUsd.toFixed(4)}`);
    lines.push('');
    return lines;
  }

  /** 格式化安全健康报告 → 返回格式化行 */
  formatSecurityHealth(report: import('@/security/types').SecurityHealthReport): string[] {
    const c = this.getColor();
    const lines: string[] = ['', c.bold('  🔒 安全健康报告'), ''];

    // 整体评分
    const scoreIcon = report.overallScore >= 80 ? '🟢' : report.overallScore >= 50 ? '🟡' : '🔴';
    lines.push(`  整体评分: ${scoreIcon} ${report.overallScore}/100`);
    lines.push('');

    // 分类评分
    lines.push('  分类评分:');
    const bar = (s: number) => {
      const filled = Math.round(s / 10);
      return c.green('█'.repeat(filled)) + c.gray('░'.repeat(10 - filled)) + ` ${s}/100`;
    };
    lines.push(`    permissions:  ${bar(report.scores.permissions)}`);
    lines.push(`    shell:        ${bar(report.scores.shell)}`);
    lines.push(`    filesystem:   ${bar(report.scores.filesystem)}`);
    lines.push(`    ssrf:         ${bar(report.scores.ssrf)}`);
    lines.push(`    secrets:      ${bar(report.scores.secrets)}`);
    lines.push(`    sandbox:      ${bar(report.scores.sandbox)}`);
    lines.push('');

    // 统计
    lines.push('  统计:');
    lines.push(
      `    总决策: ${report.stats.totalDecisions}  ${c.red(`阻止: ${report.stats.blockedCount}`)}  ${c.green(`批准: ${report.stats.approvedCount}`)}  拒绝: ${report.stats.deniedCount}`
    );
    if (report.stats.doomLoopTriggers > 0) {
      lines.push(`    doom-loop 触发: ${c.red(String(report.stats.doomLoopTriggers))}`);
    }
    lines.push('');

    // 近期阻止
    if (report.recentBlocks.length > 0) {
      lines.push('  近期阻止:');
      for (const block of report.recentBlocks.slice(0, 5)) {
        lines.push(
          `    ${block.timestamp.slice(11, 19)}  ${c.red(block.toolId)} — ${block.reason}`
        );
      }
      lines.push('');
    }

    // 改进建议
    if (report.recommendations.length > 0) {
      lines.push('  改进建议:');
      for (const rec of report.recommendations) {
        lines.push(`    ${c.yellow('⚠')} ${rec}`);
      }
      lines.push('');
    }

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
