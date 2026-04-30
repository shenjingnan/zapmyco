/**
 * 搜索引擎 Provider 插件系统
 *
 * 提供插件化搜索引擎接口，内置 4 种实现：
 * - TavilyProvider    — 默认，高质量 AI 搜索（需 API Key）
 * - SerpApiProvider   — Google/Bing 等多引擎（需 API Key）
 * - DuckDuckGoProvider — HTML 抓取兜底（免费，无需 Key）
 * - CustomProvider    — 用户自建端点
 *
 * @module cli/repl/tools/search-providers
 */

import type {
  SearchOptions,
  SearchProvider,
  SearchProviderConfig,
  SearchResultItem,
} from './types';

// ============ 辅助函数 ============

/**
 * 构建 fetch options（处理 exactOptionalPropertyTypes 下 signal 不可为 undefined 的问题）
 *
 * signal 作为独立参数传入，避免对象字面量类型推断问题
 */
function buildFetchOptions(
  init: { method?: string; headers?: HeadersInit; body?: BodyInit | null },
  signal?: AbortSignal
): RequestInit {
  const opts: RequestInit = {};
  if (init.method) opts.method = init.method;
  if (init.headers) opts.headers = init.headers;
  if (init.body != null) opts.body = init.body;
  if (signal !== undefined) opts.signal = signal;
  return opts;
}

/**
 * 判断 URL 是否为 DuckDuckGo 内部跳转链接
 *
 * 使用 URL 构造器解析 hostname，避免子串匹配被绕过
 */
function isDuckDuckGoInternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.endsWith('duckduckgo.com');
  } catch {
    // 非绝对 URL（如相对路径），保守处理视为内部链接
    return true;
  }
}

// ============ Tavily Provider ============

class TavilyProvider implements SearchProvider {
  readonly name = 'tavily';
  readonly label = 'Tavily';
  readonly requiresApiKey = true;

  isAvailable(config: SearchProviderConfig): boolean {
    return !!config.apiKey;
  }

  async search(
    query: string,
    options: SearchOptions,
    config: SearchProviderConfig,
    signal?: AbortSignal
  ): Promise<SearchResultItem[]> {
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error(
        'Tavily 搜索需要 API Key。请配置 web.search.apiKey 或设置 TAVILY_API_KEY 环境变量。\n获取免费 API Key: https://tavily.com'
      );
    }

    const maxResults = Math.min(options.maxResults, 20);

    const response = await fetch(
      'https://api.tavily.com/search',
      buildFetchOptions(
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: maxResults,
            include_answer: false,
            search_depth: 'basic',
          }),
        },
        signal
      )
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Tavily API 错误 (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      results?: Array<{
        title: string;
        url: string;
        content: string;
      }>;
    };

    if (!data.results?.length) {
      return [];
    }

    return data.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 300),
    }));
  }
}

// ============ SerpAPI Provider ============

class SerpApiProvider implements SearchProvider {
  readonly name = 'serpapi';
  readonly label = 'SerpAPI';
  readonly requiresApiKey = true;

  isAvailable(config: SearchProviderConfig): boolean {
    return !!config.apiKey;
  }

  async search(
    query: string,
    options: SearchOptions,
    config: SearchProviderConfig,
    signal?: AbortSignal
  ): Promise<SearchResultItem[]> {
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error(
        'SerpAPI 搜索需要 API Key。请配置 web.search.apiKey 或设置 SERPAPI_API_KEY 环境变量。\n获取 API Key: https://serpapi.com'
      );
    }

    const maxResults = Math.min(options.maxResults, 20);
    const params = new URLSearchParams({
      api_key: apiKey,
      q: query,
      num: String(maxResults),
      engine: 'google',
      hl: options.language ?? 'zh-cn',
    });

    const response = await fetch(
      `https://serpapi.com/search?${params}`,
      buildFetchOptions({}, signal)
    );

    if (!response.ok) {
      throw new Error(`SerpAPI 错误 (${response.status})`);
    }

    const data = (await response.json()) as {
      organic_results?: Array<{
        title: string;
        link: string;
        snippet: string;
      }>;
      error?: string;
    };

    if (data.error) {
      throw new Error(`SerpAPI: ${data.error}`);
    }

    if (!data.organic_results?.length) {
      return [];
    }

    return data.organic_results.map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet.slice(0, 300),
    }));
  }
}

// ============ DuckDuckGo Provider（HTML 抓取） ============

class DuckDuckGoProvider implements SearchProvider {
  readonly name = 'duckduckgo';
  readonly label = 'DuckDuckGo';
  readonly requiresApiKey = false;

  isAvailable(): boolean {
    return true;
  }

  async search(
    query: string,
    options: SearchOptions,
    _config: SearchProviderConfig,
    signal?: AbortSignal
  ): Promise<SearchResultItem[]> {
    const maxResults = Math.min(options.maxResults, 20);

    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      buildFetchOptions(
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZapmycoBot/0.2)' } },
        signal
      )
    );

    if (!response.ok) {
      throw new Error(`DuckDuckGo 请求失败 (${response.status})`);
    }

    const html = await response.text();
    return this.parseDdgHtml(html, maxResults);
  }

  /**
   * 解析 DuckDuckGo HTML 结果页面
   */
  private parseDdgHtml(html: string, maxResults: number): SearchResultItem[] {
    const results: SearchResultItem[] = [];

    const resultBlocks = html.split(/<div[^>]+class="[^"]*result[^"]*"[^>]*>/i);

    for (const block of resultBlocks) {
      if (results.length >= maxResults) break;

      const titleMatch = block.match(
        /<a[^>]+class="[^"]*result__title[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      );
      const title = titleMatch ? this.stripHtmlTags(titleMatch[1] ?? '').trim() : '';

      const urlMatch = block.match(/<a[^>]+class="[^"]*result__url[^"]*"[^>]*href="([^"]*)"/i);
      const url = urlMatch ? this.decodeDdgUrl(urlMatch[1] ?? '') : '';

      const snippetMatch = block.match(
        /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      );
      const snippet = snippetMatch
        ? this.stripHtmlTags(snippetMatch[1] ?? '')
            .trim()
            .slice(0, 300)
        : '';

      if (title && url) {
        results.push({ title, url, snippet });
      }
    }

    if (results.length === 0) {
      return this.fallbackParseDdgHtml(html, maxResults);
    }

    return results;
  }

  /**
   * 备用解析：更宽松的正则匹配
   */
  private fallbackParseDdgHtml(html: string, maxResults: number): SearchResultItem[] {
    const results: SearchResultItem[] = [];

    const linkRegex =
      /<a[^>]+(class="[^"]*(?:result|snippet)[^"]*")[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null = linkRegex.exec(html);

    while (match !== null && results.length < maxResults) {
      const rawUrl = match[2];
      const rawText = match[3];

      if (rawUrl == null || rawText == null) continue;
      if (rawUrl.startsWith('/') || isDuckDuckGoInternalUrl(rawUrl)) {
        continue;
      }

      const text = this.stripHtmlTags(rawText).trim();
      if (text.length > 10) {
        results.push({
          title: text.slice(0, 120),
          url: this.decodeDdgUrl(rawUrl),
          snippet: '',
        });
      }
      match = linkRegex.exec(html);
    }

    return results;
  }

  /** 移除 HTML 标签并解码 HTML 实体 */
  private stripHtmlTags(html: string): string {
    // 使用贪婪匹配移除完整标签（含属性中的 > 字符）
    let text = html.replace(/<[^>]*>/g, '');
    // 解码常见 HTML 实体，未知实体保持原样避免二次注入
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&(amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);/g, (_, token: string) => {
        const entityMap: Record<string, string> = {
          amp: '&',
          lt: '<',
          gt: '>',
          quot: '"',
        };
        if (token in entityMap) return entityMap[token]!;
        if (token.startsWith('#x')) {
          const cp = parseInt(token.slice(2), 16);
          return Number.isNaN(cp) ? _ : String.fromCharCode(cp);
        }
        if (token.startsWith('#')) {
          const cp = parseInt(token.slice(1), 10);
          return Number.isNaN(cp) ? _ : String.fromCharCode(cp);
        }
        return _;
      });
    return text;
  }

  /** 解码 DuckDuckGo 跳转 URL */
  private decodeDdgUrl(url: string): string {
    try {
      if (url.includes('uddg=')) {
        const uddgMatch = url.match(/uddg=([^&]+)/);
        if (uddgMatch?.[1]) {
          return decodeURIComponent(uddgMatch[1]);
        }
      }
      return decodeURIComponent(url);
    } catch {
      return url;
    }
  }
}

// ============ Custom Provider ============

class CustomProvider implements SearchProvider {
  readonly name = 'custom';
  readonly label = '自定义端点';
  readonly requiresApiKey = false;

  isAvailable(config: SearchProviderConfig): boolean {
    return !!config.endpointUrl;
  }

  async search(
    query: string,
    options: SearchOptions,
    config: SearchProviderConfig,
    signal?: AbortSignal
  ): Promise<SearchResultItem[]> {
    const endpointUrl = config.endpointUrl;
    if (!endpointUrl) {
      throw new Error(
        '自定义搜索需要配置 endpointUrl。请在 web.search.endpointUrl 中指定端点地址。'
      );
    }

    const maxResults = Math.min(options.maxResults, 20);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(
      endpointUrl,
      buildFetchOptions(
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query,
            max_results: maxResults,
            language: options.language ?? 'zh-cn',
          }),
        },
        signal
      )
    );

    if (!response.ok) {
      throw new Error(`自定义搜索端点错误 (${response.status}): ${endpointUrl}`);
    }

    const data = (await response.json()) as {
      results?: SearchResultItem[];
      error?: string;
    };

    if (data.error) {
      throw new Error(`自定义搜索端点返回错误: ${data.error}`);
    }

    return data.results ?? [];
  }
}

// ============ Provider 注册表 ============

const PROVIDER_REGISTRY = new Map<string, () => SearchProvider>([
  ['tavily', () => new TavilyProvider()],
  ['serpapi', () => new SerpApiProvider()],
  ['duckduckgo', () => new DuckDuckGoProvider()],
  ['custom', () => new CustomProvider()],
]);

/**
 * 根据 provider 名称解析对应的 Provider 实例
 */
export function resolveSearchProvider(providerName: string): SearchProvider {
  const factory = PROVIDER_REGISTRY.get(providerName);
  if (!factory) {
    const available = [...PROVIDER_REGISTRY.keys()].join(', ');
    throw new Error(`未知搜索引擎: "${providerName}"，可用的 Provider: ${available}`);
  }
  return factory();
}

/**
 * 获取所有已注册的 Provider 名称列表
 */
export function getAvailableProviders(): string[] {
  return [...PROVIDER_REGISTRY.keys()];
}
