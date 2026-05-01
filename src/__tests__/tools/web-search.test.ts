import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebSearchTool } from '@/cli/repl/tools/web-search';
import type { WebConfig } from '@/config/types';

const originalFetch = globalThis.fetch;

function makeBaseConfig(): WebConfig {
  return {
    enabled: true,
    search: {
      provider: 'tavily',
      maxResults: 5,
      language: 'zh-cn',
      cacheTtlMinutes: 1,
    },
  };
}

describe('createWebSearchTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('Provider 分发逻辑', () => {
    it('未知的 provider 应该抛出错误', async () => {
      const config = makeBaseConfig();
      config.search!.provider = 'unknown' as any;
      const tool = createWebSearchTool(config);
      await expect(tool.execute('test', { query: 'test' })).rejects.toThrow(/未知搜索引擎/);
    });
  });

  describe('Tavily Provider', () => {
    it('没有 API Key 时应该返回引导错误', async () => {
      const config = makeBaseConfig();
      // 不设置 apiKey
      const tool = createWebSearchTool(config);
      await expect(tool.execute('test', { query: 'hello world' })).rejects.toThrow(/API Key/);
    });

    it('有 API Key 时应该执行搜索', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              { title: '结果1', url: 'https://example.com/1', content: '摘要内容1' },
              { title: '结果2', url: 'https://example.com/2', content: '摘要内容2' },
            ],
          }),
      });

      const config = makeBaseConfig();
      config.search!.apiKey = 'tvly-test-key';
      const tool = createWebSearchTool(config);
      const result = await tool.execute('test', { query: 'TypeScript' });

      expect(result.content[0]?.text).toContain('找到 2 条搜索结果');
      expect(result.content[0]?.text).toContain('**结果1**');
      expect(result.content[0]?.text).toContain('https://example.com/1');
      expect(result.details.resultCount).toBe(2);
      expect(result.details.provider).toBe('tavily');
    });

    it('搜索无结果时应返回空结果提示', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });

      const config = makeBaseConfig();
      config.search!.apiKey = 'tvly-test-key';
      const tool = createWebSearchTool(config);
      const result = await tool.execute('test', { query: 'xyznonexistent' });

      expect(result.content[0]?.text).toContain('未找到');
      expect(result.details.resultCount).toBe(0);
    });

    it('API 返回错误状态码时应该抛出错误', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const config = makeBaseConfig();
      config.search!.apiKey = 'invalid-key';
      const tool = createWebSearchTool(config);
      await expect(tool.execute('test', { query: 'test' })).rejects.toThrow(/API 错误/);
    });
  });

  describe('DuckDuckGo Provider（兜底）', () => {
    it('无需 API Key 即可工作', async () => {
      const ddgHtml = `
        <html>
          <body>
            <div class="result">
              <a class="result__title" href="https://example.com"><h2>DDG 结果标题</h2></a>
              <a class="result__url" href="https://example.com">example.com</a>
              <a class="result__snippet">这是 DDG 摘要内容</a>
            </div>
          </body>
        </html>
      `;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(ddgHtml),
      });

      const config = makeBaseConfig();
      config.search!.provider = 'duckduckgo';
      const tool = createWebSearchTool(config);
      const result = await tool.execute('test', { query: 'test search' });

      expect(result.content[0]?.text).toContain('DDG 结果标题');
      expect(result.details.provider).toBe('duckduckgo');
    });
  });

  describe('缓存', () => {
    it('相同查询应该命中缓存', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [{ title: 'Cached', url: 'https://cached.com', content: 'Cached snippet' }],
            }),
        });
      });

      const config = makeBaseConfig();
      config.search!.apiKey = 'tvly-test-key';
      const tool = createWebSearchTool(config);

      await tool.execute('t1', { query: 'cached query' });
      const r2 = await tool.execute('t2', { query: 'cached query' });

      expect(r2.details.cached).toBe(true);
      expect(callCount).toBe(1);
    });
  });

  describe('numResults 参数', () => {
    it('应该使用指定的结果数量', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: Array.from({ length: 3 }, (_, i) => ({
              title: `结果${i + 1}`,
              url: `https://example.com/${i + 1}`,
              content: `内容${i + 1}`,
            })),
          }),
      });

      const config = makeBaseConfig();
      config.search!.apiKey = 'tvly-test-key';
      const tool = createWebSearchTool(config);
      const result = await tool.execute('test', { query: 'test', numResults: 3 });

      expect(result.content[0]?.text).toContain('找到 3 条搜索结果');
    });
  });
});
