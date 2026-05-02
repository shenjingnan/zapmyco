/**
 * MCP Tool → ToolRegistration 适配器
 *
 * 将 MCP SDK 的 Tool 对象转换为 zapmyco 的 ToolRegistration，
 * 使 MCP 工具能无缝接入 Agent 的工具注册体系。
 *
 * @module core/mcp/tool-adapter
 */

import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Client } from '@modelcontextprotocol/sdk/client';
import type { Tool } from '@modelcontextprotocol/sdk/spec.types';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';

/**
 * 将单个 MCP Tool 转换为 zapmyco ToolRegistration
 *
 * MCP SDK 的 TextContent / ImageContent 与 pi-ai 对应类型结构兼容
 * （都是 { type, text/data, mimeType }），因此直接透传 content。
 */
export function mcpToolToRegistration(
  mcpTool: Tool,
  serverName: string,
  client: Client
): ToolRegistration {
  // exactOptionalPropertyTypes 下需要显式类型断言
  const parameters = {
    type: 'object' as const,
    properties: { ...(mcpTool.inputSchema?.properties ?? {}) },
    required: [...(mcpTool.inputSchema?.required ?? [])],
  };

  return {
    id: `mcp__${serverName}__${mcpTool.name}`,
    label: `${serverName}:${mcpTool.name}`,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name} (from ${serverName})`,
    parameters,
    execute: async (_toolCallId, params) => {
      const result = await client.callTool({
        name: mcpTool.name,
        arguments: params as Record<string, unknown>,
      });

      return {
        content: result.content as unknown as AgentToolResult<unknown>['content'],
        details: {
          isError: result.isError ?? false,
          serverName,
          toolName: mcpTool.name,
        },
      };
    },
  } as ToolRegistration;
}
