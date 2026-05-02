/**
 * MCP Client 统一入口
 *
 * McpManager 管理所有 MCP Server 连接的生命周期：
 *   initialize() → 并行连接所有 server，收集工具
 *   shutdown()   → 关闭所有连接
 *
 * @module core/mcp
 */

import type { McpServerConfig } from '@/config/types';
import type { LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import { logger } from '@/infra/logger';
import { closeMcpServer, connectMcpServer, type McpConnection } from './mcp-client';
import { mcpToolToRegistration } from './mcp-tool-adapter';

const log = logger.child('mcp');

/**
 * MCP 连接生命周期管理器
 *
 * 持有所有活跃的 MCP Server 连接及其转换后的 ToolRegistration。
 * 实例化 → initialize() → 使用 tools → shutdown()
 */
export class McpManager {
  private connections: McpConnection[] = [];
  private toolRegistrations: ToolRegistration[] = [];

  /**
   * 并行连接所有启用的 MCP Server 并收集工具
   *
   * 单个 server 连接失败不影响其他 server（Promise.allSettled）。
   *
   * @param servers - MCP Server 配置列表
   * @returns 所有成功连接的 server 的工具注册列表
   */
  async initialize(servers: McpServerConfig[]): Promise<ToolRegistration[]> {
    const enabledServers = servers.filter((s) => s.enabled !== false);

    if (enabledServers.length === 0) {
      return [];
    }

    log.info(`正在连接 ${enabledServers.length} 个 MCP Server...`);

    const results = await Promise.allSettled(
      enabledServers.map((config) => this.connectAndCollect(config))
    );

    const connectedCount = results.filter(
      (r) => r.status === 'fulfilled' && r.value !== null
    ).length;

    log.info(
      `MCP: ${connectedCount}/${enabledServers.length} 个 Server 已连接，` +
        `共 ${this.toolRegistrations.length} 个工具`
    );

    return this.toolRegistrations;
  }

  /**
   * 关闭所有 MCP 连接，释放资源
   */
  async shutdown(): Promise<void> {
    if (this.connections.length === 0) return;

    log.info(`正在关闭 ${this.connections.length} 个 MCP 连接...`);
    await Promise.allSettled(this.connections.map((conn) => closeMcpServer(conn)));
    this.connections = [];
    this.toolRegistrations = [];
  }

  /** 获取当前已注册的 MCP 工具列表（只读） */
  getTools(): readonly ToolRegistration[] {
    return this.toolRegistrations;
  }

  /** 连接单个 server 并将其工具转为 ToolRegistration */
  private async connectAndCollect(config: McpServerConfig): Promise<McpConnection | null> {
    const conn = await connectMcpServer(config);
    if (!conn) return null;

    this.connections.push(conn);

    for (const tool of conn.tools) {
      this.toolRegistrations.push(mcpToolToRegistration(tool, conn.serverName, conn.client));
    }

    return conn;
  }
}

/**
 * 便捷工厂函数：连接所有 MCP Server 并注册工具到 Agent
 *
 * @param servers - MCP Server 配置列表
 * @param agent - 目标 LlmBasedAgent 实例
 * @returns McpManager 实例（调用方负责在退出时 shutdown）
 */
export async function initializeMcpTools(
  servers: McpServerConfig[],
  agent: LlmBasedAgent
): Promise<McpManager> {
  const manager = new McpManager();
  const tools = await manager.initialize(servers);
  if (tools.length > 0) {
    agent.registerTools(tools);
  }
  return manager;
}
