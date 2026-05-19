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
import { buildToolCallGroups } from '@/core/agent-team/agent-progress-processor';
import type { AgentInstance } from '@/core/agent-team/types';

/** 状态图标映射 — 纯文字符号，无 emoji */
const STATUS_ICONS: Record<string, string> = {
  idle: '\u25CB', // ○
  running: '\u25CF', // ●
  paused: '\u25D0', // ◐
  completed: '\u2714', // ✔
  failed: '\u2718', // ✘
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

/** 工具名 → 可读动词描述 */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  AgentTool: '派发子任务',
  Grep: '搜索代码',
  ReadFile: '读取文件',
  Glob: '查找文件',
  Exec: '执行命令',
  WriteFile: '写入文件',
  EditFile: '编辑文件',
  WebFetch: '抓取网页',
  WebSearch: '搜索网络',
  SendMessage: '发送消息',
  TaskStop: '停止任务',
};

/** 获取工具的可读描述 */
function getToolDescription(toolName: string): string {
  return TOOL_DESCRIPTIONS[toolName] ?? toolName;
}

/**
 * Agent 状态栏组件
 *
 * 从 AgentInstanceManager 读取活跃实例状态，渲染为紧凑状态栏。
 */
export class AgentStatusBar extends Container {
  /** 是否展开显示详情（默认展开） */
  #expanded = true;

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
  #renderCollapsed(frame: string, count: number, _toolUses: number, duration: string): string {
    return `  ${chalk.cyan(`${frame} ${count} agent${count > 1 ? 's' : ''}`)} ${chalk.gray(`· ${duration}`)}`;
  }

  /** 渲染展开模式多行 */
  #renderExpanded(frame: string, instances: AgentInstance[], width: number): string[] {
    const lines: string[] = [];
    const count = instances.length;

    // 标题行
    const totalDuration = this.#formatDuration(
      Math.max(...instances.map((i) => Date.now() - i.createdAt))
    );
    const header = chalk.cyan(
      `  ${frame} ${count} agent${count > 1 ? 's' : ''} · ${totalDuration}`
    );
    lines.push(truncateToWidth(header, width));

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
    const act = inst.currentActivity;

    // === 构建当前活动描述 ===
    let activityDesc = '';
    if (act) {
      // 有当前活动：显示工具描述
      activityDesc = `正在${getToolDescription(act.toolName)}`;
    } else {
      // 没有当前活动：检查工具调用历史
      const totalCalls = inst.toolCallHistory.length;
      if (totalCalls > 0) {
        const allCompleted = inst.toolCallHistory.every(
          (t) => t.status === 'completed' || t.status === 'failed'
        );
        if (allCompleted) {
          activityDesc = `已完成 ${totalCalls} 次调用`;
        }
      }
    }

    // === 第一行：图标 + 类型 + 活动描述 + 耗时 ===
    const duration = chalk.gray(`· ${this.#formatDuration(Date.now() - inst.createdAt)}`);
    let line1: string;
    if (activityDesc) {
      line1 = `  ${chalk.dim(connector)}${statusColor(icon)} ${typeLabel} ${chalk.dim(`· ${activityDesc}`)} ${duration}`;
    } else {
      line1 = `  ${chalk.dim(connector)}${statusColor(icon)} ${typeLabel} ${duration}`;
    }
    lines.push(truncateToWidth(line1, width));

    // === 第二行（可选）：工具调用历史摘要 ===
    // 只有当有工具调用历史且没有当前活动时才显示摘要
    const totalCalls = inst.toolCallHistory.length;
    if (totalCalls > 0 && !act) {
      // 按工具类型分组，只显示一次汇总
      const groups = buildToolCallGroups(inst.toolCallHistory);
      const summaries = groups.map((g) => `${getToolDescription(g.label)} ${g.count}次`);
      if (summaries.length > 0) {
        lines.push(
          truncateToWidth(
            `  ${chalk.dim(childPrefix + TREE_SPACE)}${chalk.dim(summaries.join('  '))}`,
            width
          )
        );
      }
    } else if (totalCalls > 0 && act) {
      // 有当前活动：也显示总调用数
      lines.push(
        truncateToWidth(
          `  ${chalk.dim(childPrefix + TREE_SPACE)}${chalk.dim(`已完成 ${totalCalls} 次工具调用`)}`,
          width
        )
      );
    }

    // === 后台运行提示 ===
    if (inst.status === 'running' && !act) {
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
