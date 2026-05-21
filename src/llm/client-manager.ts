/**
 * Anthropic 客户端管理器
 *
 * 以 (baseURL, apiKey) 为缓存键复用 Anthropic 客户端实例。
 * 避免对同一后端重复创建 HTTP 连接。
 *
 * @module llm/client-manager
 */

import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** 已知提供商的默认 baseURL 映射（当 provider-registry 未配置 baseURL 时使用） */
const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com/anthropic',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  kimi: 'https://api.moonshot.cn/v1',
  minimax: 'https://api.minimax.chat/v1',
};

const clients = new Map<string, Anthropic>();

/**
 * 获取或创建 Anthropic 客户端实例
 *
 * @param baseURL - API base URL（默认 https://api.anthropic.com）
 * @param apiKey  - API Key
 * @param provider - 提供商名称（用于 baseURL 为空时查找默认值）
 * @param betaHeaders - Beta 请求头（latch 后不变，影响 prompt cache 键一致性）
 * @returns Anthropic 客户端实例
 */
export function getClient(
  baseURL?: string,
  apiKey?: string,
  provider?: string,
  betaHeaders?: Record<string, string>
): Anthropic {
  // baseURL 优先级：显式传入 > provider 默认 > 全局默认（anthropic.com）
  const effectiveBaseURL =
    baseURL || (provider && PROVIDER_DEFAULT_BASE_URLS[provider]) || DEFAULT_BASE_URL;
  // 缓存键中包含确定性序列化的 betaHeaders，确保不同 header 使用独立客户端
  const betaKey = betaHeaders ? JSON.stringify(betaHeaders, Object.keys(betaHeaders).sort()) : '';
  const key = `${effectiveBaseURL}|${apiKey || ''}|${betaKey}`;
  let client = clients.get(key);
  if (!client) {
    client = new Anthropic({
      apiKey,
      baseURL: effectiveBaseURL,
      ...(betaHeaders && Object.keys(betaHeaders).length > 0
        ? { defaultHeaders: betaHeaders }
        : {}),
    });
    clients.set(key, client);
  }
  return client;
}

/** 清除所有缓存的客户端实例（用于测试） */
export function clearClients(): void {
  clients.clear();
}
