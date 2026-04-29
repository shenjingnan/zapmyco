/**
 * web_search 工具实现
 *
 * 功能：
 * - 插件化搜索引擎分发
 * - 搜索结果格式化输出
 * - 缓存支持
 *
 * @module cli/repl/tools/web-search
 */

import type { WebConfig } from '@/config/types';
import { WebError, ZapmycoErrorCode } from '@/infra/errors';
import { createCache } from './cache';
import { getAvailableProviders, resolveSearchProvider } from './search-providers';
import type {
  SearchProviderConfig,
  SearchResultItem,
  WebSearchDetails,
  WebSearchParams,
} from './types';

// ============ 常量 ============

const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_LANGUAGE = 'zh-cn';

// ============ 缓存实例 ============

let searchCache: ReturnType<typeof createCache<string>> | null = null;

function getSearchCache(ttlMinutes: number = 15): ReturnType<typeof createCache<string>> {
  if (!searchCache) {
    searchCache = createCache<string>({
      ttlMs: ttlMinutes * 60 * 1000,
      maxEntries: 100,
    });
  }
  return searchCache;
}

// ============ 辅助函数 ============

/**
 * 构建缓存 key
 */
function buildCacheKey(query: string, provider: string, numResults: number): string {
  return `search:${query}:${provider}:${numResults}`;
}

/**
 * 格式化搜索结果为 Markdown 文本
 */
function formatResults(results: SearchResultItem[], query: string, provider: string): string {
  if (results.length === 0) {
    return `未找到与 "${query}" 相关的搜索结果（来源: ${provider}）。`;
  }

  const lines: string[] = [`找到 ${results.length} 条搜索结果 (来源: ${provider}):`, ''];

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    lines.push(`${i + 1}. **${r.title}**`);
    lines.push(`   ${r.url}`);
    if (r.snippet) {
      lines.push(`   ${r.snippet}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============ 工具注册 ============

/**
 * 创建 web_search 工具注册信息
 */
export function createWebSearchTool(webConfig?: WebConfig) {
  const searchOptions = webConfig?.search ?? {};
  const cacheTtlMinutes = searchOptions.cacheTtlMinutes ?? 15;

  return {
    id: 'web_search' as const,
    label: '网页搜索' as const,
    description:
      '在互联网上搜索信息。支持多种搜索引擎后端。当用户需要查找最新信息、技术文档、新闻等时调用此工具。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词或自然语言查询',
        },
        numResults: {
          type: 'number',
          description: '返回结果数量（1-20，默认 8）',
        },
      },
      required: ['query'],
    } as const,

    async execute(_toolCallId: string, params: WebSearchParams, signal?: AbortSignal) {
      const startTime = Date.now();
      const { query } = params;
      const numResults = Math.min(
        params.numResults ?? searchOptions.maxResults ?? DEFAULT_MAX_RESULTS,
        20
      );
      const providerName = searchOptions.provider ?? 'tavily';
      const language = searchOptions.language ?? DEFAULT_LANGUAGE;

      // Step 1: 缓存检查
      const cache = getSearchCache(cacheTtlMinutes);
      const cacheKey = buildCacheKey(query, providerName, numResults);
      const cached = cache.get(cacheKey);
      if (cached) {
        return {
          content: [{ type: 'text', text: cached.value }],
          details: {
            query,
            provider: providerName,
            resultCount: 0,
            cached: true,
            elapsedMs: Date.now() - startTime,
          } satisfies WebSearchDetails,
        };
      }

      // Step 2: 解析 Provider
      let provider: ReturnType<typeof resolveSearchProvider>;
      try {
        provider = resolveSearchProvider(providerName);
      } catch (err) {
        throw new WebError(
          ZapmycoErrorCode.WEB_SEARCH_NOT_CONFIGURED,
          err instanceof Error ? err.message : String(err),
          { requestedProvider: providerName }
        );
      }

      // Step 3: 构建 Provider 配置
      const providerConfig: SearchProviderConfig = {};
      if (searchOptions.apiKey) providerConfig.apiKey = searchOptions.apiKey;
      if (searchOptions.endpointUrl) providerConfig.endpointUrl = searchOptions.endpointUrl;

      // Step 4: 检查 Provider 可用性
      const isAvail = await provider.isAvailable(providerConfig);
      if (!isAvail) {
        const available = getAvailableProviders()
          .filter((name) => name !== providerName)
          .join(', ');

        if (providerName === 'tavily') {
          throw new WebError(
            ZapmycoErrorCode.WEB_SEARCH_NOT_CONFIGURED,
            `Tavily 搜索未配置 API Key。\n\n` +
              `**解决方案：**\n` +
              `1. 获取免费 Tavily API Key: https://tavily.com\n` +
              `2. 设置环境变量: export TAVILY_API_KEY=tvly-xxxxx\n` +
              `3. 或在配置文件中设置: web.search.apiKey\n\n` +
              `**替代方案：** 切换到 DuckDuckGo（免费无需 Key）:\n` +
              `在配置文件中设置 web.search.provider = "duckduckgo"\n\n` +
              `可用搜索引擎: ${available}, ${providerName}`,
            { requestedProvider: providerName, availableProviders: getAvailableProviders() }
          );
        }

        throw new WebError(
          ZapmycoErrorCode.WEB_SEARCH_NOT_CONFIGURED,
          `${provider.label} 搜索不可用。请检查 API Key 配置。\n\n` + `可用替代引擎: ${available}`,
          { requestedProvider: providerName, availableProviders: getAvailableProviders() }
        );
      }

      // Step 5: 执行搜索
      let results: SearchResultItem[];
      try {
        results = await provider.search(
          query,
          { maxResults: numResults, language },
          providerConfig,
          signal
        );
      } catch (err) {
        if (err instanceof Error && err.message.includes('quota')) {
          throw new WebError(ZapmycoErrorCode.WEB_SEARCH_QUOTA_EXCEEDED, err.message, {
            provider: providerName,
          });
        }
        throw new WebError(
          ZapmycoErrorCode.WEB_SEARCH_FAILED,
          `搜索失败: ${err instanceof Error ? err.message : String(err)}`,
          { provider: providerName, query }
        );
      }

      // Step 6: 格式化输出
      const text = formatResults(results, query, provider.label);

      // Step 7: 写入缓存
      cache.set(cacheKey, text);

      const details: WebSearchDetails = {
        query,
        provider: providerName,
        resultCount: results.length,
        cached: false,
        elapsedMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text }],
        details,
      };
    },
  };
}
