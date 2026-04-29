import { describe, expect, it } from 'vitest';
import { getAvailableProviders, resolveSearchProvider } from '@/cli/repl/tools/search-providers';

describe('Provider 注册表', () => {
  describe('getAvailableProviders', () => {
    it('应该返回所有已注册的 Provider 名称', () => {
      const providers = getAvailableProviders();
      expect(providers).toContain('tavily');
      expect(providers).toContain('serpapi');
      expect(providers).toContain('duckduckgo');
      expect(providers).toContain('custom');
      expect(providers).toHaveLength(4);
    });
  });

  describe('resolveSearchProvider', () => {
    it('应该正确解析 tavily provider', () => {
      const p = resolveSearchProvider('tavily');
      expect(p.name).toBe('tavily');
      expect(p.label).toBe('Tavily');
      expect(p.requiresApiKey).toBe(true);
    });

    it('应该正确解析 serpapi provider', () => {
      const p = resolveSearchProvider('serpapi');
      expect(p.name).toBe('serpapi');
      expect(p.requiresApiKey).toBe(true);
    });

    it('应该正确解析 duckduckgo provider', () => {
      const p = resolveSearchProvider('duckduckgo');
      expect(p.name).toBe('duckduckgo');
      expect(p.label).toBe('DuckDuckGo');
      expect(p.requiresApiKey).toBe(false);
    });

    it('应该正确解析 custom provider', () => {
      const p = resolveSearchProvider('custom');
      expect(p.name).toBe('custom');
      expect(p.requiresApiKey).toBe(false);
    });

    it('未知的 provider 名称应该抛出错误', () => {
      expect(() => resolveSearchProvider('unknown')).toThrow(/未知搜索引擎/);
    });
  });
});

describe('TavilyProvider', () => {
  it('没有 API Key 时 isAvailable 应该返回 false', async () => {
    const p = resolveSearchProvider('tavily');
    expect(await p.isAvailable({})).toBe(false);
  });

  it('有 API Key 时 isAvailable 应该返回 true', async () => {
    const p = resolveSearchProvider('tavily');
    expect(await p.isAvailable({ apiKey: 'test-key' })).toBe(true);
  });
});

describe('SerpApiProvider', () => {
  it('没有 API Key 时 isAvailable 应该返回 false', async () => {
    const p = resolveSearchProvider('serpapi');
    expect(await p.isAvailable({})).toBe(false);
  });

  it('有 API Key 时 isAvailable 应该返回 true', async () => {
    const p = resolveSearchProvider('serpapi');
    expect(await p.isAvailable({ apiKey: 'test-key' })).toBe(true);
  });
});

describe('DuckDuckGoProvider', () => {
  it('isAvailable 始终返回 true（无需 API Key）', async () => {
    const p = resolveSearchProvider('duckduckgo');
    expect(await p.isAvailable({})).toBe(true);
  });
});

describe('CustomProvider', () => {
  it('没有 endpointUrl 时 isAvailable 应该返回 false', async () => {
    const p = resolveSearchProvider('custom');
    expect(await p.isAvailable({})).toBe(false);
  });

  it('有 endpointUrl 时 isAvailable 应该返回 true', async () => {
    const p = resolveSearchProvider('custom');
    expect(await p.isAvailable({ endpointUrl: 'https://example.com/search' })).toBe(true);
  });

  it('没有 endpointUrl 时 search 应该抛出错误', async () => {
    const p = resolveSearchProvider('custom');
    await expect(p.search('test', { maxResults: 5 }, {})).rejects.toThrow(/endpointUrl/);
  });
});
