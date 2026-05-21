/**
 * ExitWorktree 工具
 *
 * 退出当前 worktree 隔离环境。
 * 支持 keep（保留 worktree）和 remove（删除 worktree）两种模式。
 *
 * @module cli/repl/tools
 */

import { existsSync } from 'node:fs';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import { getWorktreeContext } from '@/core/worktree/worktree-context';
import type { WorktreeManager } from '@/core/worktree/worktree-manager';
import type { RiskLevel } from '@/security/types';

/**
 * 创建 ExitWorktree 工具注册
 */
export function createExitWorktreeTool(worktreeManager: WorktreeManager): ToolRegistration {
  return {
    id: 'ExitWorktree',
    label: '退出工作树',
    description: [
      '退出当前 worktree 隔离环境。',
      '',
      '### 参数',
      '- **action**: "keep" 保留 worktree，"remove" 删除 worktree',
      '- **discard_changes**: remove 时是否强制丢弃未提交变更（默认 false）',
      '',
      '### 安全门控',
      '- remove 模式：如果 worktree 有未提交变更且 discard_changes=false，操作将被拒绝',
      '- keep 模式：直接退出 worktree，worktree 保留在磁盘上',
    ].join('\n'),
    defaultRisk: 'high' as RiskLevel,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['keep', 'remove'],
          description: 'keep=保留 worktree 并退出，remove=删除 worktree 并退出',
        },
        discard_changes: {
          type: 'boolean',
          description:
            'remove 时是否强制丢弃未提交变更（默认 false）。设为 true 会强制删除 worktree',
        },
      },
      required: ['action'],
    } as unknown as import('typebox').TSchema,
    // biome-ignore lint/suspicious/noExplicitAny: dynamic params from inline JSON Schema
    execute: async (_toolCallId: string, params: any): Promise<any> => {
      const p = params as { action: 'keep' | 'remove'; discard_changes?: boolean };
      const ctx = getWorktreeContext();

      if (!ctx) {
        return {
          content: [
            {
              type: 'text',
              text: '当前不处于 worktree 隔离环境。无需退出。',
            },
          ],
        };
      }

      try {
        if (p.action === 'keep') {
          // 切换回原始目录
          if (existsSync(ctx.originalPath)) {
            process.chdir(ctx.originalPath);
          }

          return {
            content: [
              {
                type: 'text',
                text: [
                  '**已退出 worktree 隔离环境（保留 worktree）**',
                  '',
                  `- Worktree ID: \`${ctx.worktreeId}\``,
                  `- Worktree 路径: \`${ctx.worktreePath}\``,
                  `- 已切换回: \`${ctx.originalPath}\``,
                ].join('\n'),
              },
            ],
            details: { action: 'keep', worktreeId: ctx.worktreeId },
          };
        }

        // action === 'remove'
        try {
          await worktreeManager.remove(ctx.worktreeId, p.discard_changes);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);

          // 检查是否是变更未丢弃的问题
          if (!p.discard_changes && message.includes('changes')) {
            return {
              content: [
                {
                  type: 'text',
                  text: [
                    '**无法删除 worktree：存在未提交的变更**',
                    '',
                    `错误: ${message}`,
                    '',
                    '请选择:',
                    '- 设置 `discard_changes: true` 强制删除',
                    '- 或使用 `action: "keep"` 保留 worktree',
                  ].join('\n'),
                },
              ],
              details: { action: 'remove', error: 'has_changes', worktreeId: ctx.worktreeId },
            };
          }

          throw err;
        }

        // 切换回原始目录
        if (existsSync(ctx.originalPath)) {
          process.chdir(ctx.originalPath);
        }

        return {
          content: [
            {
              type: 'text',
              text: [
                '**已退出 worktree 隔离环境（已删除 worktree）**',
                '',
                `- Worktree ID: \`${ctx.worktreeId}\``,
                `- 已切换回: \`${ctx.originalPath}\``,
              ].join('\n'),
            },
          ],
          details: { action: 'remove', worktreeId: ctx.worktreeId },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `退出 worktree 失败: ${message}`,
            },
          ],
          details: { error: message },
        };
      }
    },
  };
}
