/**
 * Agent 状态栏组件
 *
 * 实时显示正在运行的子 Agent 状态，类似 Claude Code 的 "Running N agents…" 效果。
 * 支持每个 Agent 的工具调用历史展示、分组摘要、"+N more" 折叠展开。
 * 固定在 OutputArea 和 Editor 之间，无活跃 Agent 时自动隐藏。
 *
 * @module cli/repl/components
 */

import { Container, truncateToWidth } from '@mariozechner/pi-tui';
import chalk from 'chalk';
import { getAgentInstanceManager } from '@/core/agent-team/agent-instance-manager';
import {
  buildToolCallGroups,
  countHiddenToolUses,
} from '@/core/agent-team/agent-progress-processor';
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

/** 每个 Agent 默认显示的 Tool Call 分组数 */
const MAX_VISIBLE_GROUPS = 5;

/** 折叠状态下每个 Agent 显示的工具行数 */
const VISIBLE_TOOL_LINES_COLLAPSED = 1;

/**
 * Agent 状态栏组件
 *
 * 从 AgentInstanceManager 读取活跃实例状态，渲染为紧凑状态栏。
 */
export class AgentStatusBar extends Container {
  /** 是否展开显示详情 */
  #expanded = false;

  /** 按实例的工具调用列表展开状态 */
  #agentExpanded: Map<string, boolean> = new Map();

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
   *
   * @param instanceId - 指定实例 ID 时，切换该实例的工具调用列表展开/折叠；不传时切换整体状态栏
   */
  toggle(instanceId?: string): void {
    if (instanceId) {
      const current = this.#agentExpanded.get(instanceId) ?? false;
      this.#agentExpanded.set(instanceId, !current);
    } else {
      this.#expanded = !this.#expanded;
      if (!this.#expanded) {
        this.#agentExpanded.clear();
      }
    }
    this.invalidate();
  }

  /** 展开/折叠当前活跃 Agent 的工具调用详情 */
  toggleActiveAgentDetails(): void {
    const instanceManager = getAgentInstanceManager();
    const active = instanceManager.listActive();
    if (active.length === 0) return;
    // 展开/折叠第一个活跃 Agent
    const first = active[0];
    if (first) {
      this.toggle(first.instanceId);
    }
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
        return [truncateToWidth(this.#renderTokenInfoLine(), width)];
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
        truncateToWidth(
          this.#renderCollapsed(frame, activeInstances.length, totalToolUses, totalDuration),
          width
        )
      );
      if (this.hasTokenInfo) {
        lines.push(truncateToWidth(this.#renderTokenInfoLine(), width));
      }
      return lines;
    }

    // 展开模式：显示每个 Agent 详情
    const lines = this.#renderExpanded(frame, activeInstances, width);
    // 有 Token 信息时追加到末尾
    if (this.hasTokenInfo) {
      lines.push(truncateToWidth(this.#renderTokenInfoLine(), width));
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
    lines.push(truncateToWidth(`${header}  ${hint}`, width));

    // 每个 Agent 的详情行
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]!;
      const isLast = i === instances.length - 1;
      const connector = isLast ? TREE_LAST : TREE_BRANCH;
      const childPrefix = isLast ? TREE_SPACE : TREE_PIPE;

      const agentLines = this.#renderAgentDetail(inst, connector, childPrefix, width);
      lines.push(...agentLines);
    }

    return lines;
  }

  /**
   * 渲染单个 Agent 的详情（header + 工具调用列表）
   */
  #renderAgentDetail(
    inst: AgentInstance,
    connector: string,
    childPrefix: string,
    width: number
  ): string[] {
    const lines: string[] = [];
    const icon = STATUS_ICONS[inst.status] ?? '?';
    const statusColor = inst.status === 'running' ? chalk.yellow : chalk.gray;
    const typeLabel = chalk.bold(inst.typeId);
    const taskPreview = inst.task.description.slice(0, 40);
    const act = inst.currentActivity;

    // 第一行：类型 + 任务 + tool uses + duration
    const toolUsesStr = act ? chalk.gray(`\u00B7 ${act.toolUses} tool uses`) : '';
    const durationStr = chalk.gray(`\u00B7 ${this.#formatDuration(Date.now() - inst.createdAt)}`);
    const line1 = `  ${chalk.dim(connector)}${statusColor(icon)}${chalk.reset} ${typeLabel}  ${chalk.dim(taskPreview)}  ${toolUsesStr} ${durationStr}`;
    lines.push(truncateToWidth(line1, width));

    // 工具调用详情
    const isExpanded = this.#agentExpanded.get(inst.instanceId) ?? false;
    if (isExpanded && inst.toolCallHistory.length > 0) {
      // 展开模式：显示分组后的工具调用
      const groups = buildToolCallGroups(inst.toolCallHistory);
      const { visibleGroups, hiddenCount } = countHiddenToolUses(groups, MAX_VISIBLE_GROUPS);

      for (const group of visibleGroups) {
        if (group.count === 1 && group.calls.length === 1) {
          // 单个工具调用：显示工具名和参数
          const call = group.calls[0]!;
          const statusMark =
            call.status === 'completed'
              ? chalk.green('\u2713 ')
              : call.status === 'failed'
                ? chalk.red('\u2715 ')
                : '';
          const display = call.argsDisplay
            ? `${call.toolName}: ${call.argsDisplay}`
            : call.toolName;
          lines.push(
            truncateToWidth(
              `  ${chalk.dim(childPrefix + TREE_CONT)}${statusMark}${chalk.cyan(display)}`,
              width
            )
          );
        } else {
          // 分组摘要：显示 "Label N items (e.g. sample)"
          const firstCall = group.calls[0];
          const sampleArg = firstCall?.argsDisplay
            ? ` (e.g. ${firstCall.argsDisplay.slice(0, 40)})`
            : '';
          const summary = `${group.label} ${group.count} item${group.count > 1 ? 's' : ''}${sampleArg}`;
          lines.push(
            truncateToWidth(`  ${chalk.dim(childPrefix + TREE_CONT)}${chalk.cyan(summary)}`, width)
          );
        }
      }

      // "+N more" 提示
      if (hiddenCount > 0) {
        lines.push(
          truncateToWidth(
            `  ${chalk.dim(childPrefix + TREE_SPACE)}${chalk.dim(`+${hiddenCount} more tool uses (${chalk.italic('ctrl+o to expand')})`)}`,
            width
          )
        );
      }
    } else if (inst.toolCallHistory.length > 0) {
      // 折叠模式：仅显示最近的工具调用
      const recent = inst.toolCallHistory[inst.toolCallHistory.length - 1];
      if (recent) {
        const display = recent.argsDisplay
          ? `${recent.toolName}: ${recent.argsDisplay}`
          : recent.toolName;
        lines.push(
          truncateToWidth(`  ${chalk.dim(childPrefix + TREE_CONT)}${chalk.cyan(display)}`, width)
        );

        // "+N more" 提示（隐藏的工具调用）
        const hiddenCount = inst.toolCallHistory.length - VISIBLE_TOOL_LINES_COLLAPSED;
        if (hiddenCount > 0) {
          lines.push(
            truncateToWidth(
              `  ${chalk.dim(childPrefix + TREE_SPACE)}${chalk.dim(`+${hiddenCount} more tool uses (${chalk.italic('ctrl+o to expand')})`)}`,
              width
            )
          );
        }
      }
    } else if (act) {
      // 无历史但有当前活动：显示当前工具
      const toolDisplay = act.args ? `${act.toolName}: ${act.args.slice(0, 60)}` : act.toolName;
      lines.push(
        truncateToWidth(`  ${chalk.dim(childPrefix + TREE_CONT)}${chalk.cyan(toolDisplay)}`, width)
      );
    }

    // 后台提示（仅在运行时显示）
    if (inst.status === 'running') {
      lines.push(
        truncateToWidth(
          `  ${chalk.dim(childPrefix + TREE_SPACE)}${chalk.dim('(ctrl+b to run in background)')}`,
          width
        )
      );
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
