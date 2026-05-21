/**
 * Anthropic 客户端管理器
 *
 * 以 (baseURL, apiKey) 为缓存键复用 Anthropic 客户端实例。
 * 避免对同一后端重复创建 HTTP 连接。
 *
 * 同时管理 Beta header latching — 在 Agent session 启动时 latch beta headers，
 * 确保 session 期间不变，防止因 beta headers 变化导致的 prompt cache 断裂。
 *
 * 参考 Claude Code: claude.ts queryModel() header latching 机制
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

// ============ Beta Header Latching ============

/**
 * Beta Header Latch
 *
 * 在 Agent session 启动时 latch beta headers，session 期间不变。
 * 防止因 beta headers 变化导致的 prompt cache 断裂。
 * 仅在 /clear 或 /compact 时重置。
 */
let latchedBetaHeaders: Record<string, string> | null = null;

/**
 * 锁定 beta headers
 *
 * 在 Agent session 启动时调用，锁定当前 beta headers。
 * 后续调用不会覆盖已锁定的值（仅首次生效）。
 *
 * @param betaHeaders - 要锁定的 beta headers
 */
export function latchBetaHeaders(betaHeaders?: Record<string, string>): void {
  if (latchedBetaHeaders !== null) return; // 仅首次 latch
  if (betaHeaders && Object.keys(betaHeaders).length > 0) {
    latchedBetaHeaders = { ...betaHeaders };
  } else {
    latchedBetaHeaders = {};
  }
}

/**
 * 重置 beta header latch
 *
 * 在 /clear 或 /compact 时调用，允许新的 session 使用最新的 beta headers。
 */
export function resetBetaHeaderLatch(): void {
  latchedBetaHeaders = null;
}

/**
 * 获取已锁定的 beta headers
 */
export function getLatchedBetaHeaders(): Record<string, string> {
  return latchedBetaHeaders ?? {};
}

// ============ 客户端工厂 ============

/**
 * 获取或创建 Anthropic 客户端实例
 *
 * Beta headers 使用 latched 值（如果已 latch），确保 session 内一致性。
 *
 * @param baseURL - API base URL（默认 https://api.anthropic.com）
 * @param apiKey  - API Key
 * @param provider - 提供商名称（用于 baseURL 为空时查找默认值）
 * @param betaHeaders - Beta 请求头（仅首次用于 latch，之后使用 latched 值）
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

  // 使用 latched beta headers（如果已 latch）；否则使用传入值
  const effectiveBetaHeaders = latchedBetaHeaders ?? betaHeaders ?? {};

  // 缓存键中包含确定性序列化的 betaHeaders，确保不同 header 使用独立客户端
  const betaKey =
    Object.keys(effectiveBetaHeaders).length > 0
      ? JSON.stringify(effectiveBetaHeaders, Object.keys(effectiveBetaHeaders).sort())
      : '';
  const key = `${effectiveBaseURL}|${apiKey || ''}|${betaKey}`;

  let client = clients.get(key);
  if (!client) {
    client = new Anthropic({
      apiKey,
      baseURL: effectiveBaseURL,
      ...(Object.keys(effectiveBetaHeaders).length > 0
        ? { defaultHeaders: effectiveBetaHeaders }
        : {}),
    });
    clients.set(key, client);
  }
  return client;
}

/** 清除所有缓存的客户端实例（同时重置 beta header latch） */
export function clearClients(): void {
  clients.clear();
  resetBetaHeaderLatch();
}
