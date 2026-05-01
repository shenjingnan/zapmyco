import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebFetchTool } from '@/cli/repl/tools/web-fetch';

// Mock SSRF guard — 避免测试依赖真实 DNS 解析
// 保留协议/hostname 检查逻辑，跳过 DNS/IP 检查返回公网安全结果
vi.mock('@/cli/repl/tools/ssrf-guard', () => {
  const BLOCKED_HOSTNAMES = [
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
    'metadata.google.internal',
  ];

  function isBlockedHostname(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.includes(lower)) return true;
    if (lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal'))
      return true;
    return false;
  }

  return {
    checkUrlSafety: vi.fn(
      async (
        url: string,
        _options?: {
          allowPrivateNetwork?: boolean;
          allowedDomains?: string[];
          blockedDomains?: string[];
        }
      ) => {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return { allowed: false, reason: `无效的 URL: ${url}` };
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { allowed: false, reason: `不允许的协议: ${parsed.protocol}` };
        }
        if (isBlockedHostname(parsed.hostname)) {
          return { allowed: false, reason: `被阻止的 hostname: ${parsed.hostname}` };
        }
        // 跳过 DNS 解析和 IP 检查，直接放行
        return { allowed: true };
      }
    ),
  };
});

// 保存原始 fetch
const originalFetch = globalThis.fetch;

describe('createWebFetchTool', () => {
  const webConfig = {
    enabled: true,
    fetch: {
      timeoutMs: 5000,
      maxResponseBytes: 1024,
      maxChars: 500,
      extractMainContent: true,
      cacheTtlMinutes: 1,
    },
    ssrf: { allowPrivateNetwork: false },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('正常抓取', () => {
    it('应该成功抓取 HTML 页面并转换为 Markdown', async () => {
      const mockHtml =
        '<html><head><title>测试</title></head><body><main><h1>标题</h1><p>内容</p></main></body></html>';
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(mockHtml).buffer),
      });

      const tool = createWebFetchTool(webConfig);
      const result = await tool.execute('test-call', { url: 'https://example.com' });
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('# 测试');
      expect(result.details.statusCode).toBe(200);
      expect(result.details.truncated).toBe(false);
    });

    it('应该正确处理 JSON 响应', async () => {
      const jsonData = JSON.stringify({ name: 'test', value: 42 });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(jsonData).buffer),
      });

      const tool = createWebFetchTool(webConfig);
      const result = await tool.execute('test-call', { url: 'https://api.example.com/data' });
      expect(result.content[0]?.text).toContain('"name": "test"');
      expect(result.details.extractionMethod).toBe('raw');
    });
  });

  describe('SSRF 防护', () => {
    it('应该阻止 localhost URL', async () => {
      const tool = createWebFetchTool(webConfig);
      await expect(tool.execute('test-call', { url: 'http://localhost:8080' })).rejects.toThrow(
        /被阻止|BLOCKED/
      );
    });

    it('应该阻止 file:// 协议', async () => {
      const tool = createWebFetchTool(webConfig);
      await expect(tool.execute('test-call', { url: 'file:///etc/passwd' })).rejects.toThrow();
    });
  });

  describe('HTTP 错误处理', () => {
    it('应该处理 404 错误', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

      const tool = createWebFetchTool(webConfig);
      await expect(
        tool.execute('test-call', { url: 'https://example.com/notfound' })
      ).rejects.toThrow(/HTTP 404/);
    });

    it('应该处理超时', async () => {
      // 模拟超时 — fetch 抛出 AbortError
      globalThis.fetch = vi.fn().mockImplementation(() => {
        const err = new DOMException('The operation was aborted', 'AbortError');
        return Promise.reject(err);
      });

      const tool = createWebFetchTool(webConfig);
      await expect(tool.execute('test-call', { url: 'https://slow.example.com' })).rejects.toThrow(
        /超时|timeout/i
      );
    });
  });

  describe('缓存', () => {
    it('第二次请求相同 URL 应该命中缓存', async () => {
      let callCount = 0;
      const mockHtml =
        '<html><head><title>Cached</title></head><body><p>缓存测试</p></body></html>';
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(mockHtml).buffer),
        });
      });

      const tool = createWebFetchTool(webConfig);

      // 第一次请求
      const r1 = await tool.execute('test-call', { url: 'https://cache.example.com' });
      expect(r1.details.cached).toBe(false);

      // 第二次请求（应命中缓存）
      const r2 = await tool.execute('test-call2', { url: 'https://cache.example.com' });
      expect(r2.details.cached).toBe(true);

      // fetch 应该只被调用一次
      expect(callCount).toBe(1);
    });
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
