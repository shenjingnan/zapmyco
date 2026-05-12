/**
 * LSP 客户端集成测试
 *
 * 使用 Fake LSP Server（JSON-RPC 2.0 测试替身）验证：
 * - 客户端启动/关闭
 * - initialize 握手
 * - 请求-响应
 * - 通知处理
 * - 超时/错误处理
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createLspClient, type LspClient } from '@/core/lsp/lsp-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const FAKE_SERVER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-lsp-server.cjs'
);

describe('LspClient', () => {
  const clients: LspClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      try {
        await client.shutdown();
      } catch {
        // 忽略
      }
    }
  });

  function createTestClient(overrides?: Record<string, unknown>): LspClient {
    const client = createLspClient({
      command: process.execPath,
      args: [FAKE_SERVER_PATH],
      connectTimeoutMs: 10000,
      requestTimeoutMs: 5000,
      ...overrides,
    });
    clients.push(client);
    return client;
  }

  // ============ 生命周期 ============

  describe('lifecycle', () => {
    it('should initialize and return capabilities', async () => {
      const client = createTestClient();
      const result = await client.initialize('file:///project');

      expect(result.capabilities).toBeDefined();
      expect(result.capabilities.definitionProvider).toBe(true);
      expect(result.serverInfo?.name).toBe('fake-lsp-server');
      expect(client.isAlive()).toBe(true);
    });

    it('should shutdown gracefully', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');
      await client.shutdown();
      expect(client.isAlive()).toBe(false);
    });

    it('should handle double shutdown safely', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');
      await client.shutdown();
      await client.shutdown();
    });
  });

  // ============ 请求 ============

  describe('requests', () => {
    it('should handle goToDefinition', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');

      const result = await client.sendRequest<AnyRecord[]>('textDocument/definition', {
        textDocument: { uri: 'file:///project/src/index.ts' },
        position: { line: 0, character: 0 },
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]?.uri).toContain('index.ts');
    });

    it('should handle findReferences', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');

      const result = await client.sendRequest<AnyRecord[]>('textDocument/references', {
        textDocument: { uri: 'file:///project/src/index.ts' },
        position: { line: 0, character: 0 },
        context: { includeDeclaration: true },
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it('should handle hover', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');

      const result = await client.sendRequest<AnyRecord>('textDocument/hover', {
        textDocument: { uri: 'file:///project/src/index.ts' },
        position: { line: 0, character: 0 },
      });

      expect(result).toBeDefined();
      expect(result.contents).toBeDefined();
    });

    it('should handle documentSymbol', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');

      const result = await client.sendRequest<AnyRecord[]>('textDocument/documentSymbol', {
        textDocument: { uri: 'file:///project/src/index.ts' },
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]?.name).toBe('MyClass');
      expect(result[0]?.children).toHaveLength(1);
    });

    it('should handle workspaceSymbol', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');

      const result = await client.sendRequest<AnyRecord[]>('workspace/symbol', {
        query: 'MyClass',
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]?.name).toBe('MyClass');
    });

    it('should handle goToImplementation', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');

      const result = await client.sendRequest<AnyRecord[]>('textDocument/implementation', {
        textDocument: { uri: 'file:///project/src/index.ts' },
        position: { line: 0, character: 0 },
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]?.uri).toContain('impl.ts');
    });

    it('should handle prepareCallHierarchy', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');

      const result = await client.sendRequest<AnyRecord[]>('textDocument/prepareCallHierarchy', {
        textDocument: { uri: 'file:///project/src/index.ts' },
        position: { line: 0, character: 0 },
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]?.name).toBe('myFunction');
    });

    it('should handle incomingCalls', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');

      const result = await client.sendRequest<AnyRecord[]>('callHierarchy/incomingCalls', {
        item: {
          name: 'myFunction',
          kind: 12,
          uri: 'file:///project/src/index.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        },
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]?.from.name).toBe('callerA');
    });

    it('should handle outgoingCalls', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');

      const result = await client.sendRequest<AnyRecord[]>('callHierarchy/outgoingCalls', {
        item: {
          name: 'myFunction',
          kind: 12,
          uri: 'file:///project/src/index.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        },
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]?.to.name).toBe('calleeB');
    });
  });

  // ============ 通知 ============

  describe('notifications', () => {
    it('should handle publishDiagnostics notification', async () => {
      const client = createTestClient();

      const diagnosticsPromise = new Promise<unknown>((resolve) => {
        client.onNotification('textDocument/publishDiagnostics', (params) => {
          resolve(params);
        });
      });

      await client.initialize('file:///project');

      const result = (await diagnosticsPromise) as AnyRecord;
      expect(result).toBeDefined();
      expect(result.diagnostics).toBeDefined();
    });

    it('should remove notification handler', async () => {
      const client = createTestClient();
      let callCount = 0;
      const handler = () => {
        callCount++;
      };

      client.onNotification('textDocument/publishDiagnostics', handler);
      await client.initialize('file:///project');

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(callCount).toBeGreaterThan(0);
      const beforeRemove = callCount;

      client.offNotification('textDocument/publishDiagnostics', handler);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(callCount).toBe(beforeRemove);
    });
  });

  // ============ 错误处理 ============

  describe('error handling', () => {
    it('should timeout on unresponsive server', async () => {
      const client = createLspClient({
        command: 'non-existent-lsp-command-xyz',
        args: [],
        connectTimeoutMs: 2000,
      });
      clients.push(client);

      await expect(client.initialize('file:///project')).rejects.toThrow();
    });

    it('should reject when sending request on not-started client', async () => {
      const client = createTestClient();
      await expect(client.sendRequest('textDocument/definition', {})).rejects.toThrow(
        'not started'
      );
    });

    it('should handle unknown method', async () => {
      const client = createTestClient();
      await client.initialize('file:///project');

      await expect(client.sendRequest('unknown/method')).rejects.toThrow();
    });
  });

  // ============ 能力 ============

  describe('capabilities', () => {
    it('should return null before initialize', () => {
      const client = createTestClient();
      expect(client.getCapabilities()).toBeNull();
    });

    it('should return capabilities after initialize', async () => {
      const client = createTestClient();
      const result = await client.initialize('file:///project');
      const caps = client.getCapabilities();

      expect(caps).toBeDefined();
      expect(caps).toEqual(result.capabilities);
    });
  });
});
