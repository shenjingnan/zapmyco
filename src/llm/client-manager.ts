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

const clients = new Map<string, Anthropic>();

/**
 * 获取或创建 Anthropic 客户端实例
 *
 * @param baseURL - API base URL（默认 https://api.anthropic.com）
 * @param apiKey  - API Key
 * @returns Anthropic 客户端实例
 */
export function getClient(baseURL: string = DEFAULT_BASE_URL, apiKey?: string): Anthropic {
  const key = `${baseURL}|${apiKey || ''}`;
  let client = clients.get(key);
  if (!client) {
    client = new Anthropic({ apiKey, baseURL });
    clients.set(key, client);
  }
  return client;
}

/** 清除所有缓存的客户端实例（用于测试） */
export function clearClients(): void {
  clients.clear();
}
