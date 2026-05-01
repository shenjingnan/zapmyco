/**
 * Web 工具共享类型定义
 *
 * @module cli/repl/tools/types
 */

// ============ web_fetch 参数与返回类型 ============

/** web_fetch 工具参数 */
export interface WebFetchParams {
  /** 要抓取的 URL（必须 http:// 或 https:// 开头） */
  url: string;
  /** 是否只提取正文内容（默认使用全局配置） */
  extractMainContent?: boolean;
  /** 返回内容的最大字符数（默认使用全局配置） */
  maxChars?: number;
}

/** web_fetch 执行详情 */
export interface WebFetchDetails {
  /** 请求的原始 URL */
  url: string;
  /** 重定向后的最终 URL */
  finalUrl?: string;
  /** HTTP 状态码 */
  statusCode: number;
  /** 响应 Content-Type */
  contentType?: string;
  /** 返回内容的字符数 */
  contentLength: number;
  /** 是否被截断 */
  truncated: boolean;
  /** 内容提取方式 */
  extractionMethod: 'full' | 'main-content' | 'raw' | 'error';
  /** 是否命中缓存 */
  cached?: boolean;
  /** 耗时（毫秒） */
  elapsedMs: number;
}

// ============ web_search 参数与返回类型 ============

/** web_search 工具参数 */
export interface WebSearchParams {
  /** 搜索关键词或自然语言查询 */
  query: string;
  /** 返回结果数量（1-20，默认 8） */
  numResults?: number;
}

/** 搜索结果条目 */
export interface SearchResultItem {
  /** 页面标题 */
  title: string;
  /** 页面 URL */
  url: string;
  /** 摘要/片段文本 */
  snippet: string;
}

/** web_search 执行详情 */
export interface WebSearchDetails {
  /** 搜索查询 */
  query: string;
  /** 使用的搜索引擎 */
  provider: string;
  /** 返回结果数 */
  resultCount: number;
  /** 是否命中缓存 */
  cached?: boolean;
  /** 耗时（毫秒） */
  elapsedMs: number;
}

// ============ Search Provider 插件类型 ============

/** 搜索引擎 Provider 配置 */
export interface SearchProviderConfig {
  /** API Key */
  apiKey?: string;
  /** 自定义端点 URL */
  endpointUrl?: string;
  /** 其他扩展配置 */
  [key: string]: unknown;
}

/** 搜索选项 */
export interface SearchOptions {
  /** 最大结果数（默认 8，最大 20） */
  maxResults: number;
  /** 语言偏好（默认 zh-cn） */
  language?: string;
}

/**
 * 搜索引擎 Provider 接口
 *
 * 所有搜索引擎实现此接口，通过注册表动态发现。
 */
export interface SearchProvider {
  /** Provider 唯一标识（如 'tavily', 'duckduckgo'） */
  readonly name: string;
  /** 显示名称（如 'Tavily', 'DuckDuckGo'） */
  readonly label: string;
  /** 是否需要 API Key 才能工作 */
  requiresApiKey: boolean;

  /**
   * 检查当前是否可用
   *
   * @param config - Provider 配置（含 API Key 等）
   * @returns 可用返回 true，否则 false
   */
  isAvailable(config: SearchProviderConfig): boolean | Promise<boolean>;

  /**
   * 执行搜索
   *
   * @param query - 搜索查询
   * @param options - 搜索选项
   * @param config - Provider 配置
   * @param signal - 取消信号
   * @returns 搜索结果列表
   */
  search(
    query: string,
    options: SearchOptions,
    config: SearchProviderConfig,
    signal?: AbortSignal
  ): Promise<SearchResultItem[]>;
}
