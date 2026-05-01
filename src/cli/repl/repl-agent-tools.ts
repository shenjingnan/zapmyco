/**
 * REPL Agent 工具注册表
 *
 * 定义 REPL 场景下 Agent 可用的工具集合。
 * 工具按能力域分组，支持按需加载。
 *
 * @module cli/repl/repl-agent-tools
 */

import { createEditFileTool } from '@/cli/repl/tools/file-edit';
import { createGlobTool } from '@/cli/repl/tools/file-glob';
import { createGrepTool } from '@/cli/repl/tools/file-grep';
import { readStateTracker } from '@/cli/repl/tools/file-security';
import { createWriteFileTool } from '@/cli/repl/tools/file-write';
import { createExecTool } from '@/cli/repl/tools/shell-exec';
import { createProcessTool } from '@/cli/repl/tools/shell-process';
import { createWebFetchTool } from '@/cli/repl/tools/web-fetch';
import { createWebSearchTool } from '@/cli/repl/tools/web-search';
import type { WebConfig } from '@/config/types';
import type { ToolRegistration } from '@/core/agent-runtime';

/**
 * 创建 REPL 基础工具集
 *
 * @param webConfig - Web 工具配置（可选），传入时启用 web_fetch 和 web_search
 */
export function createReplBuiltinTools(webConfig?: WebConfig): ToolRegistration[] {
  const tools: ToolRegistration[] = [
    {
      id: 'get_current_time',
      label: '获取当前时间',
      description:
        '获取当前日期和时间。当用户询问时间、需要时间戳、或需要时间相关上下文时调用此工具。',
      execute: async () => ({
        content: [{ type: 'text', text: new Date().toISOString() }],
        details: { timestamp: Date.now() },
      }),
    },
    {
      id: 'get_workdir_info',
      label: '获取工作目录信息',
      description: '获取当前工作目录路径和系统平台信息。当需要了解当前项目位置或运行环境时调用。',
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
      id: 'read_file',
      label: '读取文件',
      description:
        '读取指定路径的文本文件内容。参数 file_path 为文件绝对路径。' +
        '支持 offset（起始行号）和 limit（最大行数）参数用于分页读取大文件。',
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
        const pathModule = await import('node:path');
        const resolvedPath = pathModule.resolve(params.file_path);
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

  return tools;
}
