/**
 * EnterWorktree 工具
 *
 * 创建 git worktree 并切换当前会话的工作目录到隔离环境。
 * 后续文件操作和 Shell 命令都在 worktree 中执行。
 *
 * @module cli/repl/tools
 */

import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import type { WorktreeManager } from '@/core/worktree/worktree-manager';
import type { RiskLevel } from '@/security/types';

/**
 * 创建 EnterWorktree 工具注册
 */
export function createEnterWorktreeTool(worktreeManager: WorktreeManager): ToolRegistration {
  return {
    id: 'EnterWorktree',
    label: '进入工作树',
    description: [
      '创建 git worktree 并切换当前会话的工作目录到隔离环境。',
      '',
      '### 何时使用此工具',
      '- 需要在独立的工作区中进行代码修改时',
      '- 不希望当前修改影响主工作区时',
      '- Agent 需要隔离的文件系统环境时',
      '',
      '### 参数',
      '- **name**（可选）: worktree 名称，用于标识和后续管理',
      '',
      '### 注意事项',
      '- 进入 worktree 后所有文件操作和 Shell 命令都在 worktree 中执行',
      '- 使用 ExitWorktree 工具退出 worktree',
    ].join('\n'),
    defaultRisk: 'high' as RiskLevel,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'worktree 名称（可选，用于标识）',
        },
      },
      required: [],
    } as unknown as import('typebox').TSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (_toolCallId: string, params: any): Promise<any> => {
      const name = (params as { name?: string }).name;

      try {
        const slug = name ?? `manual-${Date.now()}`;
        const info = await worktreeManager.create({
          slug,
          createdBy: 'user',
        });

        // 切换工作目录到 worktree
        process.chdir(info.worktreePath);

        return {
          content: [
            {
              type: 'text',
              text: [
                '**已进入 worktree 隔离环境**',
                '',
                `- ID: \`${info.id}\``,
                `- 路径: \`${info.worktreePath}\``,
                `- 分支: \`${info.branchName}\``,
                '',
                '后续文件操作和 Shell 命令都将在 worktree 中执行。',
                '使用 ExitWorktree 工具退出。',
              ].join('\n'),
            },
          ],
          details: {
            worktreeId: info.id,
            worktreePath: info.worktreePath,
            branchName: info.branchName,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `创建 worktree 失败: ${message}`,
            },
          ],
          details: { error: message },
        };
      }
    },
  };
}
