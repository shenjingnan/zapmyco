/**
 * Agent 状态栏组件
 *
 * 实时显示正在运行的子 Agent 状态，类似 Claude Code 的 "Running N agents…" 效果。
 * 固定在 OutputArea 和 Editor 之间，无活跃 Agent 时自动隐藏。
 *
 * @module cli/repl/components
 */

import { Container } from '@mariozechner/pi-tui';
import chalk from 'chalk';
import { getAgentInstanceManager } from '@/core/agent-team/agent-instance-manager';
import type { AgentInstance } from '@/core/agent-team/types';

/** 状态图标映射 */
const STATUS_ICONS: Record<string, string> = {
  idle: '\u25CB', // ○
  running: '\u25C9', // ◉
  paused: '\u25D0', // ◐
  completed: '\u25CF', // ●
  failed: '\u2715', // ✕
  cancelled: '\u25CC', // ◌
};

/** Loading 动画帧 */
const LOADING_FRAMES = [
  '\u280B',
  '\u2819',
  '\u2839',
  '\u2838',
  '\u283C',
  '\u2834',
  '\u2826',
  '\u2827',
  '\u2807',
  '\u280F',
];
const LOADING_INTERVAL_MS = 200;

/** 树形连接线 */
const TREE_BRANCH = '\u251C\u2500\u2500 '; // ├──
const TREE_LAST = '\u2514\u2500\u2500 '; // └──
const TREE_PIPE = '\u2502   '; // │
const TREE_SPACE = '    '; // (空格缩进)
const TREE_CONT = '\u23BF  '; // ⎿

/**
 * Agent 状态栏组件
 *
 * 从 AgentInstanceManager 读取活跃实例状态，渲染为紧凑状态栏。
 */
export class AgentStatusBar extends Container {
  /** 是否展开显示详情 */
  #expanded = false;

  /** loading 动画帧索引 */
  #loadingFrame = 0;

  /** loading 动画定时器 */
  #loadingTimer: ReturnType<typeof setInterval> | undefined;

  /** 上次活跃实例快照（用于检测变化） */
  #lastActiveCount = 0;

  // === Token 信息 ===
  /** 当前模型名称 */
  #modelName: string | null = null;
  /** 累积非缓存 input tokens（usage.input = totalInput - cacheRead） */
  #inputTokens = 0;
  /** 累积 cache read tokens（缓存命中） */
  #cacheReadTokens = 0;
  /** 累积 output tokens */
  #outputTokens = 0;
  /** 任务已耗时（ms） */
  #durationMs = 0;

  /**
   * 切换展开/折叠状态
   */
  toggle(): void {
    this.#expanded = !this.#expanded;
    this.invalidate();
  }

  /** 获取当前展开状态 */
  get isExpanded(): boolean {
    return this.#expanded;
  }

  /**
   * 设置当前模型名称
   */
  setModelName(name: string): void {
    this.#modelName = name;
    this.invalidate();
  }

  /**
   * 更新 Token 统计数据
   *
   * @param inputTokens - 非缓存 input tokens（usage.input）
   * @param cacheRead - 缓存读取 tokens（usage.cacheRead）
   * @param outputTokens - 输出 tokens
   * @param durationMs - 任务已耗时（毫秒）
   */
  updateTokenStats(
    inputTokens: number,
    cacheRead: number,
    outputTokens: number,
    durationMs?: number
  ): void {
    this.#inputTokens = inputTokens;
    this.#cacheReadTokens = cacheRead;
    this.#outputTokens = outputTokens;
    if (durationMs !== undefined) {
      this.#durationMs = durationMs;
    }
    this.invalidate();
  }

  /**
   * 清除 Token 数据（执行结束后调用）
   */
  clearTokenStats(): void {
    this.#modelName = null;
    this.#inputTokens = 0;
    this.#cacheReadTokens = 0;
    this.#outputTokens = 0;
    this.invalidate();
  }

  /** 是否有 Token 信息要显示 */
  get hasTokenInfo(): boolean {
    return this.#modelName !== null;
  }

  override invalidate(): void {
    super.invalidate();
  }

  override render(width: number): string[] {
    const instanceManager = getAgentInstanceManager();
    const activeInstances = instanceManager.listActive();

    // 无活跃实例时
    if (activeInstances.length === 0) {
      this.#stopLoading();
      this.#lastActiveCount = 0;
      // 如果有 Token 信息，单独显示 Token 行
      if (this.hasTokenInfo) {
        return [this.#renderTokenInfoLine().slice(0, width)];
      }
      return [];
    }

    // 从无到有：启动 loading 动画
    if (this.#lastActiveCount === 0) {
      this.#startLoading();
    }
    this.#lastActiveCount = activeInstances.length;

    // 计算汇总统计
    const totalToolUses = activeInstances.reduce((sum, inst) => {
      return sum + (inst.currentActivity?.toolUses ?? 0);
    }, 0);
    const totalDuration = this.#formatDuration(
      Math.max(...activeInstances.map((i) => Date.now() - i.createdAt))
    );
    const frame = LOADING_FRAMES[this.#loadingFrame % LOADING_FRAMES.length] ?? '';

    if (!this.#expanded) {
      // 折叠模式：单行显示 Agent + 可选的 Token 信息行
      const lines: string[] = [];
      lines.push(
        this.#renderCollapsed(frame, activeInstances.length, totalToolUses, totalDuration).slice(
          0,
          width
        )
      );
      if (this.hasTokenInfo) {
        lines.push(this.#renderTokenInfoLine().slice(0, width));
      }
      return lines;
    }

    // 展开模式：显示每个 Agent 详情
    const lines = this.#renderExpanded(frame, activeInstances, width);
    // 有 Token 信息时追加到末尾
    if (this.hasTokenInfo) {
      lines.push(this.#renderTokenInfoLine().slice(0, width));
    }
    return lines;
  }

  /** 渲染折叠模式单行 */
  #renderCollapsed(frame: string, count: number, toolUses: number, duration: string): string {
    const countStr = chalk.cyan(`${frame} Running ${count} agent${count > 1 ? 's' : ''}...`);
    const statsStr = chalk.gray(
      `\u00B7 ${toolUses} tool use${toolUses !== 1 ? 's' : ''} \u00B7 ${duration}`
    );
    const hintStr = chalk.dim('(ctrl+o to expand)');
    return `  ${countStr} ${statsStr}  ${hintStr}`;
  }

  /** 渲染展开模式多行 */
  #renderExpanded(frame: string, instances: AgentInstance[], width: number): string[] {
    const lines: string[] = [];
    const count = instances.length;

    // 标题行
    const header = chalk.cyan(`  ${frame} Running ${count} agent${count > 1 ? 's' : ''}...`);
    const hint = chalk.dim('(ctrl+o to collapse)');
    lines.push(`${header}  ${hint}`.slice(0, width));

    // 每个 Agent 的详情行
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]!;
      const isLast = i === instances.length - 1;
      const connector = isLast ? TREE_LAST : TREE_BRANCH;
      const childPrefix = isLast ? TREE_SPACE : TREE_PIPE;

      const icon = STATUS_ICONS[inst.status] ?? '?';
      const statusColor = inst.status === 'running' ? chalk.yellow : chalk.gray;
      const typeLabel = chalk.bold(inst.typeId);
      const taskPreview = inst.task.description.slice(0, 40);
      const act = inst.currentActivity;

      // 第一行：类型 + 任务 + tool uses + tokens
      const toolUsesStr = act ? chalk.gray(`\u00B7 ${act.toolUses} tool uses`) : '';
      const durationStr = chalk.gray(`\u00B7 ${this.#formatDuration(Date.now() - inst.createdAt)}`);
      const line1 = `  ${chalk.dim(connector)}${statusColor(icon)}${chalk.reset} ${typeLabel}  ${chalk.dim(taskPreview)}  ${toolUsesStr} ${durationStr}`;
      lines.push(line1.slice(0, width));

      // 第二行：当前工具调用（如果有）
      if (act) {
        const toolDisplay = act.args ? `${act.toolName}: ${act.args.slice(0, 60)}` : act.toolName;
        const line2 = `  ${chalk.dim(childPrefix + TREE_CONT)}${chalk.cyan(toolDisplay)}`;
        lines.push(line2.slice(0, width));
      }
    }

    return lines;
  }

  /** 启动 loading 动画 */
  #startLoading(): void {
    if (this.#loadingTimer) return;
    this.#loadingTimer = setInterval(() => {
      this.#loadingFrame = (this.#loadingFrame + 1) % LOADING_FRAMES.length;
      this.invalidate();
    }, LOADING_INTERVAL_MS);
  }

  /** 停止 loading 动画 */
  #stopLoading(): void {
    if (this.#loadingTimer) {
      clearInterval(this.#loadingTimer);
      this.#loadingTimer = undefined;
    }
  }

  /** 格式化持续时间为可读字符串 */
  #formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m${secs}s`;
  }

  /** 格式化 Token 数字
   *
   * - < 1,000: 原始数字（456）
   * - ≥ 1,000: 千分位分隔（1,234）
   * - ≥ 10,000: K 单位（15.3K）
   * - ≥ 1,000,000: M 单位（1.2M）
   */
  #formatTokenCount(n: number): string {
    if (n >= 1_000_000) {
      return `${(n / 1_000_000).toFixed(1)}M`;
    }
    if (n >= 10_000) {
      return `${(n / 1_000).toFixed(1)}K`;
    }
    return n.toLocaleString();
  }

  /** 渲染 Token 信息行 */
  #renderTokenInfoLine(): string {
    const modelStr = chalk.cyan(this.#modelName ?? '');
    const separator = chalk.gray(' · ');

    // 在 pi-ai 中：usage.input = 非缓存输入, usage.cacheRead = 缓存命中
    // 所以总输入 = input + cacheRead, 缓存未命中 = input
    const totalInput = this.#inputTokens + this.#cacheReadTokens;
    const missTokens = this.#inputTokens; // 非缓存部分
    const cacheRate = totalInput > 0 ? Math.round((this.#cacheReadTokens / totalInput) * 100) : 0;

    const inStr = chalk.white(this.#formatTokenCount(totalInput));
    const hitStr = chalk.green(this.#formatTokenCount(this.#cacheReadTokens));
    const rateStr = cacheRate >= 80 ? chalk.green(`${cacheRate}%`) : chalk.yellow(`${cacheRate}%`);
    const missStr = chalk.yellow(this.#formatTokenCount(missTokens));
    const outStr = chalk.cyan(this.#formatTokenCount(this.#outputTokens));
    const durationStr = chalk.magenta(this.#formatDuration(this.#durationMs));

    return `  ${modelStr}${separator}${chalk.gray('IN')} ${inStr}${separator}${chalk.gray('HIT')} ${hitStr} ${chalk.dim(`(${rateStr})`)}${separator}${chalk.gray('MISS')} ${missStr}${separator}${chalk.gray('OUT')} ${outStr}${separator}${durationStr}`;
  }
}
