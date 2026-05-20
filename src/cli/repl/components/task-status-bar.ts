/**
 * TaskStatusBar — 任务状态栏组件
 *
 * 显示 TaskManage 创建的任务列表，支持折叠/展开两种模式。
 * 类似 Claude Code 的 TaskListV2，使用 pi-tui Container 实现。
 *
 * 有任务时始终展开（多行）:
 *   ⠋ #1 Search files
 *   ◻ #2 Core logic
 *   ◻ #3 Tests                     ▸ blocked by #1
 *   ✔ #4 Analysis
 *
 *   1 in_progress · 1 pending · 1 completed
 *
 * 自动隐藏：无任务时 render() 返回 []。
 * 进行中任务：显示 loading spinner 动画 + cyan 高亮。
 * 已完成任务：绿色 + 删除线。
 *
 * @module cli/repl/components
 */

import chalk from 'chalk';
import type { AnimationManager } from '@/cli/repl/utils/animation-manager';
import { Container } from '@/cli/tui';
import type { TaskStore } from '@/core/task/task-store';
import type { TaskItem, TaskManageSummary } from '@/core/task/types';

/** Loading 动画帧（Braille 模式 spinner） */
const LOADING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const LOADING_INTERVAL_MS = 200;

/** 静态状态图标映射 */
const STATUS_ICONS: Record<string, string> = {
  pending: '\u25FB', // ◻
  in_progress: '\u25FC', // ◼
  completed: '\u2714', // ✔
  cancelled: '\u2715', // ✕
};

/**
 * 任务状态栏组件
 *
 * 从 TaskStore 读取任务列表，渲染为紧凑状态栏。
 * 固定在 OutputArea 和 AgentStatusBar 之间。
 */
export class TaskStatusBar extends Container {
  /** AnimationManager 实例（用于渲染周期驱动的动画） */
  #animationManager: AnimationManager;

  /** TaskStore 引用（只读，不写） */
  #store: TaskStore;

  /** loading 动画帧索引 */
  #loadingFrame = 0;

  /** AnimationManager 回调注销函数 */
  #unregLoading: (() => void) | null = null;
  /** 上次帧推进时间戳 */
  #lastLoadingTick = 0;

  /** 上次是否有 in_progress 任务（用于启停动画） */
  #hadInProgress = false;

  constructor(store: TaskStore, animationManager: AnimationManager) {
    super();
    this.#store = store;
    this.#animationManager = animationManager;
  }

  /** 当前是否处于展开状态 */
  get isExpanded(): boolean {
    const summary = this.#store.summary();
    return this.#shouldExpand(summary);
  }

  /**
   * 当 TaskStore 变化时由外部调用
   */
  onTasksChanged(): void {
    this.invalidate();
  }

  override invalidate(): void {
    super.invalidate();
  }

  /** 判断当前是否应展开（有任务时始终展开） */
  #shouldExpand(summary: { total: number }): boolean {
    return summary.total > 0;
  }

  /**
   * 管理 loading 动画的启停
   *
   * 当有 in_progress 任务时启动 spinner，全部完成后停止。
   */
  #updateLoading(summary: TaskManageSummary): void {
    const hasInProgress = summary.in_progress > 0;

    if (hasInProgress && !this.#hadInProgress) {
      // 从无到有：启动动画
      this.#startLoading();
    } else if (!hasInProgress && this.#hadInProgress) {
      // 从有到无：停止动画
      this.#stopLoading();
    }
    // 注意：#hadInProgress 不在此处更新，由 render 在调用 #updateLoading 之后设置
  }

  /** 启动 loading 动画（由 animationManager 在渲染周期中驱动） */
  #startLoading(): void {
    if (this.#unregLoading) return;
    this.#lastLoadingTick = 0;
    this.#unregLoading = this.#animationManager.register((now) => {
      if (now - this.#lastLoadingTick < LOADING_INTERVAL_MS) return;
      this.#lastLoadingTick = now;
      this.#loadingFrame = (this.#loadingFrame + 1) % LOADING_FRAMES.length;
      this.invalidate();
    });
  }

  /** 停止 loading 动画 */
  #stopLoading(): void {
    if (this.#unregLoading) {
      this.#unregLoading();
      this.#unregLoading = null;
    }
    this.#loadingFrame = 0;
  }

  /** 获取当前 in_progress 的图标（可能为动画帧） */
  #getInProgressIcon(): string {
    const idx = this.#loadingFrame % LOADING_FRAMES.length;
    return LOADING_FRAMES[idx]!;
  }

  override render(width: number): string[] {
    const tasks = this.#store.read();
    const summary = this.#store.summary();

    // 管理 loading 动画
    this.#updateLoading(summary);
    this.#hadInProgress = summary.in_progress > 0;

    // 无任务时自动隐藏
    if (tasks.length === 0) {
      this.#stopLoading();
      return [];
    }

    if (this.#shouldExpand(summary)) {
      return this.#renderExpanded(tasks, summary, width);
    }

    // 折叠模式：全部完成时显示简洁摘要，或用户手动折叠
    const line = this.#renderCollapsed(summary);
    return [line.slice(0, width)];
  }

  /** 渲染折叠模式单行 */
  #renderCollapsed(summary: TaskManageSummary): string {
    const parts: string[] = [];

    // 📋 N tasks
    const taskCount = summary.total === 1 ? '1 task' : `${summary.total} tasks`;
    parts.push(chalk.cyan(`\uD83D\uDCCB ${taskCount}`));

    // spinner N in_progress（折叠模式也用动画帧）
    if (summary.in_progress > 0) {
      const icon = this.#getInProgressIcon();
      parts.push(chalk.cyan(`${icon} ${summary.in_progress} in_progress`));
    }

    // ◻ N pending
    if (summary.pending > 0) {
      parts.push(`${STATUS_ICONS.pending} ${summary.pending} pending`);
    }

    // ✔ N completed
    if (summary.completed > 0) {
      parts.push(chalk.green(`${STATUS_ICONS.completed} ${summary.completed} completed`));
    }

    // ✕ N cancelled
    if (summary.cancelled > 0) {
      parts.push(chalk.red.dim(`${STATUS_ICONS.cancelled} ${summary.cancelled} cancelled`));
    }

    const line = `  ${parts.join(' · ')}`;
    return line;
  }

  /** 渲染展开模式多行 */
  #renderExpanded(tasks: TaskItem[], summary: TaskManageSummary, width: number): string[] {
    const lines: string[] = [];

    // 排序：in_progress → pending(未阻塞优先) → completed(最近优先) → cancelled
    const sorted = this.#sortTasks(tasks);

    // 渲染每个任务
    for (const task of sorted) {
      lines.push(this.#renderTaskLine(task, width));
    }

    // 空行分隔
    lines.push('');

    // 底部摘要
    const summaryParts: string[] = [];
    if (summary.in_progress > 0) {
      summaryParts.push(chalk.cyan(`${summary.in_progress} in_progress`));
    }
    if (summary.pending > 0) {
      summaryParts.push(`${summary.pending} pending`);
    }
    if (summary.completed > 0) {
      summaryParts.push(chalk.green(`${summary.completed} completed`));
    }
    if (summary.cancelled > 0) {
      summaryParts.push(chalk.red.dim(`${summary.cancelled} cancelled`));
    }
    lines.push(`  ${summaryParts.join(' · ')}`);

    return lines;
  }

  /** 渲染单个任务行 */
  #renderTaskLine(task: TaskItem, width: number): string {
    // 根据状态选择图标：in_progress 使用动画帧，其他使用静态图标
    const icon =
      task.status === 'in_progress'
        ? this.#getInProgressIcon()
        : (STATUS_ICONS[task.status] ?? '?');
    const prefix = `  ${icon} #${task.id} `;

    // 阻塞提示
    const blockedBy = this.#getBlockedHint(task);

    // 计算标题可用宽度
    const blockedText = blockedBy ? `  ${blockedBy}` : '';
    const availableWidth = Math.max(10, width - [...prefix].length - [...blockedText].length);
    const subject =
      task.subject.length > availableWidth
        ? `${task.subject.slice(0, availableWidth - 1)}\u2026`
        : task.subject;

    // 样式化内容：颜色 + 加粗/删除线
    let subjectStyled: string;
    if (task.status === 'completed') {
      subjectStyled = chalk.green.dim.strikethrough(subject);
    } else if (task.status === 'in_progress') {
      subjectStyled = chalk.cyan.bold(subject);
    } else if (task.status === 'cancelled') {
      subjectStyled = chalk.red.dim(subject);
    } else {
      subjectStyled = subject;
    }

    // 右侧样式化
    const rightStyled = blockedBy ? chalk.dim(blockedBy) : '';

    const line = `${prefix}${subjectStyled}${blockedBy ? `  ${rightStyled}` : ''}`;
    return line.slice(0, width);
  }

  /** 获取阻塞提示文本 */
  #getBlockedHint(task: TaskItem): string {
    if (!task.dependencies || task.dependencies.length === 0) {
      return '';
    }

    // 只对 pending 任务显示阻塞提示
    if (task.status !== 'pending') {
      return '';
    }

    const allTasks = this.#store.read();
    const openBlockers: string[] = [];

    for (const depId of task.dependencies) {
      const depTask = allTasks.find((t) => t.id === depId);
      if (depTask && depTask.status !== 'completed') {
        openBlockers.push(`#${depId}`);
      } else if (!depTask) {
        // 依赖任务不存在也视为阻塞
        openBlockers.push(`#${depId}?`);
      }
    }

    if (openBlockers.length === 0) {
      return '';
    }

    return `\u25B8 blocked by ${openBlockers.join(', ')}`;
  }

  /** 排序任务 */
  #sortTasks(tasks: TaskItem[]): TaskItem[] {
    const allTasks = this.#store.read();

    return [...tasks].sort((a, b) => {
      // 优先级排序
      const priorityA = this.#taskPriority(a, allTasks);
      const priorityB = this.#taskPriority(b, allTasks);
      return priorityA - priorityB;
    });
  }

  /** 计算任务优先级（值越小越靠前） */
  #taskPriority(task: TaskItem, allTasks: TaskItem[]): number {
    switch (task.status) {
      case 'in_progress':
        return 0;
      case 'pending': {
        // 未阻塞的 pending 优先于阻塞的
        if (this.#isBlocked(task, allTasks)) {
          return 2;
        }
        return 1;
      }
      case 'completed':
        // 最近完成的优先
        return 10 - Date.now() + task.updatedAt;
      case 'cancelled':
        return 20;
      default:
        return 100;
    }
  }

  /** 判断任务是否被阻塞 */
  #isBlocked(task: TaskItem, allTasks: TaskItem[]): boolean {
    if (!task.dependencies || task.dependencies.length === 0) {
      return false;
    }
    return task.dependencies.some((depId) => {
      const depTask = allTasks.find((t) => t.id === depId);
      return !depTask || depTask.status !== 'completed';
    });
  }
}
