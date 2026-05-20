/**
 * Agent 团队树形显示组件
 *
 * 基于 AgentInstanceManager 的父子关系渲染 spawn 树。
 * 使用 Unicode 树形字符展示 Agent 层级结构。
 *
 * @module cli/repl/components
 */

import type { AgentInstance, AgentTypeDefinition } from '@/core/agent-team/types';

/** 树形显示选项 */
export interface AgentTreeOptions {
  /** 是否显示颜色（默认 true） */
  color?: boolean;
}

/** 颜色常量（无外部依赖） */
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
  orange: '\x1b[38;5;208m',
  purple: '\x1b[35m',
};

/** 状态对应的图标和颜色 */
const STATUS_STYLE: Record<string, { icon: string; color: string }> = {
  idle: { icon: '○', color: COLORS.gray },
  running: { icon: '◉', color: COLORS.yellow },
  paused: { icon: '◐', color: COLORS.yellow },
  completed: { icon: '●', color: COLORS.green },
  failed: { icon: '✕', color: COLORS.red },
  cancelled: { icon: '◌', color: COLORS.gray },
};

/** Agent 角色对应的标签 */
const ROLE_LABELS: Record<string, string> = {
  coordinator: '协调者',
  worker: 'Worker',
  universal: '通用',
};

/**
 * 格式化 Agent 类型列表
 *
 * @param types - Agent 类型定义数组
 * @param options - 显示选项
 * @returns 格式化后的文本行
 */
export function formatAgentTypes(
  types: AgentTypeDefinition[],
  options: AgentTreeOptions = {}
): string[] {
  const color = options.color !== false;
  const c = color ? withColor : noColor;
  const lines: string[] = ['', c.bold('  Agent 类型列表'), ''];

  if (types.length === 0) {
    lines.push(c.dim('  （没有可用的 Agent 类型）'));
    lines.push('');
    return lines;
  }

  // 表头
  lines.push(
    [
      `  ${c.bold('类型 ID')}`.padEnd(22),
      c.bold('角色').padEnd(12),
      c.bold('工具策略').padEnd(12),
      c.bold('深度').padEnd(6),
      c.bold('轮次').padEnd(6),
      c.bold('能力'),
    ].join('')
  );
  lines.push(c.dim(`  ${'─'.repeat(80)}`));

  for (const t of types) {
    const roleLabel = ROLE_LABELS[t.role] ?? t.role;
    const toolMode = typeof t.toolPolicy === 'object' ? t.toolPolicy.mode : t.toolPolicy;
    const capSummary = t.capabilities
      .slice(0, 3)
      .map((cap) => cap.name)
      .join(', ');
    const moreCaps = t.capabilities.length > 3 ? ` +${t.capabilities.length - 3}` : '';

    const typeColor = t.color ? hexToAnsi(t.color) : '';

    lines.push(
      [
        `  ${typeColor}${t.typeId}${c.reset}`.padEnd(24),
        roleLabel.padEnd(12),
        toolMode.padEnd(12),
        String(t.maxSpawnDepth).padEnd(6),
        String(t.maxTurns).padEnd(6),
        `${capSummary}${moreCaps}`,
      ].join('')
    );
  }

  lines.push('');
  lines.push(c.dim(`  共 ${types.length} 个类型`));
  lines.push('');
  return lines;
}

/**
 * 格式化 Agent 实例树
 *
 * 基于 parentInstanceId 构建 spawn 层级树。
 *
 * @param instances - Agent 实例数组
 * @param options - 显示选项
 * @returns 格式化后的文本行
 */
export function formatAgentInstanceTree(
  instances: AgentInstance[],
  options: AgentTreeOptions = {}
): string[] {
  const color = options.color !== false;
  const c = color ? withColor : noColor;
  const lines: string[] = ['', c.bold('  Agent 实例列表'), ''];

  if (instances.length === 0) {
    lines.push(c.dim('  （当前没有运行中的 Agent 实例）'));
    lines.push('');
    return lines;
  }

  // 构建树形结构
  const roots = instances.filter((inst) => !inst.parentInstanceId);
  const childrenMap = new Map<string | null, AgentInstance[]>();

  for (const inst of instances) {
    const parentKey = inst.parentInstanceId;
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey)?.push(inst);
  }

  // 渲染每棵根树
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i]!;
    const isLastRoot = i === roots.length - 1;
    renderTreeNode(root, childrenMap, '', isLastRoot, lines, c);
  }

  // 统计
  const statusCounts: Record<string, number> = {};
  for (const inst of instances) {
    statusCounts[inst.status] = (statusCounts[inst.status] || 0) + 1;
  }

  lines.push('');
  const stats = Object.entries(statusCounts)
    .map(([status, count]) => {
      const style = STATUS_STYLE[status] ?? { icon: '?', color: '' };
      return `${style.color}${style.icon} ${status}${c.reset}: ${count}`;
    })
    .join('  ');
  lines.push(`  ${stats}`);
  lines.push('');

  return lines;
}

/**
 * 递归渲染树节点
 */
function renderTreeNode(
  instance: AgentInstance,
  childrenMap: Map<string | null, AgentInstance[]>,
  prefix: string,
  isLast: boolean,
  lines: string[],
  c: {
    reset: string;
    dim: (s: string) => string;
    bold?: (s: string) => string;
    green: string;
    yellow: string;
    red: string;
    gray: string;
  }
): void {
  const connector = isLast ? '└── ' : '├── ';
  const statusStyle = STATUS_STYLE[instance.status] ?? { icon: '?', color: '' };
  const durationText = instance.createdAt
    ? ` (${formatDuration(Date.now() - instance.createdAt)})`
    : '';

  lines.push(
    `  ${c.dim(`${prefix}${connector}`)}${c.reset}${statusStyle.color}${statusStyle.icon}${c.reset} ${instance.typeId} ` +
      `${c.dim(`[${instance.instanceId.slice(0, 12)}...]`)}${c.reset} ` +
      `${statusStyle.color}${instance.status}${c.reset}${durationText}`
  );

  // 渲染子节点
  const children = childrenMap.get(instance.instanceId) ?? [];
  const childPrefix = prefix + (isLast ? '    ' : '│   ');

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const isLastChild = i === children.length - 1;
    renderTreeNode(child, childrenMap, childPrefix, isLastChild, lines, c);
  }
}

/**
 * 格式化 Agent 团队概览
 *
 * @param types - Agent 类型定义
 * @param instances - Agent 实例数组
 * @param options - 显示选项
 * @returns 格式化后的文本行
 */
export function formatAgentOverview(
  types: AgentTypeDefinition[],
  instances: AgentInstance[],
  options: AgentTreeOptions = {}
): string[] {
  const color = options.color !== false;
  const c = color ? withColor : noColor;
  const lines: string[] = ['', c.bold('  Agent Team 概览'), ''];

  // 类型统计
  const activeInstances = instances.filter((i) => i.status === 'running');
  const completedInstances = instances.filter((i) => i.status === 'completed');
  const failedInstances = instances.filter((i) => i.status === 'failed');

  lines.push(`  ${c.bold('Agent 类型')}: ${types.length} 个`);
  lines.push(`  ${c.bold('活跃实例')}: ${c.yellow}${activeInstances.length}${c.reset} 个`);
  lines.push(`  ${c.bold('已完成')}: ${c.green}${completedInstances.length}${c.reset} 个`);
  if (failedInstances.length > 0) {
    lines.push(`  ${c.bold('失败')}: ${c.red}${failedInstances.length}${c.reset} 个`);
  }

  // 类型一览
  lines.push('');
  lines.push(`  ${c.bold('可用类型')}:`);

  for (const t of types) {
    const roleLabel = ROLE_LABELS[t.role] ?? t.role;
    const typeColor = t.color ? hexToAnsi(t.color) : '';
    const typeInstances = instances.filter((i) => i.typeId === t.typeId);
    const runningCount = typeInstances.filter((i) => i.status === 'running').length;

    let statusText = '';
    if (runningCount > 0) {
      statusText = ` ${c.yellow}(${runningCount} 运行中)${c.reset}`;
    }

    lines.push(
      `    ${typeColor}${t.typeId}${c.reset} (${roleLabel}) — ${t.whenToUse.slice(0, 60)}...${statusText}`
    );
  }

  lines.push('');
  lines.push(c.dim(`  使用 /agents types 查看类型详情 | /agents instances 查看实例树`));
  lines.push('');
  return lines;
}

// ============ 辅助 ============

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

function hexToAnsi(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/** 带颜色的格式化函数集合 */
const withColor = {
  bold: (s: string) => `${COLORS.bold}${s}${COLORS.reset}`,
  dim: (s: string) => `${COLORS.dim}${s}${COLORS.reset}`,
  green: COLORS.green,
  yellow: COLORS.yellow,
  red: COLORS.red,
  gray: COLORS.gray,
  reset: COLORS.reset,
};

/** 无颜色的格式化函数集合 */
const noColor = {
  bold: (s: string) => s,
  dim: (s: string) => s,
  green: '',
  yellow: '',
  red: '',
  gray: '',
  reset: '',
};
