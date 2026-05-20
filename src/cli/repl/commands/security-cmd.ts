/**
 * /audit 命令
 *
 * 显示安全健康报告，包含整体评分、分类评分、统计信息和改进建议。
 */

import type { CommandDefinition } from '@/cli/repl/types';
import type { SecurityHealthReport } from '@/security/types';

/**
 * 默认渲染安全健康报告（当 Renderer 不支持时使用）
 */
function renderSecurityDefault(report: SecurityHealthReport): string[] {
  const lines: string[] = ['', '  🔒 安全健康报告', ''];

  // 整体评分
  const scoreColor = report.overallScore >= 80 ? '🟢' : report.overallScore >= 50 ? '🟡' : '🔴';
  lines.push(`  整体评分: ${scoreColor} ${report.overallScore}/100`);
  lines.push('');

  // 分类评分
  lines.push('  分类评分:');
  lines.push(`    permissions:  ${barChart(report.scores.permissions)}`);
  lines.push(`    shell:        ${barChart(report.scores.shell)}`);
  lines.push(`    filesystem:   ${barChart(report.scores.filesystem)}`);
  lines.push(`    ssrf:         ${barChart(report.scores.ssrf)}`);
  lines.push(`    secrets:      ${barChart(report.scores.secrets)}`);
  lines.push(`    sandbox:      ${barChart(report.scores.sandbox)}`);
  lines.push('');

  // 统计信息
  lines.push('  统计:');
  lines.push(`    总决策数: ${report.stats.totalDecisions}`);
  lines.push(
    `    阻止: ${report.stats.blockedCount}  批准: ${report.stats.approvedCount}  拒绝: ${report.stats.deniedCount}`
  );
  if (report.stats.doomLoopTriggers > 0) {
    lines.push(`    doom-loop 触发: ${report.stats.doomLoopTriggers}`);
  }
  lines.push('');

  // 近期阻止记录
  if (report.recentBlocks.length > 0) {
    lines.push('  近期阻止:');
    for (const block of report.recentBlocks.slice(0, 5)) {
      lines.push(`    ${block.timestamp}  ${block.toolId} — ${block.reason}`);
    }
    lines.push('');
  }

  // 改进建议
  if (report.recommendations.length > 0) {
    lines.push('  改进建议:');
    for (const rec of report.recommendations) {
      lines.push(`    ⚠ ${rec}`);
    }
    lines.push('');
  }

  return lines;
}

/** 简单柱状图 */
function barChart(score: number): string {
  const filled = Math.round(score / 10);
  return `${'█'.repeat(filled) + '░'.repeat(10 - filled)} ${score}/100`;
}

/**
 * 创建 security 命令定义
 */
export function createSecurityCommand(): CommandDefinition {
  return {
    name: 'audit',
    aliases: [],
    description: '安全审计与健康报告',
    usage: '/audit',
    handler(_args, session) {
      const report = session.getSecurityHealthReport?.();
      if (!report) {
        session.appendOutput(['', '  安全框架未初始化，无法生成报告', '']);
        return;
      }
      const renderer = session.getRenderer();
      const lines = renderer.renderSecurityHealth?.(report) ?? renderSecurityDefault(report);
      session.appendOutput(lines);
    },
  };
}
