/**
 * Agent 状态/进度/消息面板
 *
 * 展示 Agent 实例运行状态统计和消息 inbox 摘要。
 *
 * @module cli/repl/components
 */

import type { AgentInstance, AgentMessage } from '@/core/agent-team/types';

/** 状态面板选项 */
export interface AgentStatusPanelOptions {
  /** 是否显示颜色（默认 true） */
  color?: boolean;
}

/** ANSI 颜色常量 */
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/** 状态颜色映射 */
const STATUS_COLOR: Record<string, string> = {
  idle: COLORS.gray,
  running: COLORS.yellow,
  paused: COLORS.yellow,
  completed: COLORS.green,
  failed: COLORS.red,
  cancelled: COLORS.gray,
};

/** 状态图标映射 */
const STATUS_ICON: Record<string, string> = {
  idle: '○',
  running: '◉',
  paused: '◐',
  completed: '●',
  failed: '✕',
  cancelled: '◌',
};

/**
 * 格式化 Agent 实例状态统计
 *
 * @param instances - Agent 实例数组
 * @param options - 显示选项
 * @returns 格式化后的文本行
 */
export function formatAgentStatusStats(
  instances: AgentInstance[],
  options: AgentStatusPanelOptions = {}
): string[] {
  const c = options.color !== false;
  const lines: string[] = ['', bold(c, '  Agent 状态统计'), ''];

  if (instances.length === 0) {
    lines.push(dim(c, '  （当前没有 Agent 实例记录）'));
    lines.push('');
    return lines;
  }

  // 按状态分组统计
  const order = ['running', 'idle', 'paused', 'completed', 'failed', 'cancelled'] as const;
  const counts: Record<string, number> = {};
  for (const inst of instances) {
    counts[inst.status] = (counts[inst.status] || 0) + 1;
  }

  const total = instances.length;
  const barWidth = 30;

  for (const status of order) {
    const count = counts[status] ?? 0;
    if (count === 0) continue;

    const pct = Math.round((count / total) * 100);
    const filled = Math.round((count / total) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    const statusColor = c ? STATUS_COLOR[status] || '' : '';
    const icon = STATUS_ICON[status] || '?';

    lines.push(
      `  ${statusColor}${icon} ${status.padEnd(10)}${COLORS.reset}${COLORS.dim}${bar}${COLORS.reset} ${String(count).padStart(3)} (${String(pct).padStart(2)}%)`
    );
  }

  lines.push('');
  lines.push(`  ${dim(c, `总计: ${total} 个实例`)}`);
  lines.push('');
  return lines;
}

/**
 * 格式化消息 inbox 摘要
 *
 * @param instances - Agent 实例数组
 * @param getInboxMessages - 获取指定实例 inbox 消息的函数
 * @param options - 显示选项
 * @returns 格式化后的文本行
 */
export function formatAgentMessageSummary(
  instances: AgentInstance[],
  getInboxMessages: (instanceId: string) => AgentMessage[],
  options: AgentStatusPanelOptions = {}
): string[] {
  const c = options.color !== false;
  const lines: string[] = ['', bold(c, '  Agent 消息记录'), ''];

  const instancesWithMessages = instances.filter((inst) => {
    const inbox = getInboxMessages(inst.instanceId);
    return inbox.length > 0;
  });

  if (instancesWithMessages.length === 0) {
    lines.push(dim(c, '  （当前没有未处理的消息）'));
    lines.push('');
    return lines;
  }

  for (const inst of instancesWithMessages) {
    const inbox = getInboxMessages(inst.instanceId);

    lines.push(
      `  ${bold(c, `${inst.typeId}`)} ${COLORS.dim}[${inst.instanceId.slice(0, 16)}...]${COLORS.reset}`
    );
    lines.push(dim(c, `  ${'─'.repeat(50)}`));

    for (const msg of inbox.slice(0, 5)) {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      const typeLabel = MESSAGE_TYPE_LABELS[msg.type] ?? msg.type;
      lines.push(
        `    ${COLORS.dim}${time}${COLORS.reset} ${COLORS.cyan}${typeLabel}${COLORS.reset} ← ${msg.fromAgentId.slice(0, 12)}...`
      );
      lines.push(`      ${msg.payload.slice(0, 100)}`);
    }

    if (inbox.length > 5) {
      lines.push(dim(c, `    ... 还有 ${inbox.length - 5} 条消息`));
    }
    lines.push('');
  }

  lines.push('');
  return lines;
}

/** 消息类型标签映射 */
const MESSAGE_TYPE_LABELS: Record<string, string> = {
  task_assign: '📋 任务分配',
  task_result: '✅ 任务结果',
  question: '❓ 提问',
  clarification: '💬 澄清',
  progress: '📊 进度',
  cancel: '⛔ 取消',
  heartbeat: '💓 心跳',
};

// ============ 辅助 ============

function bold(c: boolean, s: string): string {
  return c ? `${COLORS.bold}${s}${COLORS.reset}` : s;
}

function dim(c: boolean, s: string): string {
  return c ? `${COLORS.dim}${s}${COLORS.reset}` : s;
}
