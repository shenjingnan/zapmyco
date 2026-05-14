/**
 * Agent 结果聚合器
 *
 * 将多个 WorkerResult 聚合为 TeamResult，生成人类可读的汇总文本。
 *
 * @module core/agent-team
 */

import type { TeamResult, WorkerResult } from '@/core/agent-team/types';
import type { TokenUsage } from '@/core/result/types';
import { logger } from '@/infra/logger';

const log = logger.child('agent-result-aggregator');

/** 零值 TokenUsage */
const ZERO_TOKEN: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: 0,
};

/**
 * 聚合多个 Worker 结果为 Team 结果
 *
 * @param teamId - 团队 ID
 * @param workerResults - Worker 结果列表
 * @returns 完整的 TeamResult
 */
export function aggregateResults(teamId: string, workerResults: WorkerResult[]): TeamResult {
  const succeeded = workerResults.filter((r) => r.status === 'success').length;
  const failed = workerResults.filter(
    (r) => r.status === 'failure' || r.status === 'partial'
  ).length;

  const totalDuration = workerResults.reduce((sum, r) => sum + (r.duration ?? 0), 0);

  const totalTokenUsage: TokenUsage = workerResults.reduce(
    (sum, r) => ({
      inputTokens: sum.inputTokens + (r.tokenUsage?.inputTokens ?? 0),
      outputTokens: sum.outputTokens + (r.tokenUsage?.outputTokens ?? 0),
      totalTokens: sum.totalTokens + (r.tokenUsage?.totalTokens ?? 0),
      cacheReadTokens: sum.cacheReadTokens + (r.tokenUsage?.cacheReadTokens ?? 0),
      cacheWriteTokens: sum.cacheWriteTokens + (r.tokenUsage?.cacheWriteTokens ?? 0),
      estimatedCostUsd: sum.estimatedCostUsd + (r.tokenUsage?.estimatedCostUsd ?? 0),
    }),
    { ...ZERO_TOKEN }
  );

  const summary = buildTeamSummary(workerResults);

  log.debug('Team 结果聚合完成', {
    teamId,
    total: workerResults.length,
    succeeded,
    failed,
    totalDuration,
  });

  return {
    teamId,
    workerResults,
    summary,
    totalDuration,
    totalTokenUsage,
    stats: {
      total: workerResults.length,
      succeeded,
      failed,
    },
  };
}

/**
 * 构建 Team 执行汇总文本（Markdown 格式）
 *
 * @param workerResults - Worker 结果列表
 * @returns 人类可读的汇总文本
 */
export function buildTeamSummary(workerResults: WorkerResult[]): string {
  if (workerResults.length === 0) {
    return '## Team 执行汇总\n\n无 Worker 结果。';
  }

  const lines: string[] = [
    '## Team 执行汇总',
    '',
    '| 状态 | Worker 类型 | 任务 | 耗时 |',
    '|------|------------|------|------|',
  ];

  for (const r of workerResults) {
    const statusIcon = r.status === 'success' ? '✅' : r.status === 'partial' ? '⚠️' : '❌';
    const durationSec = r.duration != null ? `${(r.duration / 1000).toFixed(1)}s` : 'N/A';
    const taskPreview = escapeMarkdownTable(r.taskDescription.slice(0, 60));
    const typeLabel = r.typeId || 'unknown';

    lines.push(`| ${statusIcon} | ${typeLabel} | ${taskPreview} | ${durationSec} |`);
  }

  const succeeded = workerResults.filter((r) => r.status === 'success').length;
  const partial = workerResults.filter((r) => r.status === 'partial').length;
  const failed = workerResults.length - succeeded - partial;

  lines.push('');
  const statsParts: string[] = [`**总计**: ${workerResults.length} 个任务`];
  if (succeeded > 0) statsParts.push(`${succeeded} 成功`);
  if (partial > 0) statsParts.push(`${partial} 部分完成`);
  if (failed > 0) statsParts.push(`${failed} 失败`);
  lines.push(statsParts.join(', '));

  // 附加每个 Worker 的详细输出
  const nonFailedResults = workerResults.filter(
    (r) => r.status === 'success' || r.status === 'partial'
  );
  if (nonFailedResults.length > 0) {
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const r of nonFailedResults) {
      lines.push(`### ${r.typeId}: ${r.taskDescription.slice(0, 80)}`);
      lines.push('');
      if (r.output) {
        lines.push(r.output);
      } else {
        lines.push('（无输出）');
      }
      if (r.error) {
        lines.push('');
        lines.push(`> ⚠️ 错误: ${r.error.message}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 为 Markdown 表格转义特殊字符
 */
function escapeMarkdownTable(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, ' ').replace(/\|/g, '\\|');
}
