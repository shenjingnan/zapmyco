import type { Client } from '@modelcontextprotocol/sdk/client';
import type { Tool } from '@modelcontextprotocol/sdk/spec.types';
import { describe, expect, it, vi } from 'vitest';
import { mcpToolToRegistration } from '@/core/mcp/mcp-tool-adapter';

function makeMockTool(overrides?: Partial<Tool>): Tool {
  const base: Tool = {
    name: 'test_tool',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } as unknown as object },
      required: ['query'],
    },
    ...overrides,
  } as Tool;
  return base;
}

describe('mcp-tool-adapter', () => {
  describe('mcpToolToRegistration', () => {
    it('should generate id with mcp__server__tool naming convention', () => {
      const tool = makeMockTool({ name: 'search_files' });
      const mockClient = { callTool: vi.fn() } as unknown as Client;
      const reg = mcpToolToRegistration(tool, 'filesystem', mockClient);
      expect(reg.id).toBe('mcp__filesystem__search_files');
    });

    it('should generate label with server:tool format', () => {
      const tool = makeMockTool({ name: 'read_file' });
      const mockClient = { callTool: vi.fn() } as unknown as Client;
      const reg = mcpToolToRegistration(tool, 'fs', mockClient);
      expect(reg.label).toBe('fs:read_file');
    });

    it('should use tool description when provided', () => {
      const tool = makeMockTool({ description: 'Search for files in the filesystem' });
      const mockClient = { callTool: vi.fn() } as unknown as Client;
      const reg = mcpToolToRegistration(tool, 'fs', mockClient);
      expect(reg.description).toBe('Search for files in the filesystem');
    });

    it('should generate fallback description when tool has no description', () => {
      // 使用 makeMockTool 时不传 description，tool 就不会有 description 属性
      const tool = makeMockTool();
      const mockClient = { callTool: vi.fn() } as unknown as Client;
      const reg = mcpToolToRegistration(tool, 'fs', mockClient);
      expect(reg.description).toContain('MCP tool: test_tool');
      expect(reg.description).toContain('(from fs)');
    });

    it('should convert inputSchema to parameters', () => {
      const tool = makeMockTool({
        inputSchema: {
          type: 'object',
          properties: { filename: { type: 'string' } as unknown as object },
          required: ['filename'],
        },
      });
      const mockClient = { callTool: vi.fn() } as unknown as Client;
      const reg = mcpToolToRegistration(tool, 'fs', mockClient);
      expect(reg.parameters).toBeDefined();
      expect((reg.parameters as Record<string, unknown>).type).toBe('object');
      expect((reg.parameters as Record<string, unknown>).required).toEqual(['filename']);
    });

    it('should handle empty inputSchema gracefully', () => {
      const tool = makeMockTool({
        inputSchema: { type: 'object' as const, properties: {}, required: [] },
      });
      const mockClient = { callTool: vi.fn() } as unknown as Client;
      const reg = mcpToolToRegistration(tool, 'fs', mockClient);
      expect((reg.parameters as Record<string, unknown>).properties).toEqual({});
      expect((reg.parameters as Record<string, unknown>).required).toEqual([]);
    });

    it('should call client.callTool on execute with correct arguments', async () => {
      const tool = makeMockTool({ name: 'do_thing' });
      const callTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text' as const, text: 'result' }],
        isError: false,
      });
      const mockClient = { callTool } as unknown as Client;
      const reg = mcpToolToRegistration(tool, 'my_server', mockClient);

      const result = await reg.execute('call_1' as Parameters<typeof reg.execute>[0], {
        query: 'hello',
      });

      expect(callTool).toHaveBeenCalledWith({
        name: 'do_thing',
        arguments: { query: 'hello' },
      });
      expect(result.content[0]).toEqual({ type: 'text', text: 'result' });
    });

    it('should propagate isError in details', async () => {
      const tool = makeMockTool({ name: 'failing_tool' });
      const callTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text' as const, text: 'error message' }],
        isError: true,
      });
      const mockClient = { callTool } as unknown as Client;
      const reg = mcpToolToRegistration(tool, 'srv', mockClient);

      const result = await reg.execute('call_2' as Parameters<typeof reg.execute>[0], {});

      expect(result.details).toEqual({
        isError: true,
        serverName: 'srv',
        toolName: 'failing_tool',
      });
    });

    it('should default isError to false when not present', async () => {
      const tool = makeMockTool({ name: 'ok_tool' });
      const callTool = vi.fn().mockResolvedValue({
        content: [],
      });
      const mockClient = { callTool } as unknown as Client;
      const reg = mcpToolToRegistration(tool, 'srv', mockClient);

      const result = await reg.execute('call_3' as Parameters<typeof reg.execute>[0], {});

      expect(result.details).toMatchObject({ isError: false });
    });
  });
});
