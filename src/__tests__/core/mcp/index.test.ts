import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from '@/config/types';

// Mock mcp-client module to avoid actual subprocess spawning
vi.mock('@/core/mcp/mcp-client', () => ({
  connectMcpServer: vi.fn(),
  closeMcpServer: vi.fn(),
}));

function makeServerConfig(name: string, overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    name,
    transport: 'stdio',
    command: 'npx',
    ...overrides,
  };
}

function makeTool(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: 'object' as const, properties: {} },
  };
}

describe('McpManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('initialize', () => {
    it('should return empty tools when no servers configured', async () => {
      const { McpManager } = await import('@/core/mcp');
      const manager = new McpManager();
      const tools = await manager.initialize([]);
      expect(tools).toHaveLength(0);
    });

    it('should skip disabled servers', async () => {
      const { McpManager } = await import('@/core/mcp');
      const manager = new McpManager();
      const tools = await manager.initialize([makeServerConfig('s1', { enabled: false })]);
      expect(tools).toHaveLength(0);
    });

    it('should connect and collect tools from a single server', async () => {
      const { connectMcpServer } = await import('@/core/mcp/mcp-client');
      (connectMcpServer as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: { callTool: vi.fn() },
        transport: { close: vi.fn() },
        tools: [makeTool('tool_1'), makeTool('tool_2')],
        serverName: 'srv',
      });

      const { McpManager } = await import('@/core/mcp');
      const manager = new McpManager();
      const tools = await manager.initialize([makeServerConfig('srv')]);

      expect(tools).toHaveLength(2);
      expect(tools[0]!.id).toBe('mcp__srv__tool_1');
      expect(tools[1]!.id).toBe('mcp__srv__tool_2');
    });

    it('should handle one server failing while another succeeds', async () => {
      const { connectMcpServer } = await import('@/core/mcp/mcp-client');
      (connectMcpServer as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null) // server A fails
        .mockResolvedValueOnce({
          // server B succeeds
          client: { callTool: vi.fn() },
          transport: { close: vi.fn() },
          tools: [makeTool('tool_b')],
          serverName: 'server_b',
        });

      const { McpManager } = await import('@/core/mcp');
      const manager = new McpManager();
      const tools = await manager.initialize([
        makeServerConfig('server_a'),
        makeServerConfig('server_b'),
      ]);

      // Only server_b's tools should be available
      expect(tools).toHaveLength(1);
      expect(tools[0]!.id).toBe('mcp__server_b__tool_b');
    });

    it('should handle all servers failing', async () => {
      const { connectMcpServer } = await import('@/core/mcp/mcp-client');
      (connectMcpServer as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { McpManager } = await import('@/core/mcp');
      const manager = new McpManager();
      const tools = await manager.initialize([makeServerConfig('a'), makeServerConfig('b')]);

      expect(tools).toHaveLength(0);
    });
  });

  describe('shutdown', () => {
    it('should close all active connections', async () => {
      const { connectMcpServer } = await import('@/core/mcp/mcp-client');
      const transport1 = { close: vi.fn() };
      const transport2 = { close: vi.fn() };
      (connectMcpServer as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          client: { callTool: vi.fn() },
          transport: transport1,
          tools: [makeTool('t1')],
          serverName: 's1',
        })
        .mockResolvedValueOnce({
          client: { callTool: vi.fn() },
          transport: transport2,
          tools: [makeTool('t2')],
          serverName: 's2',
        });

      const { McpManager } = await import('@/core/mcp');
      const manager = new McpManager();
      await manager.initialize([makeServerConfig('s1'), makeServerConfig('s2')]);

      const { closeMcpServer } = await import('@/core/mcp/mcp-client');
      await manager.shutdown();

      expect(closeMcpServer).toHaveBeenCalledTimes(2);
      expect(manager.getTools()).toHaveLength(0);
    });

    it('should not throw when shutdown with no connections', async () => {
      const { McpManager } = await import('@/core/mcp');
      const manager = new McpManager();
      await expect(manager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('getTools', () => {
    it('should return empty array before initialize', async () => {
      const { McpManager } = await import('@/core/mcp');
      const manager = new McpManager();
      expect(manager.getTools()).toHaveLength(0);
    });
  });
});

describe('initializeMcpTools', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should register MCP tools on agent', async () => {
    const { connectMcpServer } = await import('@/core/mcp/mcp-client');
    (connectMcpServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      client: { callTool: vi.fn() },
      transport: { close: vi.fn() },
      tools: [makeTool('hello')],
      serverName: 'demo',
    });

    const registerTools = vi.fn();
    const mockAgent = { registerTools } as unknown as Parameters<
      typeof import('@/core/mcp').initializeMcpTools
    >[1];

    const { initializeMcpTools } = await import('@/core/mcp');
    const manager = await initializeMcpTools([makeServerConfig('demo')], mockAgent);

    expect(registerTools).toHaveBeenCalledTimes(1);
    const registeredTools: unknown[] = registerTools.mock.calls[0]![0];
    expect(registeredTools).toHaveLength(1);
    expect((registeredTools[0]! as { id: string }).id).toBe('mcp__demo__hello');
    expect(manager).toBeDefined();
  });

  it('should not register tools when no servers configured', async () => {
    const registerTools = vi.fn();
    const mockAgent = { registerTools } as unknown as Parameters<
      typeof import('@/core/mcp').initializeMcpTools
    >[1];

    const { initializeMcpTools } = await import('@/core/mcp');
    await initializeMcpTools([], mockAgent);

    expect(registerTools).not.toHaveBeenCalled();
  });
});
