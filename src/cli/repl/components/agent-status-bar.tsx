/**
 * InkAgentStatusBar — Agent 状态栏组件（Ink 版）
 *
 * 实时显示正在运行的子 Agent 状态。
 * 从 AgentInstanceManager 读取活跃实例数据。
 * 使用 Box + Text 替代旧版 chalk + Container。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAgentInstanceManager } from '@/core/agent-team/agent-instance-manager';
import { buildToolCallGroups } from '@/core/agent-team/agent-progress-processor';
import type { AgentInstance } from '@/core/agent-team/types';
import { Box, Text, useAnimationFrame } from '@/ink';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<string, string> = {
  idle: '\u25CB',
  running: '\u25CF',
  paused: '\u25D0',
  completed: '\u2714',
  failed: '\u2718',
  cancelled: '\u25CC',
};

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

const TREE_BRANCH = '\u251C\u2500\u2500 ';
const TREE_LAST = '\u2514\u2500\u2500 ';
const TREE_PIPE = '\u2502   ';
const TREE_SPACE = '    ';

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

function getToolDescription(toolName: string): string {
  return TOOL_DESCRIPTIONS[toolName] ?? toolName;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// InkAgentStatusBar
// ---------------------------------------------------------------------------

export interface InkAgentStatusBarProps {
  /** 当前模型名称（可选，用于 Token 统计行） */
  modelName?: string | null;
  /** 累积 input tokens */
  inputTokens?: number;
  /** 累积 cache read tokens */
  cacheReadTokens?: number;
  /** 累积 output tokens */
  outputTokens?: number;
  /** Token 信息是否已 flush 到 OutputArea（flush 后不再单独显示） */
  tokenFlushed?: boolean;
  /** 刷新回调 — 通知 Ink 重新渲染 */
  onInvalidate?: () => void;
}

export function InkAgentStatusBar({
  modelName,
  inputTokens = 0,
  cacheReadTokens = 0,
  outputTokens = 0,
  tokenFlushed = false,
}: InkAgentStatusBarProps): React.ReactElement | null {
  const [expanded] = useState(true);
  const [agentExpanded, setAgentExpanded] = useState<Map<string, boolean>>(new Map());
  const [loadingFrame, setLoadingFrame] = useState(0);
  const lastTickRef = useRef(0);

  const instanceManager = getAgentInstanceManager();
  const activeInstances = instanceManager.listActive();

  const hasTokenInfo = modelName != null;
  const hasActive = activeInstances.length > 0;

  // Animation: 仅在活跃实例存在时启用
  useAnimationFrame(
    (delta) => {
      lastTickRef.current += delta;
      if (lastTickRef.current >= LOADING_INTERVAL_MS) {
        lastTickRef.current = 0;
        setLoadingFrame((f) => (f + 1) % LOADING_FRAMES.length);
      }
    },
    { enabled: hasActive }
  );

  // 强制重新渲染 — 实例变化时增量更新
  const [, forceRender] = useState(0);
  const increment = useCallback(() => forceRender((t) => t + 1), []);
  useEffect(() => {
    instanceManager.on('instance:registered', increment);
    instanceManager.on('instance:transitioned', increment);
    instanceManager.on('instance:activity', increment);
    instanceManager.on('instance:toolcall', increment);
    return () => {
      instanceManager.off('instance:registered', increment);
      instanceManager.off('instance:transitioned', increment);
      instanceManager.off('instance:activity', increment);
      instanceManager.off('instance:toolcall', increment);
    };
  }, [instanceManager, increment]);

  // 无活跃实例且 Token 已 flush → 隐藏
  if (!hasActive && tokenFlushed) return null;

  // 无活跃实例但有 Token 信息 → 只显示 Token 行
  if (!hasActive) {
    if (hasTokenInfo) {
      return (
        <Box>
          <Text dim>
            {renderTokenInfoLine(modelName, inputTokens, cacheReadTokens, outputTokens)}
          </Text>
        </Box>
      );
    }
    return null;
  }

  const frame = LOADING_FRAMES[loadingFrame % LOADING_FRAMES.length] ?? '';

  return (
    <Box flexDirection="column">
      {expanded ? (
        <ExpandedView
          frame={frame}
          instances={activeInstances}
          agentExpanded={agentExpanded}
          onToggleAgent={(id) => {
            setAgentExpanded((prev) => {
              const next = new Map(prev);
              next.set(id, !(next.get(id) ?? false));
              return next;
            });
          }}
        />
      ) : (
        <CollapsedView frame={frame} instances={activeInstances} />
      )}
      {hasTokenInfo && (
        <Box>
          <Text dim>
            {renderTokenInfoLine(modelName, inputTokens, cacheReadTokens, outputTokens)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

function CollapsedView({
  frame,
  instances,
}: {
  frame: string;
  instances: AgentInstance[];
}): React.ReactElement {
  const count = instances.length;
  const totalDuration = formatDuration(Math.max(...instances.map((i) => Date.now() - i.createdAt)));

  return (
    <Box>
      <Text color="cyan">{` ${frame} ${count} agent${count > 1 ? 's' : ''} `}</Text>
      <Text dim>· {totalDuration}</Text>
    </Box>
  );
}

function ExpandedView({
  frame,
  instances,
}: {
  frame: string;
  instances: AgentInstance[];
  agentExpanded: Map<string, boolean>;
  onToggleAgent: (id: string) => void;
}): React.ReactElement {
  const count = instances.length;
  const totalDuration = formatDuration(Math.max(...instances.map((i) => Date.now() - i.createdAt)));

  const header = `  ${frame} ${count} agent${count > 1 ? 's' : ''} · ${totalDuration}`;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">{header}</Text>
      </Box>
      {instances.map((inst, i) => (
        <AgentDetailLine key={inst.instanceId} inst={inst} isLast={i === instances.length - 1} />
      ))}
    </Box>
  );
}

function AgentDetailLine({
  inst,
  isLast,
}: {
  inst: AgentInstance;
  isLast: boolean;
}): React.ReactElement {
  const connector = isLast ? TREE_LAST : TREE_BRANCH;
  const childPrefix = isLast ? TREE_SPACE : TREE_PIPE;
  const icon = STATUS_ICONS[inst.status] ?? '?';
  const duration = formatDuration(Date.now() - inst.createdAt);
  const act = inst.currentActivity;

  let activityDesc = '';
  if (act) {
    activityDesc = `正在${getToolDescription(act.toolName)}`;
  } else {
    const totalCalls = inst.toolCallHistory.length;
    if (totalCalls > 0) {
      const allCompleted = inst.toolCallHistory.every(
        (t) => t.status === 'completed' || t.status === 'failed'
      );
      if (allCompleted) activityDesc = `已完成 ${totalCalls} 次调用`;
    }
  }

  const iconColor = inst.status === 'running' ? 'yellow' : 'gray';
  const line1 = `  ${connector}${icon} ${inst.typeId}${activityDesc ? ` · ${activityDesc}` : ''} · ${duration}`;

  const extras: React.ReactElement[] = [];

  const totalCalls = inst.toolCallHistory.length;
  if (totalCalls > 0 && !act) {
    const groups = buildToolCallGroups(inst.toolCallHistory);
    const summaries = groups.map((g) => `${getToolDescription(g.label)} ${g.count}次`);
    if (summaries.length > 0) {
      extras.push(
        <Box key="summary">
          <Text dim>
            {'  '}
            {childPrefix}
            {TREE_SPACE}
            {summaries.join('  ')}
          </Text>
        </Box>
      );
    }
  } else if (totalCalls > 0 && act) {
    extras.push(
      <Box key="calls">
        <Text dim>
          {'  '}
          {childPrefix}
          {TREE_SPACE}已完成 {totalCalls} 次工具调用
        </Text>
      </Box>
    );
  }

  if (inst.status === 'running' && !act) {
    extras.push(
      <Box key="bg">
        <Text dim>
          {'  '}
          {childPrefix}
          {TREE_SPACE}(ctrl+b to run in background)
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={iconColor}>{line1}</Text>
      </Box>
      {extras}
    </Box>
  );
}

function renderTokenInfoLine(
  modelName: string,
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number
): string {
  const parts: string[] = [];

  if (inputTokens > 0) parts.push(`${formatTokenCount(inputTokens)} in`);

  if (cacheReadTokens > 0) {
    parts.push(`${formatTokenCount(cacheReadTokens)} cache`);
  }

  if (outputTokens > 0) parts.push(`${formatTokenCount(outputTokens)} out`);

  if (parts.length === 0) return '';

  return `  ${modelName} · ${parts.join(' · ')}`;
}
