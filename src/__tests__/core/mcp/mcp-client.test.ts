import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from '@/config/types';

const mockConnect = vi.fn();
const mockListTools = vi.fn();
const mockClose = vi.fn();
const mockTransportClose = vi.fn();

// Mock MCP SDK modules at the file level to avoid package.json exports resolution issues
vi.mock('@modelcontextprotocol/sdk/client', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    close: mockClose,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    close: mockTransportClose,
  })),
}));

function makeConfig(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    name: 'test-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'some-mcp-server'],
    ...overrides,
  };
}

describe('mcp-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('connectMcpServer', () => {
    it('should connect and return tools on success', async () => {
      mockConnect.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({
        tools: [
          { name: 'tool_a', inputSchema: { type: 'object', properties: {} } },
          { name: 'tool_b', inputSchema: { type: 'object', properties: {} } },
        ],
      });

      const { connectMcpServer } = await import('@/core/mcp/mcp-client');
      const conn = await connectMcpServer(makeConfig());

      expect(conn).not.toBeNull();
      expect(conn!.serverName).toBe('test-server');
      expect(conn!.tools).toHaveLength(2);
      expect(conn!.tools[0]!.name).toBe('tool_a');
    });

    it('should return null on connection failure', async () => {
      mockConnect.mockRejectedValue(new Error('Connection refused'));

      const { connectMcpServer } = await import('@/core/mcp/mcp-client');
      const conn = await connectMcpServer(makeConfig());

      expect(conn).toBeNull();
    });

    it('should return null on listTools timeout', async () => {
      mockConnect.mockResolvedValue(undefined);
      mockListTools.mockRejectedValue(new Error('操作超时 (15000ms)'));

      const { connectMcpServer } = await import('@/core/mcp/mcp-client');
      const conn = await connectMcpServer(makeConfig());

      expect(conn).toBeNull();
    });

    it('should handle empty tool list', async () => {
      mockConnect.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({ tools: [] });

      const { connectMcpServer } = await import('@/core/mcp/mcp-client');
      const conn = await connectMcpServer(makeConfig());

      expect(conn).not.toBeNull();
      expect(conn!.tools).toHaveLength(0);
    });

    it('should pass transport options correctly', async () => {
      mockConnect.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({ tools: [] });

      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio');
      const { connectMcpServer } = await import('@/core/mcp/mcp-client');

      await connectMcpServer(
        makeConfig({
          command: 'python',
          args: ['-m', 'my_mcp_server'],
          env: { FOO: 'bar' },
          cwd: '/tmp',
        })
      );

      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'python',
          args: ['-m', 'my_mcp_server'],
          env: { FOO: 'bar' },
          cwd: '/tmp',
          stderr: 'pipe',
        })
      );
    });

    it('should handle aborted signal before connection', async () => {
      const controller = new AbortController();
      controller.abort();

      const { connectMcpServer } = await import('@/core/mcp/mcp-client');
      const conn = await connectMcpServer(makeConfig(), controller.signal);

      expect(conn).toBeNull();
    });
  });

  describe('closeMcpServer', () => {
    it('should close transport and client', async () => {
      mockTransportClose.mockResolvedValue(undefined);
      mockClose.mockResolvedValue(undefined);

      const { closeMcpServer } = await import('@/core/mcp/mcp-client');
      const conn = {
        transport: { close: mockTransportClose },
        client: { close: mockClose },
        serverName: 'test',
        tools: [],
      } as unknown as Parameters<typeof closeMcpServer>[0];

      await closeMcpServer(conn);

      expect(mockTransportClose).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });

    it('should not throw if close fails', async () => {
      mockTransportClose.mockRejectedValue(new Error('Already closed'));

      const { closeMcpServer } = await import('@/core/mcp/mcp-client');
      const conn = {
        transport: { close: mockTransportClose },
        client: { close: mockClose },
        serverName: 'test',
        tools: [],
      } as unknown as Parameters<typeof closeMcpServer>[0];

      await expect(closeMcpServer(conn)).resolves.not.toThrow();
    });
  });
});
