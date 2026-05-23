/**
 * InkTaskStatusBar — 任务状态栏组件（Ink 版）
 *
 * 显示 TaskManage 创建的任务列表，支持折叠/展开两种模式。
 * 从 TaskStore 读取数据，通过 useSyncExternalStore 订阅变化。
 *
 * 有任务时始终展开（多行）:
 *   ⠋ #1 Search files
 *   ◻ #2 Core logic
 *   ◻ #3 Tests                     ▸ blocked by #1
 *   ✔ #4 Analysis
 *
 *   1 in_progress · 1 pending · 1 completed
 *
 * 无任务时自动隐藏。
 */

import { useRef, useState } from 'react';
import type { TaskStore } from '@/core/task/task-store';
import type { TaskItem, TaskManageSummary } from '@/core/task/types';
import { Box, Text, useAnimationFrame } from '@/ink';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const LOADING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const LOADING_INTERVAL_MS = 200;

const STATUS_ICONS: Record<string, string> = {
  pending: '\u25FB',
  in_progress: '\u25FC',
  completed: '\u2714',
  cancelled: '\u2715',
};

// ---------------------------------------------------------------------------
// InkTaskStatusBar
// ---------------------------------------------------------------------------

export interface InkTaskStatusBarProps {
  taskStore: TaskStore;
  /** 是否已 flush 到 OutputArea（flush 后隐藏自身） */
  flushed?: boolean;
  /** 滚动提示文本的行数（如果不为 0 表示内部有滚动） */
  scrollHint?: number;
}

export function InkTaskStatusBar({
  taskStore,
  flushed = false,
}: InkTaskStatusBarProps): React.ReactElement | null {
  const [loadingFrame, setLoadingFrame] = useState(0);
  const lastTickRef = useRef(0);
  // 通过读取任务数据实现自动重新渲染

  const tasks = taskStore.read();
  const summary = taskStore.summary();

  const hasInProgress = summary.in_progress > 0;

  // 动画：有 in_progress 任务时启用
  useAnimationFrame(
    (delta) => {
      lastTickRef.current += delta;
      if (lastTickRef.current >= LOADING_INTERVAL_MS) {
        lastTickRef.current = 0;
        setLoadingFrame((f) => (f + 1) % LOADING_FRAMES.length);
      }
    },
    { enabled: hasInProgress }
  );

  // flush 后隐藏
  if (flushed) return null;

  // 无任务时自动隐藏
  if (tasks.length === 0) return null;

  const shouldExpand = summary.total > 0;

  if (shouldExpand) {
    return (
      <ExpandedView
        tasks={tasks}
        summary={summary}
        loadingFrame={loadingFrame}
        taskStore={taskStore}
      />
    );
  }

  return <CollapsedView summary={summary} loadingFrame={loadingFrame} />;
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

function CollapsedView({
  summary,
  loadingFrame,
}: {
  summary: TaskManageSummary;
  loadingFrame: number;
}): React.ReactElement {
  const frame = LOADING_FRAMES[loadingFrame % LOADING_FRAMES.length] ?? '';
  const parts: string[] = [];

  const taskCount = summary.total === 1 ? '1 task' : `${summary.total} tasks`;
  parts.push(`📋 ${taskCount}`);

  if (summary.in_progress > 0) {
    parts.push(`${frame} ${summary.in_progress} in_progress`);
  }
  if (summary.pending > 0) {
    parts.push(`${STATUS_ICONS.pending} ${summary.pending} pending`);
  }
  if (summary.completed > 0) {
    parts.push(`${STATUS_ICONS.completed} ${summary.completed} completed`);
  }
  if (summary.cancelled > 0) {
    parts.push(`${STATUS_ICONS.cancelled} ${summary.cancelled} cancelled`);
  }

  return (
    <Box>
      <Text>{`  ${parts.join(' · ')}`}</Text>
    </Box>
  );
}

function ExpandedView({
  tasks,
  summary,
  loadingFrame,
  taskStore,
}: {
  tasks: TaskItem[];
  summary: TaskManageSummary;
  loadingFrame: number;
  taskStore: TaskStore;
}): React.ReactElement {
  const sorted = sortTasks(tasks, taskStore);

  return (
    <Box flexDirection="column">
      {sorted.map((task) => (
        <TaskLine key={task.id} task={task} loadingFrame={loadingFrame} taskStore={taskStore} />
      ))}
      <Box>
        <Text> </Text>
      </Box>
      <SummaryLine summary={summary} />
    </Box>
  );
}

function TaskLine({
  task,
  loadingFrame,
  taskStore,
}: {
  task: TaskItem;
  loadingFrame: number;
  taskStore: TaskStore;
}): React.ReactElement {
  const icon =
    task.status === 'in_progress'
      ? (LOADING_FRAMES[loadingFrame % LOADING_FRAMES.length] ?? '')
      : (STATUS_ICONS[task.status] ?? '?');
  const prefix = `  ${icon} #${task.id} `;

  const blockedBy = getBlockedHint(task, taskStore);

  // 样式化
  let subjectStyle: { color?: string; dim?: boolean; strikethrough?: boolean } = {};
  if (task.status === 'completed') {
    subjectStyle = { dim: true, strikethrough: true };
  } else if (task.status === 'in_progress') {
    subjectStyle = { color: 'cyan' };
  } else if (task.status === 'cancelled') {
    subjectStyle = { dim: true };
  }

  return (
    <Box>
      <Text>
        <Text>{prefix}</Text>
        <Text {...subjectStyle}>{task.subject}</Text>
        {blockedBy && <Text dim>{`  ${blockedBy}`}</Text>}
      </Text>
    </Box>
  );
}

function SummaryLine({ summary }: { summary: TaskManageSummary }): React.ReactElement {
  const parts: string[] = [];
  if (summary.in_progress > 0) parts.push(`${summary.in_progress} in_progress`);
  if (summary.pending > 0) parts.push(`${summary.pending} pending`);
  if (summary.completed > 0) parts.push(`${summary.completed} completed`);
  if (summary.cancelled > 0) parts.push(`${summary.cancelled} cancelled`);

  if (parts.length === 0) return <Box />;

  return (
    <Box>
      <Text dim>{`  ${parts.join(' · ')}`}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function getBlockedHint(task: TaskItem, taskStore: TaskStore): string {
  if (!task.dependencies || task.dependencies.length === 0) return '';
  if (task.status !== 'pending') return '';

  const allTasks = taskStore.read();
  const openBlockers: string[] = [];

  for (const depId of task.dependencies) {
    const depTask = allTasks.find((t) => t.id === depId);
    if (depTask && depTask.status !== 'completed') {
      openBlockers.push(`#${depId}`);
    } else if (!depTask) {
      openBlockers.push(`#${depId}?`);
    }
  }

  if (openBlockers.length === 0) return '';
  return `▸ blocked by ${openBlockers.join(', ')}`;
}

function sortTasks(tasks: TaskItem[], taskStore: TaskStore): TaskItem[] {
  const allTasks = taskStore.read();
  return [...tasks].sort((a, b) => taskPriority(a, allTasks) - taskPriority(b, allTasks));
}

function taskPriority(task: TaskItem, allTasks: TaskItem[]): number {
  switch (task.status) {
    case 'in_progress':
      return 0;
    case 'pending': {
      if (isBlocked(task, allTasks)) return 2;
      return 1;
    }
    case 'completed':
      return 10 - Date.now() + task.updatedAt;
    case 'cancelled':
      return 20;
    default:
      return 100;
  }
}

function isBlocked(task: TaskItem, allTasks: TaskItem[]): boolean {
  if (!task.dependencies || task.dependencies.length === 0) return false;
  return task.dependencies.some((depId) => {
    const depTask = allTasks.find((t) => t.id === depId);
    return !depTask || depTask.status !== 'completed';
  });
}
