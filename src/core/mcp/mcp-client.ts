/**
 * MCP Server 连接管理 (stdio transport)
 *
 * 封装 MCP SDK 的 Client + StdioClientTransport，
 * 提供带超时的连接和优雅关闭能力。
 *
 * @module core/mcp/client
 */

import { Client } from '@modelcontextprotocol/sdk/client';
// SDK wildcard export 在 Node.js 中不会自动添加 .js 扩展名，需要显式指定
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/spec.types';
import type { McpServerConfig } from '@/config/types';
import { logger } from '@/infra/logger';

const log = logger.child('mcp:client');

/** 单个 MCP Server 的活动连接 */
export interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  tools: Tool[];
  serverName: string;
}

/**
 * 连接到单个 MCP Server 并发现其工具
 *
 * 任何失败都会返回 null（优雅降级），不阻塞其他 server。
 *
 * @param config - Server 配置
 * @param signal - 可选的 AbortSignal 用于取消连接
 * @returns 连接对象，失败时返回 null
 */
export async function connectMcpServer(
  config: McpServerConfig,
  signal?: AbortSignal
): Promise<McpConnection | null> {
  const timeoutMs = config.connectTimeoutMs ?? 15_000;
  const serverName = config.name;

  try {
    const client = new Client({ name: 'zapmyco', version: '0.3.0' });

    const transportOptions: {
      command: string;
      args: string[];
      env?: Record<string, string>;
      cwd?: string;
      stderr: 'pipe';
    } = {
      command: config.command,
      args: config.args ?? [],
      stderr: 'pipe',
    };
    if (config.env) transportOptions.env = config.env;
    if (config.cwd) transportOptions.cwd = config.cwd;

    const transport = new StdioClientTransport(transportOptions);

    // 处理 AbortSignal
    if (signal) {
      if (signal.aborted) return null;
      signal.addEventListener(
        'abort',
        () => {
          transport.close().catch(() => {});
          client.close().catch(() => {});
        },
        { once: true }
      );
    }

    // 带超时的连接
    await withTimeout(client.connect(transport), timeoutMs);

    // 带超时的工具发现
    const { tools: rawTools } = await withTimeout(client.listTools(), timeoutMs);

    // MCP SDK Zod 推断类型（description: string | undefined）与
    // spec.types 的 Tool 接口（description?: string）在
    // exactOptionalPropertyTypes 下不兼容，需要类型断言
    const tools: Tool[] = (rawTools ?? []) as Tool[];

    log.debug(`MCP server "${serverName}" 已连接，发现 ${tools.length} 个工具`);

    return {
      client,
      transport,
      tools,
      serverName,
    };
  } catch (error) {
    log.warn(
      `MCP server "${serverName}" 连接失败: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * 安全关闭单个 MCP Server 连接
 */
export async function closeMcpServer(conn: McpConnection): Promise<void> {
  try {
    await conn.transport.close();
  } catch {
    // 忽略 transport 关闭错误
  }
  try {
    await conn.client.close();
  } catch {
    // 忽略 client 关闭错误
  }
  log.debug(`MCP server "${conn.serverName}" 已断开`);
}

/**
 * 简单的超时工具：promise 在 ms 毫秒内未完成则 reject
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`操作超时 (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
