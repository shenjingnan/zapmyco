/**
 * CredentialPoolManager — 多提供商的凭据池管理器
 *
 * 根据 LlmConfig 为每个提供商创建和管理 CredentialPool 实例。
 * 自动将旧的单个 apiKey 配置包装为单条目凭据池（向后兼容）。
 */

import type { LlmConfig, LlmProviderConfig } from '@/config/types';
import { logger } from '@/infra/logger';
import type { CredentialEntry, CredentialPoolOptions } from '@/llm/credential-pool';
import { CredentialPool } from '@/llm/credential-pool';

export class CredentialPoolManager {
  private pools: Map<string, CredentialPool> = new Map();

  /**
   * 从 LlmConfig 构建 CredentialPoolManager
   *
   * 为 config.llm.providers 中每个提供商创建一个 CredentialPool。
   * 向后兼容：如果 credentials 为空但 apiKey 存在，自动包装为单条目。
   */
  static fromConfig(config: LlmConfig): CredentialPoolManager {
    const manager = new CredentialPoolManager();

    for (const [providerName, auth] of Object.entries(config.providers)) {
      if (!auth) continue;

      const entries = CredentialPoolManager.normalizeCredentials(auth);
      if (entries.length === 0) {
        logger.warn(`提供商 [${providerName}] 没有配置有效的凭据`);
        continue;
      }

      const options: CredentialPoolOptions = {
        strategy: auth.credentialStrategy ?? 'round-robin',
        recoveryMs: auth.recoveryMs ?? 60_000,
      };

      const pool = new CredentialPool(providerName, entries, options);
      manager.pools.set(providerName, pool);
    }

    return manager;
  }

  /**
   * 将旧格式的 apiKey + 新格式的 credentials 标准化为 CredentialEntry[]
   *
   * 规则：credentials 优先；如果 credentials 为空但 apiKey 存在，自动包装。
   */
  private static normalizeCredentials(auth: LlmProviderConfig): CredentialEntry[] {
    if (auth.credentials && auth.credentials.length > 0) {
      return auth.credentials;
    }
    if (auth.apiKey) {
      return [{ apiKey: auth.apiKey, priority: 1, label: 'default' }];
    }
    return [];
  }

  /** 获取指定提供商的凭据池 */
  getPool(provider: string): CredentialPool | undefined {
    return this.pools.get(provider);
  }

  /** 获取指定提供商的 API Key */
  getKey(provider: string): string | undefined {
    return this.pools.get(provider)?.getKey();
  }

  /** 报告 Key 使用结果 */
  reportKeyResult(provider: string, apiKey: string, success: boolean, error?: Error): void {
    const pool = this.pools.get(provider);
    if (!pool) return;
    if (success) {
      pool.markSuccess(apiKey);
    } else {
      pool.markFailed(apiKey, error);
    }
  }

  /** 获取所有提供商的统计信息 */
  getStats(): Record<string, { total: number; active: number; disabled: number }> {
    const result: Record<string, { total: number; active: number; disabled: number }> = {};
    for (const [name, pool] of this.pools) {
      const stats = pool.getStats();
      result[name] = {
        total: stats.total,
        active: stats.active,
        disabled: stats.disabled,
      };
    }
    return result;
  }

  /** 重置所有凭据池 */
  resetAll(): void {
    for (const pool of this.pools.values()) {
      pool.reset();
    }
  }

  /** 获取所有已注册的提供商名称 */
  getProviderNames(): string[] {
    return Array.from(this.pools.keys());
  }
}
