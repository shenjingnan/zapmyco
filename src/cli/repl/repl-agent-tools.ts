/**
 * REPL Agent 工具注册表
 *
 * 定义 REPL 场景下 Agent 可用的工具集合。
 * 工具按能力域分组，支持按需加载。
 *
 * @module cli/repl/repl-agent-tools
 */

import type { CronScheduler } from '@/cli/repl/cron/cron-scheduler';
import { createAgentTool } from '@/cli/repl/tools/agent-tool';
import { createAskUserQuestionTool } from '@/cli/repl/tools/ask-user-question';
import { createCronTool } from '@/cli/repl/tools/cron-tool';
import { createEnterWorktreeTool } from '@/cli/repl/tools/enter-worktree';
import { createExitWorktreeTool } from '@/cli/repl/tools/exit-worktree';
import { createEditFileTool } from '@/cli/repl/tools/file-edit';
import { createGlobTool } from '@/cli/repl/tools/file-glob';
import { createGrepTool } from '@/cli/repl/tools/file-grep';
import { readStateTracker } from '@/cli/repl/tools/file-security';
import { createWriteFileTool } from '@/cli/repl/tools/file-write';
import { createMemoryTool } from '@/cli/repl/tools/memory-tool';
import { createExecTool } from '@/cli/repl/tools/shell-exec';
import { createProcessTool } from '@/cli/repl/tools/shell-process';
import { createSkillTool } from '@/cli/repl/tools/skill-tool';
import { createSpawnSubAgentsTool } from '@/cli/repl/tools/subagent-spawn';
import { createTaskManageTool } from '@/cli/repl/tools/task-manage';
import { createWebFetchTool } from '@/cli/repl/tools/web-fetch';
import { createWebSearchTool } from '@/cli/repl/tools/web-search';
import type { SkillConfig, SubAgentConfig, WebConfig } from '@/config/types';
import type { ToolRegistration } from '@/core/agent-runtime';
import type { LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import { getBackgroundAgentManager } from '@/core/agent-team/agent-background-manager';
import { AgentOrchestrator } from '@/core/agent-team/agent-orchestrator';
import type { AgentTeamConfig } from '@/core/agent-team/types';
import { SubAgentManager } from '@/core/sub-agent';
import type { TaskStore } from '@/core/task/task-store';
import { resolveWorktreePath } from '@/core/worktree/worktree-context';
import type { WorktreeManager } from '@/core/worktree/worktree-manager';
import { TOOL_RISK_MAP } from '@/security/constants';
import type { ToolGuard } from '@/security/tool-guard';
import type { RiskLevel } from '@/security/types';

/**
 * 创建 REPL 基础工具集
 *
 * @param webConfig - Web 工具配置（可选），传入时启用 WebFetch 和 WebSearch
 * @param taskStore - TaskStore 实例（可选），传入时启用 TaskManage 工具
 */
export function createReplBuiltinTools(
  webConfig?: WebConfig,
  taskStore?: TaskStore,
  skillConfig?: SkillConfig,
  parentAgent?: LlmBasedAgent,
  subAgentConfig?: SubAgentConfig,
  cronScheduler?: CronScheduler,
  agentTeamConfig?: AgentTeamConfig,
  worktreeManager?: WorktreeManager,
  toolGuard?: ToolGuard
): ToolRegistration[] {
  const tools: ToolRegistration[] = [
    {
      id: 'GetCurrentTime',
      label: '获取当前时间',
      description:
        '获取当前日期和时间（含本地时间和 UTC 时间）。当用户询问时间、需要时间戳、或需要时间相关上下文时调用此工具。',
      defaultRisk: 'low' as const,
      execute: async () => {
        const now = new Date();
        const offset = -now.getTimezoneOffset();
        const tz = `UTC${offset >= 0 ? '+' : ''}${Math.floor(offset / 60)}:${String(offset % 60).padStart(2, '0')}`;
        return {
          content: [
            {
              type: 'text',
              text: `本地时间: ${now.toString()}\nISO (UTC): ${now.toISOString()}\n时区: ${tz}`,
            },
          ],
          details: { timestamp: Date.now(), timezone: tz },
        };
      },
    },
    {
      id: 'GetWorkdirInfo',
      label: '获取工作目录信息',
      description: '获取当前工作目录路径和系统平台信息。当需要了解当前项目位置或运行环境时调用。',
      defaultRisk: 'low' as const,
      execute: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                cwd: process.cwd(),
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
              },
              null,
              2
            ),
          },
        ],
        details: { cwd: process.cwd(), platform: process.platform },
      }),
    },
    {
      id: 'ReadFile',
      label: '读取文件',
      description:
        '读取指定路径的文本文件内容。参数 file_path 为文件绝对路径。' +
        '支持 offset（起始行号）和 limit（最大行数）参数用于分页读取大文件。',
      defaultRisk: 'low' as const,
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件绝对路径' },
          offset: {
            type: 'number',
            description: '起始行号（1-based，可选）',
          },
          limit: {
            type: 'number',
            description: '最大读取行数（可选，默认 2000）',
          },
        },
        required: ['file_path'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (_toolCallId: string, params: any): Promise<any> => {
        const fs = await import('node:fs/promises');
        const resolvedPath = resolveWorktreePath(params.file_path);
        try {
          const content = await fs.readFile(resolvedPath, 'utf-8');
          const lines = content.split('\n');
          const offset = params.offset ? Math.max(1, params.offset) : 1;
          const limit = params.limit ?? 2000;

          // 分页
          const startIdx = offset - 1;
          const endIdx = Math.min(startIdx + limit, lines.length);
          const pageLines = lines.slice(startIdx, endIdx);
          const pageContent = pageLines.map((l, i) => `${startIdx + i + 1}\t${l}`).join('\n');
          const truncated = endIdx < lines.length;

          // 记录读取状态（用于 write/edit 工具的过期检测）
          readStateTracker.recordRead(resolvedPath);

          return {
            content: [
              {
                type: 'text',
                text:
                  pageContent +
                  (truncated
                    ? `\n\n[文件共 ${lines.length} 行，已显示 ${offset}-${endIdx} 行]`
                    : ''),
              },
            ],
            details: {
              path: resolvedPath,
              totalLines: lines.length,
              displayedLines: endIdx - startIdx,
              offset,
              limit,
              truncated,
            },
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `读取失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            details: { path: resolvedPath, error: true },
          };
        }
      },
    },
  ];

  // 文件写入工具（write + edit + glob + grep）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools.push(createWriteFileTool() as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools.push(createEditFileTool() as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools.push(createGlobTool() as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools.push(createGrepTool() as any);

  // Shell 执行工具（exec + process）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools.push(createExecTool() as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools.push(createProcessTool() as any);

  // Web 工具（按需启用）
  if (webConfig?.enabled !== false) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools.push(createWebFetchTool(webConfig) as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools.push(createWebSearchTool(webConfig) as any);
  }

  // 任务管理工具（依赖 TaskStore 实例）
  if (taskStore) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools.push(createTaskManageTool(taskStore) as any);
  }

  // 持久化记忆工具
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools.push(createMemoryTool() as any);

  // Skill 工具
  if (skillConfig?.enabled !== false) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools.push(createSkillTool(skillConfig) as any);
  }

  // Sub-Agent 派发工具（依赖父 Agent 实例）
  if (parentAgent && subAgentConfig?.enabled !== false && subAgentConfig) {
    let orchestrator: AgentOrchestrator | undefined;

    // 如果启用了 Agent Team 系统，创建 AgentOrchestrator
    if (agentTeamConfig?.enabled) {
      orchestrator = new AgentOrchestrator(agentTeamConfig, subAgentConfig, parentAgent, tools);
      // 注册增强版 AgentTool（替代旧版 SpawnSubAgents）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools.push(createAgentTool(orchestrator) as any);

      // 初始化后台 Agent 管理器（注入 orchestrator 以支持异步执行）
      const bgManager = getBackgroundAgentManager();
      bgManager.setOrchestrator(orchestrator);
      bgManager.restore();
    }

    const manager = new SubAgentManager(
      subAgentConfig,
      parentAgent,
      tools,
      orchestrator,
      toolGuard
    );

    if (!agentTeamConfig?.enabled) {
      // 未启用 Agent Team 时，使用旧版 SpawnSubAgents 工具
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools.push(createSpawnSubAgentsTool(manager, subAgentConfig) as any);
    }
  }

  // Worktree 隔离工具
  if (worktreeManager) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools.push(createEnterWorktreeTool(worktreeManager) as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools.push(createExitWorktreeTool(worktreeManager) as any);
  }

  // 定时任务工具（依赖 CronScheduler 实例）
  if (cronScheduler) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools.push(createCronTool(cronScheduler) as any);
  }

  // AskUserQuestion 交互式提问工具（始终注册）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools.push(createAskUserQuestionTool() as any);

  // 为未设置 defaultRisk 的工具补充默认风险等级
  for (const tool of tools) {
    if (!tool.defaultRisk) {
      const mappedRisk = TOOL_RISK_MAP[tool.id];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tool as any).defaultRisk = (mappedRisk ?? 'medium') as RiskLevel;
    }
  }

  return tools;
}
