/**
 * 输出区域组件
 *
 * 负责渲染 REPL 中的所有输出内容：
 * 欢迎信息、执行结果、错误信息、系统消息等。
 */

import chalk, { Chalk } from 'chalk';
import { stripAnsi } from '@/cli/repl/tools/shell-security';
import type { HistoryEntry } from '@/cli/repl/types';
import type { Rect, Screen, SgrMouseEvent, StylePool } from '@/cli/tui';
import { Container, renderAnsiLineToScreen, setClipboard, wrapTextWithAnsi } from '@/cli/tui';
import type { ZapmycoConfig } from '@/config/types';
import type { FinalResult } from '@/core/result/types';
import type { TaskGraph } from '@/core/task/types';
import { t } from '@/i18n';
import { logger } from '@/infra/logger';
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
      c.bold(`  ${t('output.taskGraph.title')}:`),
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
    // 模型 ID：优先从配置读取，否则使用模型名
    lines.push(`    ${t('output.config.modelId')} ${modelConfig?.id ?? defaultModelName}`);
    if (modelConfig?.input && modelConfig.input.length > 0) {
      lines.push(`    ${t('output.config.inputType')} ${modelConfig.input.join(', ')}`);
    }
    lines.push(
      `    ${t('output.config.apiKey')} ${providerConfig?.apiKey ? c.gray(t('output.config.apiKeyConfigured')) : c.red(t('output.config.apiKeyNotConfigured'))}`
    );
    // API 格式仅当用户显式配置时显示
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
      return `${c.green('█'.repeat(filled)) + c.gray('░'.repeat(10 - filled))} ${s}/100`;
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

// =============================================================================
// 选择范围类型
// =============================================================================

/** 选择范围（逻辑行坐标） */
interface SelRange {
  /** anchor 逻辑行索引 */
  startLine: number;
  /** anchor 字符偏移 */
  startOffset: number;
  /** focus 逻辑行索引 */
  endLine: number;
  /** focus 字符偏移 */
  endOffset: number;
}

// =============================================================================
// OutputArea — 输出区域组件
// =============================================================================

/**
 * 输出区域组件
 *
 * 管理所有输出内容的行缓冲，实现 render 和 renderToScreen 接口。
 * 支持通过键盘（PageUp/Down）和鼠标滚轮滚动查看历史内容。
 *
 * 在 Screen 管线中（renderToScreen），采用虚拟滚动策略：
 * 只将可见范围的换行行写入 Screen 缓冲区，渲染时间与历史行数无关。
 *
 * 在旧管线中（render），保持返回所有行，由引擎层切片。
 */
export class OutputArea extends Container {
  private lines: string[] = [];
  /** 逐行缓存的换行结果（逻辑行索引 → 换行后的行数组） */
  private lineCache: Map<number, string[]> = new Map();
  /** 缓存生成时使用的终端宽度，变化时重建 */
  private cacheWidth = 0;
  /**
   * 每个逻辑行换行后的显示行数。
   * 用于 renderToScreen 中的 display line → logical line 转换。
   */
  private wrappedHeights: number[] = [];

  /** 滚动偏移量（0 = 底部/最新），单位为换行后显示行 */
  #scrollOffset = 0;
  /** 是否跟随底部（追加内容时自动滚动到底部） */
  #followBottom = true;

  /** 当前选择范围（null = 无选择） */
  #selection: SelRange | null = null;
  /** 是否正在拖拽选择 */
  #isDragging = false;
  /** 缓存的渲染区域矩形（从 renderToScreen 获取，供坐标转换使用） */
  #areaRect: Rect | null = null;

  /** 最大逻辑行数（超出时丢弃最早的行） */
  private static readonly MAX_LINES = 10_000;

  /** 公共只读属性，供引擎层读取 */
  get scrollOffset(): number {
    return this.#scrollOffset;
  }

  /** 是否处于跟随底部模式 */
  get followBottom(): boolean {
    return this.#followBottom;
  }

  // -------------------------------------------------------------------------
  // 旧版渲染接口（返回全部行，由引擎层切片）
  // -------------------------------------------------------------------------

  /**
   * 渲染所有行（引擎层根据 scrollOffset 做切片）
   * 此处返回完整内容，不做截断。
   */
  override render(width: number): string[] {
    if (width !== this.cacheWidth) {
      this.rebuildAllWraps(width);
    }

    const result: string[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      result.push(...this.getOrCreateWrappedLine(i));
    }

    // 在旧管线中直接渲染选区高亮（作为 ANSI 转义序列写入输出行）
    if (this.#selection && width > 0) {
      this.#applySelectionToLines(result, width);
    }

    return result;
  }

  /**
   * 在 ANSI 行数组中应用选区高亮（旧管线用）。
   * 遍历每一行，将选中字符包裹在选区背景色 ANSI 序列中。
   */
  #applySelectionToLines(lines: string[], lineWidth: number): void {
    const sel = this.#selection;
    if (!sel) return;

    // 归一化
    const startLine = sel.startLine <= sel.endLine ? sel.startLine : sel.endLine;
    const endLine = sel.startLine <= sel.endLine ? sel.endLine : sel.startLine;
    // 选区背景色 ANSI 序列
    const SEL_BG = '\x1b[48;2;38;79;120m';
    const BG_RESET = '\x1b[49m';

    // 遍历逻辑行，累加 wrapped 行偏移
    let globalLineIdx = 0; // 全局 wrapped 行索引
    for (let ll = 0; ll < this.wrappedHeights.length; ll++) {
      const h = this.wrappedHeights[ll] ?? 1;

      // 本逻辑行不在选区范围内 → 跳过
      if (ll < startLine || ll > endLine) {
        globalLineIdx += h;
        continue;
      }

      // 处理本逻辑行的每个 wrapped 子行
      for (let wi = 0; wi < h; wi++) {
        if (globalLineIdx >= lines.length) break;
        const wrappedLine = lines[globalLineIdx] ?? '';

        // 计算本子行在逻辑行中的字符范围
        // 计算与选区相交的字符范围
        let selStart: number | undefined;
        let selEnd: number | undefined;

        // 所有选中行均使用整行宽度（0 ~ lineWidth），与 claude-code 行为一致。
        selStart = 0;
        selEnd = lineWidth;

        if (
          selStart === undefined ||
          selEnd === undefined ||
          selStart >= selEnd ||
          selStart >= lineWidth
        ) {
          globalLineIdx++;
          continue;
        }

        // 在 ANSI 行中按字符位置插入选区背景色
        // 使用逐字符遍历替换正则拆分行，避免 ANSI 序列解析不完整导致
        // 字符计数偏移（表现为交替选中/不选中的"凹凸"模式）。
        let out = '';
        let charPos = 0;
        let inSel = false;
        let i = 0;

        while (i < wrappedLine.length) {
          const ch = wrappedLine[i]!;
          if (ch === '\x1b') {
            // ANSI 转义序列：跳过整个序列（CSI 或 OSC 等），不计入 charPos
            const seqStart = i;
            i++; // 跳过 ESC
            if (i < wrappedLine.length && wrappedLine[i]! === '[') {
              // CSI 序列: \x1b[ params... final byte
              i++;
              while (i < wrappedLine.length && !/[a-zA-Z~]/.test(wrappedLine[i]!)) i++;
              if (i < wrappedLine.length) i++;
            } else if (i < wrappedLine.length && wrappedLine[i]! === ']') {
              // OSC 序列: \x1b]...(\x07|\x1b\\)
              i++;
              while (
                i < wrappedLine.length &&
                wrappedLine[i]! !== '\x07' &&
                !(
                  wrappedLine[i]! === '\x1b' &&
                  i + 1 < wrappedLine.length &&
                  wrappedLine[i + 1]! === '\\'
                )
              ) {
                i++;
              }
              if (i < wrappedLine.length) i++;
            } else {
              // 其他 ESC 序列: 跳过 ESC 后的一个字节
              if (i < wrappedLine.length) i++;
            }
            out += wrappedLine.slice(seqStart, i);
          } else {
            // 可见字符
            if (!inSel && charPos >= selStart && charPos < selEnd) {
              out += SEL_BG;
              inSel = true;
            } else if (inSel && charPos >= selEnd) {
              out += BG_RESET;
              inSel = false;
            }
            out += wrappedLine[i];
            charPos++;
            i++;
          }
        }

        // 行内容不足 lineWidth 时补齐空格，确保选区背景覆盖整行
        while (charPos < lineWidth) {
          if (!inSel && charPos >= selStart && charPos < selEnd) {
            out += SEL_BG;
            inSel = true;
          } else if (inSel && charPos >= selEnd) {
            out += BG_RESET;
            inSel = false;
          }
          out += ' ';
          charPos++;
        }

        if (inSel) out += BG_RESET;
        lines[globalLineIdx] = out;
        globalLineIdx++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Screen 管线渲染接口（虚拟滚动）
  // -------------------------------------------------------------------------

  /**
   * 设置区域矩形（供引擎在旧管线中调用，使 #terminalToLogical 能正确转换坐标）。
   * 在旧字符串管线中，computeOutput 计算布局后调用此方法设置 rect。
   */
  setAreaRect(rect: Rect): void {
    this.#areaRect = rect;
    // 终端宽度变化 → 清除选择并重建所有缓存
    if (rect.width !== this.cacheWidth) {
      this.#selection = null;
      this.#isDragging = false;
      this.rebuildAllWraps(rect.width);
    }
  }

  /**
   * 渲染到 Screen 缓冲区（虚拟滚动）。
   *
   * 只将当前可见范围的换行行写入 Screen，而非全部历史行。
   * 使用 wrappedHeights 数组进行 display line → logical line 转换。
   */
  renderToScreen(screen: Screen, stylePool: StylePool, rect: Rect): void {
    // 缓存 rect 供 #terminalToLogical 使用
    this.#areaRect = rect;

    // 终端宽度变化 → 清除选择并重建所有缓存
    if (rect.width !== this.cacheWidth) {
      this.#selection = null;
      this.#isDragging = false;
      this.rebuildAllWraps(rect.width);
    }

    if (this.lines.length === 0 || rect.height <= 0) {
      screen.clearRegion(rect.x, rect.y, rect.width, rect.height);
      return;
    }

    // 计算总显示高度
    const totalDisplayHeight = this.wrappedHeights.reduce((a, b) => a + b, 0);

    if (totalDisplayHeight === 0) {
      screen.clearRegion(rect.x, rect.y, rect.width, rect.height);
      return;
    }

    // 在显示行空间中计算可见窗口
    // scrollOffset = 0 → 显示底部（最新内容）
    // scrollOffset > 0 → 从底部向上偏移（查看历史）
    const maxScroll = Math.max(0, totalDisplayHeight - rect.height);
    const clampedOffset = Math.min(this.#scrollOffset, maxScroll);
    const visibleEnd = totalDisplayHeight - clampedOffset;
    const visibleStart = Math.max(0, visibleEnd - rect.height);

    // 遍历逻辑行，只渲染可见部分
    let displayRow = 0;
    let screenRow = rect.y;

    for (let logicalIdx = 0; logicalIdx < this.lines.length; logicalIdx++) {
      const height = this.wrappedHeights[logicalIdx] ?? 1;
      const lineEnd = displayRow + height;

      // 完全在可见窗口上方 → 跳过
      if (lineEnd <= visibleStart) {
        displayRow = lineEnd;
        continue;
      }

      // 完全在可见窗口下方 → 结束遍历
      if (displayRow >= visibleEnd) {
        break;
      }

      // 此行至少部分可见 → 获取换行结果并写入可见的子行
      const wrapped = this.getOrCreateWrappedLine(logicalIdx);
      for (let wi = 0; wi < wrapped.length; wi++) {
        const globalRow = displayRow + wi;
        if (globalRow >= visibleStart && globalRow < visibleEnd) {
          renderAnsiLineToScreen(screen, stylePool, rect.x, screenRow, wrapped[wi] ?? '');
          screenRow++;
        }
      }

      displayRow = lineEnd;
    }

    // 填充底部空白区域（渲染行数不足 rect.height 时）
    const renderedRows = screenRow - rect.y;
    if (renderedRows < rect.height) {
      screen.clearRegion(rect.x, rect.y + renderedRows, rect.width, rect.height - renderedRows);
    }

    // 渲染选中高亮（在正常内容之上修改选中 cell 的 styleId）
    this.#renderSelectionHighlight(screen, stylePool, rect);
  }

  // -------------------------------------------------------------------------
  // 内容管理
  // -------------------------------------------------------------------------

  /** 处理键盘/鼠标滚动事件 */
  handleScroll(direction: 'up' | 'down', _lines?: number): void {
    this.clearSelection(); // PR4: 滚动时清除选择
    const step = _lines ?? 3;
    if (direction === 'up') {
      this.#scrollOffset += step;
      this.#followBottom = false;
    } else {
      this.#scrollOffset = Math.max(0, this.#scrollOffset - step);
      if (this.#scrollOffset === 0) {
        this.#followBottom = true;
      }
    }
    this.invalidate();
  }

  /** 重置滚动到底部 */
  scrollToBottom(): void {
    this.#scrollOffset = 0;
    this.#followBottom = true;
    this.invalidate();
  }

  // -------------------------------------------------------------------------
  // 选择管理（公共 API）
  // -------------------------------------------------------------------------

  /** 清除当前选择 */
  clearSelection(): void {
    this.#selection = null;
    this.#isDragging = false;
    this.invalidate();
  }

  /** 是否有激活的选择 */
  hasSelection(): boolean {
    return this.#selection !== null;
  }

  /** 复制选中文本到剪贴板并清除选择（用于 Cmd+C 触发） */
  copySelection(): void {
    this.#copySelection();
    this.clearSelection();
  }

  // -------------------------------------------------------------------------
  // 文本提取
  // -------------------------------------------------------------------------

  /**
   * 提取选中文本（纯文本，不含 ANSI 码）。
   *
   * 从 #selection 范围遍历逻辑行，提取对应字符偏移区间的文本，
   * 每行经 stripAnsi 去除 ANSI 码后以 \n 拼接。
   *
   * @returns 选中区域的纯文本，无选择时返回空字符串
   */
  getSelectedText(): string {
    const sel = this.#selection;
    if (!sel) return '';

    // 归一化：保证 startLine ≤ endLine
    const startLine = sel.startLine <= sel.endLine ? sel.startLine : sel.endLine;
    const endLine = sel.startLine <= sel.endLine ? sel.endLine : sel.startLine;
    // 同一行内：取较小偏移为 start，较大为 end
    const startOffset =
      startLine === endLine
        ? Math.min(sel.startOffset, sel.endOffset)
        : sel.startLine <= sel.endLine
          ? sel.startOffset
          : sel.endOffset;
    const endOffset =
      startLine === endLine
        ? Math.max(sel.startOffset, sel.endOffset)
        : sel.startLine <= sel.endLine
          ? sel.endOffset
          : sel.startOffset;

    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      const rawLine = this.lines[i] ?? '';
      if (i === startLine && i === endLine) {
        // 单行选择
        lines.push(stripAnsi(rawLine.slice(startOffset, endOffset)));
      } else if (i === startLine) {
        // 多行选择的首行
        lines.push(stripAnsi(rawLine.slice(startOffset)));
      } else if (i === endLine) {
        // 多行选择的末行
        lines.push(stripAnsi(rawLine.slice(0, endOffset)));
      } else {
        // 中间行：整行
        lines.push(stripAnsi(rawLine));
      }
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // 鼠标事件处理
  // -------------------------------------------------------------------------

  /**
   * 处理 SGR 鼠标事件。
   *
   * 只响应左键（button === 0）的 press/drag/release 事件：
   * - press: 在点击位置建立选择锚点
   * - drag: 扩展选择范围到鼠标位置
   * - release: 结束拖拽状态，保持选择高亮
   */
  handleMouseEvent(event: SgrMouseEvent): void {
    // 只处理左键（drag 兼容 button=3：iTerm2 在不按 Option 时截获 press，
    // 后续 motion 事件的 button 编码为 3 而非 0）
    if (event.button !== 0 && !(event.action === 'drag' && event.button === 3)) return;

    switch (event.action) {
      case 'press': {
        // PR4: 点击时清除已完成的选择
        if (this.#selection && !this.#isDragging) {
          this.#selection = null;
        }
        const pos = this.#terminalToLogical(event.col, event.row);
        this.#selection = {
          startLine: pos.line,
          startOffset: pos.offset,
          endLine: pos.line,
          endOffset: pos.offset,
        };
        this.#isDragging = true;
        logger.info(
          `SEL press set line=${pos.line} offset=${pos.offset} rect=${JSON.stringify(this.#areaRect)}`
        );
        break;
      }
      case 'drag': {
        if (!this.#isDragging) {
          // 释放鼠标后的 motion 事件（btn=35）不应重新开始选择。
          if (this.#selection) return;
          // iTerm2 在不按 Option 时不发送 press 事件（截获用于原生选择），
          // 直接以 drag 事件开始。这里将首次 drag 视为隐式 press + drag 处理，
          // 确保选择仍能正常开始。
          const pos = this.#terminalToLogical(event.col, event.row);
          this.#selection = {
            startLine: pos.line,
            startOffset: pos.offset,
            endLine: pos.line,
            endOffset: pos.offset,
          };
          this.#isDragging = true;
          logger.info(`SEL implicit_press line=${pos.line} offset=${pos.offset}`);
          break;
        }
        const pos = this.#terminalToLogical(event.col, event.row);
        if (this.#selection) {
          this.#selection.endLine = pos.line;
          this.#selection.endOffset = pos.offset;
        }
        this.invalidate();
        break;
      }
      case 'release': {
        if (this.#isDragging) {
          this.#isDragging = false;
          const text = this.getSelectedText();
          logger.info(`SEL release textLen=${text?.length ?? 0} hasText=${!!text}`);
          this.#copySelection();
        }
        break;
      }
    }
  }

  /**
   * 将终端坐标转换为逻辑行坐标。
   *
   * 转换步骤：
   * 1. SGR 1-based → 0-based
   * 2. 相对 OutputArea rect 偏移
   * 3. 考虑虚拟滚动偏移，计算全局显示行
   * 4. 遍历 wrappedHeights 找到对应逻辑行
   *
   * @param col - SGR 列号（1-based）
   * @param row - SGR 行号（1-based）
   * @returns 逻辑行坐标 { line, offset }
   */
  #terminalToLogical(col: number, row: number): { line: number; offset: number } {
    const rect = this.#areaRect;
    if (!rect) return { line: 0, offset: 0 };

    // SGR 1-based → 0-based 屏幕坐标
    const absoluteRow = row - 1;
    // 相对于 OutputArea 区域的行
    const rowInRect = absoluteRow - rect.y;

    // 计算虚拟滚动的可见窗口（同 renderToScreen 算法）
    const totalHeight = this.wrappedHeights.reduce((a, b) => a + b, 0);
    if (totalHeight <= 0) return { line: 0, offset: 0 };

    const maxScroll = Math.max(0, totalHeight - rect.height);
    const clampedOffset = Math.min(this.#scrollOffset, maxScroll);
    const visibleEnd = totalHeight - clampedOffset;
    const visibleStart = Math.max(0, visibleEnd - rect.height);

    // 全局显示行索引
    let displayLine = visibleStart + rowInRect;
    // 边界 clamp
    if (displayLine < 0) displayLine = 0;
    if (displayLine >= totalHeight) displayLine = totalHeight - 1;

    // 遍历 wrappedHeights 找到对应逻辑行
    let accumulated = 0;
    for (let logicalIdx = 0; logicalIdx < this.wrappedHeights.length; logicalIdx++) {
      const height = this.wrappedHeights[logicalIdx] ?? 1;
      if (displayLine < accumulated + height) {
        // 找到目标逻辑行
        const lineOffset = displayLine - accumulated;
        // 计算列偏移（相对 rect 左边界）
        const colInLine = col - 1 - rect.x;
        const clampedCol = Math.max(0, Math.min(colInLine, rect.width - 1));
        const charOffset = lineOffset * rect.width + clampedCol;
        return { line: logicalIdx, offset: charOffset };
      }
      accumulated += height;
    }

    // 兜底：最后一行末尾
    const lastIdx = Math.max(0, this.wrappedHeights.length - 1);
    const lastHeight = this.wrappedHeights[lastIdx] ?? 1;
    return { line: lastIdx, offset: lastHeight * rect.width };
  }

  /** 追加多行内容，返回新追加行中第一行的索引 */
  append(lines: string[]): number {
    const index = this.lines.length;
    const width = this.cacheWidth || 80;

    if (width > 0) {
      for (const line of lines) {
        this.lines.push(line);
        const wrapped = wrapTextWithAnsi(line, width);
        this.lineCache.set(this.lines.length - 1, wrapped);
        this.wrappedHeights.push(wrapped.length);
      }
    } else {
      // cacheWidth 为 0 时不做换行，首次渲染时重建
      this.lines.push(...lines);
      for (const _ of lines) {
        this.wrappedHeights.push(1); // 默认高度 1
      }
    }

    // 非跟随底部模式：增加 scrollOffset 以保持视图稳定
    if (!this.#followBottom) {
      const addedDisplayLines = this.wrappedHeights
        .slice(this.wrappedHeights.length - lines.length)
        .reduce((a, b) => a + b, 0);
      this.#scrollOffset += addedDisplayLines;
    }

    this.evictExcessLines();
    this.invalidate();
    return Math.max(0, index - Math.max(0, this.lines.length - OutputArea.MAX_LINES));
  }

  /** 追加文本到当前行末尾（用于流式输出） */
  appendText(text: string): void {
    const width = this.cacheWidth || 80;

    if (this.lines.length === 0) {
      this.lines.push(text);
      if (width > 0) {
        const wrapped = wrapTextWithAnsi(text, width);
        this.lineCache.set(0, wrapped);
        this.wrappedHeights.push(wrapped.length);
      } else {
        this.wrappedHeights.push(1);
      }
    } else {
      const lastIdx = this.lines.length - 1;
      this.lines[lastIdx] += text;
      this.lineCache.delete(lastIdx);
      if (width > 0) {
        const lineText = this.lines[lastIdx];
        if (lineText !== undefined) {
          this.wrappedHeights[lastIdx] = wrapTextWithAnsi(lineText, width).length;
        }
      }
    }

    // 非跟随底部模式：调整 scrollOffset
    if (!this.#followBottom) {
      const addedHeight =
        width > 0
          ? wrapTextWithAnsi(text, width).length
          : text.includes('\n')
            ? text.split('\n').length
            : 1;
      this.#scrollOffset += addedHeight;
    }

    this.evictExcessLines();
    this.invalidate();
  }

  /** 替换最后一行的完整内容（用于 spinner 动画和首 chunk 替换），返回行索引 */
  replaceLastLine(text: string): number {
    const width = this.cacheWidth || 80;

    if (this.lines.length > 0) {
      const lastIdx = this.lines.length - 1;
      this.lines[lastIdx] = text;
      this.lineCache.delete(lastIdx);
      if (width > 0) {
        this.wrappedHeights[lastIdx] = wrapTextWithAnsi(text, width).length;
      }
    } else {
      this.lines.push(text);
      if (width > 0) {
        const wrapped = wrapTextWithAnsi(text, width);
        this.lineCache.set(0, wrapped);
        this.wrappedHeights.push(wrapped.length);
      } else {
        this.wrappedHeights.push(1);
      }
    }

    this.evictExcessLines();
    this.invalidate();
    return this.lines.length - 1;
  }

  /** 在指定位置插入/删除/替换行（原子操作） */
  spliceLines(startIndex: number, deleteCount: number, insertLines: string[]): void {
    this.lines.splice(startIndex, deleteCount, ...insertLines);

    const width = this.cacheWidth || 80;
    let insertHeights: number[];
    if (width > 0) {
      insertHeights = insertLines.map((line) => wrapTextWithAnsi(line, width).length);
    } else {
      insertHeights = insertLines.map(() => 1);
    }
    this.wrappedHeights.splice(startIndex, deleteCount, ...insertHeights);

    this.invalidateCacheFrom(startIndex);
    this.evictExcessLines();
    this.invalidate();
  }

  /** 更新指定索引行的内容 */
  updateLine(index: number, text: string): void {
    if (index >= 0 && index < this.lines.length) {
      this.lines[index] = text;
      this.lineCache.delete(index);
      const width = this.cacheWidth || 80;
      if (width > 0) {
        this.wrappedHeights[index] = wrapTextWithAnsi(text, width).length;
      }
      this.invalidate();
    }
  }

  /** 清空所有内容 */
  clear(): void {
    this.lines = [];
    this.lineCache.clear();
    this.wrappedHeights = [];
    this.#scrollOffset = 0;
    this.#followBottom = true;
    this.invalidate();
  }

  // -------------------------------------------------------------------------
  // 内部辅助方法
  // -------------------------------------------------------------------------

  /**
   * 渲染选中高亮。
   *
   * 遍历选中区域在可见范围内的 cell，用 stylePool.withSelectionBg() 替换 styleId。
   * 不修改 cell.char，因此 diff 引擎自动检测 styleId 变化，产生轻量 style 补丁。
   */
  #renderSelectionHighlight(screen: Screen, stylePool: StylePool, rect: Rect): void {
    const sel = this.#selection;
    if (!sel) {
      logger.info('SEL render no_selection');
      return;
    }
    logger.info(
      `SEL render startL=${sel.startLine} startO=${sel.startOffset} endL=${sel.endLine} endO=${sel.endOffset}`
    );

    // 归一化：保证 start ≤ end
    const startLine = sel.startLine <= sel.endLine ? sel.startLine : sel.endLine;
    const endLine = sel.startLine <= sel.endLine ? sel.endLine : sel.startLine;
    const startOffset = sel.startLine <= sel.endLine ? sel.startOffset : sel.endOffset;
    const endOffset = sel.startLine <= sel.endLine ? sel.endOffset : sel.startOffset;

    // 计算可见窗口
    const totalHeight = this.wrappedHeights.reduce((a, b) => a + b, 0);
    if (totalHeight <= 0) return;

    const maxScroll = Math.max(0, totalHeight - rect.height);
    const clampedOffset = Math.min(this.#scrollOffset, maxScroll);
    const visibleEnd = totalHeight - clampedOffset;
    const visibleStart = Math.max(0, visibleEnd - rect.height);

    const W = rect.width;

    // 遍历选择范围内的逻辑行
    let accumulated = 0;
    for (let ll = 0; ll < this.wrappedHeights.length; ll++) {
      const h = this.wrappedHeights[ll] ?? 1;
      const dlStart = accumulated;
      const dlEnd = accumulated + h;

      // 超出选择范围 → 结束
      if (ll > endLine) break;
      // 未到选择范围 → 跳过
      if (ll < startLine) {
        accumulated = dlEnd;
        continue;
      }
      // 完全不可见 → 跳过
      if (dlEnd <= visibleStart || dlStart >= visibleEnd) {
        accumulated = dlEnd;
        continue;
      }

      // 计算本逻辑行的选中字符范围
      let charStart: number;
      let charEnd: number;
      if (ll === startLine && ll === endLine) {
        // 单行选择
        charStart = startOffset;
        charEnd = endOffset;
      } else if (ll === startLine) {
        // 多行选择的首行
        charStart = startOffset;
        charEnd = h * W;
      } else if (ll === endLine) {
        // 多行选择的末行
        charStart = 0;
        charEnd = endOffset;
      } else {
        // 中间行：整行选中
        charStart = 0;
        charEnd = h * W;
      }

      // 遍历每个显示子行
      for (let wi = 0; wi < h; wi++) {
        const globalDl = dlStart + wi;
        if (globalDl < visibleStart || globalDl >= visibleEnd) continue;

        // 本子行的字符范围
        const wiStart = wi * W;
        const wiEnd = (wi + 1) * W;

        // 与选择范围求交集
        const selStart = Math.max(wiStart, charStart) - wiStart;
        const selEnd = Math.min(wiEnd, charEnd) - wiStart;

        if (selStart >= selEnd || selStart >= W) continue;

        const screenRow = rect.y + (globalDl - visibleStart);
        const colStart = Math.min(selStart, W);
        const colEnd = Math.min(selEnd, W);

        for (let c = colStart; c < colEnd; c++) {
          const screenCol = rect.x + c;
          const cell = screen.getCell(screenCol, screenRow);
          // 高亮所有单元格（含空单元格），确保选区背景覆盖整行
          const newStyleId = stylePool.withSelectionBg(cell.styleId);
          screen.setCell(screenCol, screenRow, cell.char || ' ', newStyleId, cell.width);
        }
      }

      accumulated = dlEnd;
    }
  }

  /** 复制选中文本到系统剪贴板 */
  #copySelection(): void {
    const text = this.getSelectedText();
    if (!text) return;
    const seq = setClipboard(text);
    if (seq) {
      process.stdout.write(seq);
    }
  }

  /**
   * 获取或创建指定逻辑行的换行缓存。
   * cacheWidth 为 0 时返回原始行（未换行）。
   */
  private getOrCreateWrappedLine(index: number): string[] {
    if (this.cacheWidth <= 0) return [this.lines[index] ?? ''];
    let cached = this.lineCache.get(index);
    if (!cached) {
      cached = wrapTextWithAnsi(this.lines[index] ?? '', this.cacheWidth);
      this.lineCache.set(index, cached);
    }
    return cached;
  }

  /**
   * 用新宽度重建所有换行缓存和高度数组。
   * 在终端宽度变化时调用。
   */
  private rebuildAllWraps(width: number): void {
    this.cacheWidth = width;
    this.lineCache.clear();
    this.wrappedHeights = this.lines.map((line) => wrapTextWithAnsi(line, width).length);
  }

  /**
   * 行数超限逐出。
   * 当 lines 超过 MAX_LINES 时，丢弃最早的行并调整 scrollOffset。
   */
  private evictExcessLines(): void {
    if (this.lines.length <= OutputArea.MAX_LINES) return;

    const evictCount = this.lines.length - OutputArea.MAX_LINES;
    const evictedDisplayHeight = this.wrappedHeights
      .slice(0, evictCount)
      .reduce((a, b) => a + b, 0);

    this.lines.splice(0, evictCount);
    this.wrappedHeights.splice(0, evictCount);
    // 所有行索引已偏移 → 清空缓存
    this.lineCache.clear();

    if (!this.#followBottom) {
      this.#scrollOffset = Math.max(0, this.#scrollOffset - evictedDisplayHeight);
      if (this.#scrollOffset === 0) {
        this.#followBottom = true;
      }
    }
  }

  /** 使从指定索引开始的所有缓存行失效 */
  private invalidateCacheFrom(startIndex: number): void {
    for (const key of this.lineCache.keys()) {
      if (key >= startIndex) {
        this.lineCache.delete(key);
      }
    }
  }
}
