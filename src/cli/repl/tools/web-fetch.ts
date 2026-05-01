/**
 * web_fetch 工具实现
 *
 * 功能：
 * - SSRF 安全检查
 * - HTTP GET 请求（内置 fetch）
 * - HTML 正文提取 + Markdown 转换
 * - 内容截断与缓存
 *
 * @module cli/repl/tools/web-fetch
 */

import type { WebConfig } from '@/config/types';
import { WebError, ZapmycoErrorCode } from '@/infra/errors';
import { createCache } from './cache';
import { extractAndConvert, htmlToMarkdown } from './html-to-markdown';
import { checkUrlSafety } from './ssrf-guard';
import type { WebFetchDetails, WebFetchParams } from './types';

// ============ 常量 ============

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512_000;
const DEFAULT_MAX_CHARS = 20_000;
const DEFAULT_USER_AGENT = 'ZapmycoBot/0.2 (https://github.com/shenjingnan/zapmyco)';
const DEFAULT_MAX_REDIRECTS = 3;

// ============ 缓存实例 ============

let fetchCache: ReturnType<typeof createCache<string>> | null = null;

function getFetchCache(ttlMinutes: number = 15): ReturnType<typeof createCache<string>> {
  if (!fetchCache) {
    fetchCache = createCache<string>({
      ttlMs: ttlMinutes * 60 * 1000,
      maxEntries: 100,
    });
  }
  return fetchCache;
}

// ============ 辅助函数 ============

/**
 * 构建缓存 key
 */
function buildCacheKey(url: string, extractMain: boolean, maxChars: number): string {
  return `fetch:${url}:${extractMain ? 'main' : 'full'}:${maxChars}`;
}

/**
 * 截断文本到指定字符数
 */
function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  // 尝试在单词边界截断
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');
  const cutAt = lastSpace > maxChars * 0.8 ? lastSpace : maxChars;
  return {
    text: `${text.slice(0, cutAt)}\n\n... [内容已截断]`,
    truncated: true,
  };
}

/**
 * 根据 Content-Type 判断响应类型
 */
function getContentType(headers: Headers): string {
  return headers.get('content-type') ?? 'application/octet-stream';
}

/**
 * 判断是否为 HTML 内容
 */
function isHtmlContent(contentType: string): boolean {
  return contentType.toLowerCase().includes('text/html');
}

/**
 * 判断是否为 JSON 内容
 */
function isJsonContent(contentType: string): boolean {
  return contentType.toLowerCase().includes('application/json');
}

// ============ 核心逻辑 ============

/**
 * 执行 HTTP 抓取（含重定向跟踪）
 */
async function doFetch(
  url: string,
  options: NonNullable<WebConfig['fetch']>,
  ssrfOptions: NonNullable<WebConfig['ssrf']>,
  signal?: AbortSignal
): Promise<{ buffer: ArrayBuffer; contentType: string; statusCode: number; finalUrl: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  // 使用 AbortController 实现超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 合并外部 signal
  signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    let currentUrl = url;
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      const response = await fetch(currentUrl, {
        method: 'GET',
        headers: { 'User-Agent': userAgent },
        signal: controller.signal,
        redirect: 'manual', // 手动处理重定向以跟踪最终 URL
      });

      // 处理重定向
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new WebError(
            ZapmycoErrorCode.WEB_FETCH_FAILED,
            `重定向但无 Location 头: ${currentUrl}`
          );
        }
        currentUrl = new URL(location, currentUrl).href;
        // 重定向目标重新检查 SSRF，防止通过重定向链绕过安全策略
        const safetyResult = await checkUrlSafety(currentUrl, ssrfOptions);
        if (!safetyResult.allowed) {
          throw new WebError(
            ZapmycoErrorCode.WEB_FETCH_BLOCKED,
            safetyResult.reason ?? `重定向目标 URL 未通过安全检查: ${currentUrl}`,
            { url: currentUrl, reason: safetyResult.reason }
          );
        }
        redirectCount++;
        continue;
      }

      if (!response.ok) {
        throw new WebError(
          ZapmycoErrorCode.WEB_FETCH_FAILED,
          `HTTP ${response.status}: ${currentUrl}`,
          { statusCode: response.status, url: currentUrl }
        );
      }

      // 检查 Content-Length
      const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
      if (contentLength > maxBytes) {
        throw new WebError(
          ZapmycoErrorCode.WEB_FETCH_TOO_LARGE,
          `响应过大: ${contentLength} 字节（限制 ${maxBytes}）`,
          { contentLength, maxBytes, url: currentUrl }
        );
      }

      const buffer = await response.arrayBuffer();

      if (buffer.byteLength > maxBytes) {
        throw new WebError(
          ZapmycoErrorCode.WEB_FETCH_TOO_LARGE,
          `响应体过大: ${buffer.byteLength} 字节（限制 ${maxBytes}）`,
          { actualSize: buffer.byteLength, maxBytes, url: currentUrl }
        );
      }

      return {
        buffer,
        contentType: getContentType(response.headers),
        statusCode: response.status,
        finalUrl: currentUrl,
      };
    }

    throw new WebError(ZapmycoErrorCode.WEB_FETCH_FAILED, `重定向次数超过上限 (${maxRedirects})`, {
      maxRedirects,
      url,
    });
  } catch (err) {
    if (err instanceof WebError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new WebError(ZapmycoErrorCode.WEB_FETCH_TIMEOUT, `请求超时 (${timeoutMs}ms): ${url}`, {
        timeoutMs,
        url,
      });
    }
    throw new WebError(
      ZapmycoErrorCode.WEB_FETCH_FAILED,
      `抓取失败: ${err instanceof Error ? err.message : String(err)}`,
      { url }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 处理响应内容并转换为文本
 */
function processResponse(
  buffer: ArrayBuffer,
  contentType: string,
  extractMain: boolean
): { text: string; extractionMethod: WebFetchDetails['extractionMethod'] } {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const rawText = decoder.decode(buffer);

  if (isHtmlContent(contentType)) {
    if (extractMain) {
      return {
        text: extractAndConvert(rawText),
        extractionMethod: 'main-content',
      };
    }
    return {
      text: htmlToMarkdown(rawText),
      extractionMethod: 'full',
    };
  }

  if (isJsonContent(contentType)) {
    try {
      // 尝试美化 JSON
      const parsed = JSON.parse(rawText);
      return {
        text: JSON.stringify(parsed, null, 2),
        extractionMethod: 'raw',
      };
    } catch {
      // JSON 解析失败，返回原始文本
    }
  }

  return { text: rawText, extractionMethod: 'raw' };
}

// ============ 工具注册 ============

/**
 * 创建 web_fetch 工具注册信息
 */
export function createWebFetchTool(webConfig?: WebConfig) {
  const fetchOptions = webConfig?.fetch ?? {};
  const ssrfOptions = webConfig?.ssrf ?? {};
  const cacheTtlMinutes = fetchOptions.cacheTtlMinutes ?? 15;

  return {
    id: 'web_fetch' as const,
    label: '网页抓取' as const,
    description:
      '抓取指定 URL 的网页内容并转换为 Markdown 格式。支持 HTML 正文提取、JSON 美化、内容截断。当用户需要访问网页获取信息时调用此工具。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要抓取的 URL（必须 http:// 或 https:// 开头）',
        },
        extractMainContent: {
          type: 'boolean',
          description: '是否只提取正文内容（默认根据全局配置）',
        },
        maxChars: {
          type: 'number',
          description: '返回内容的最大字符数（默认使用全局配置，最大 100000）',
        },
      },
      required: ['url'],
    } as const,

    async execute(_toolCallId: string, params: WebFetchParams, signal?: AbortSignal) {
      const startTime = Date.now();
      const { url } = params;
      const extractMain = params.extractMainContent ?? fetchOptions.extractMainContent ?? true;
      const maxChars = Math.min(
        params.maxChars ?? fetchOptions.maxChars ?? DEFAULT_MAX_CHARS,
        100_000
      );

      // Step 1: 缓存检查
      const cache = getFetchCache(cacheTtlMinutes);
      const cacheKey = buildCacheKey(url, extractMain, maxChars);
      const cached = cache.get(cacheKey);
      if (cached) {
        return {
          content: [{ type: 'text', text: cached.value }],
          details: {
            url,
            statusCode: 200,
            contentLength: cached.value.length,
            truncated: false,
            extractionMethod: 'full' as const,
            cached: true,
            elapsedMs: Date.now() - startTime,
          } satisfies WebFetchDetails,
        };
      }

      // Step 2: SSRF 安全检查
      const safetyResult = await checkUrlSafety(url, ssrfOptions);
      if (!safetyResult.allowed) {
        throw new WebError(
          ZapmycoErrorCode.WEB_FETCH_BLOCKED,
          safetyResult.reason ?? 'URL 未通过安全检查',
          { url, reason: safetyResult.reason }
        );
      }

      // Step 3: HTTP 抓取
      const { buffer, contentType, statusCode, finalUrl } = await doFetch(
        url,
        fetchOptions,
        ssrfOptions,
        signal
      );

      // Step 4: 内容处理
      const { text: rawOutput, extractionMethod } = processResponse(
        buffer,
        contentType,
        extractMain
      );

      // Step 5: 截断
      const { text, truncated } = truncateText(rawOutput, maxChars);

      // Step 6: 写入缓存
      cache.set(cacheKey, text);

      const details: WebFetchDetails = {
        url,
        ...(finalUrl !== url ? { finalUrl } : {}),
        statusCode,
        contentType,
        contentLength: text.length,
        truncated,
        extractionMethod,
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
