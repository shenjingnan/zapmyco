/**
 * REPL Agent 工具注册表
 *
 * 定义 REPL 场景下 Agent 可用的工具集合。
 * 工具按能力域分组，支持按需加载。
 *
 * @module cli/repl/repl-agent-tools
 */

import type { ToolRegistration } from '@/core/agent-runtime';

/**
 * 创建 REPL 基础工具集
 *
 * 第一阶段工具：验证 Agent 工具调用链路的端到端连通性。
 * 后续阶段在此基础扩展：文件读写、Shell 执行、Git 操作等。
 */
export function createReplBuiltinTools(): ToolRegistration[] {
  return [
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
      description: '读取指定路径的文本文件内容。参数 path 为文件绝对或相对路径。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
        },
        required: ['path'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (_toolCallId: string, params: any): Promise<any> => {
        const fs = await import('node:fs/promises');
        try {
          const content = await fs.readFile(params.path, 'utf-8');
          return {
            content: [{ type: 'text', text: content }],
            details: { path: params.path, size: content.length },
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `读取失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            details: { path: params.path, error: true },
          };
        }
      },
    },
  ];
}
