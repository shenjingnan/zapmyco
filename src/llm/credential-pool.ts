/**
 * CredentialPool — 单提供商的多 API Key 管理
 *
 * 支持轮转、故障标记、自动恢复和并发跟踪。
 * 每个提供商（如 anthropic、openai）拥有一个 CredentialPool 实例。
 */

import { randomInt } from 'node:crypto';
import { logger } from '@/infra/logger';
import { maskApiKey, resolveApiKey } from '@/llm/key-utils';

// ============ 类型定义 ============

/** 凭据选择策略 */
export type CredentialStrategy = 'round-robin' | 'random' | 'priority-first';

/** 单个凭据条目（来自用户配置） */
export interface CredentialEntry {
  /** API Key（支持 ${ENV_VAR} 环境变量引用） */
  apiKey: string;
  /** 可读标签，用于日志和调试 */
  label?: string;
  /**
   * 优先级，数字越小越优先
   * - 1 = 主 Key（默认）
   * - 2+ = 备选 Key
   */
  priority?: number;
  /** 最大并发限制（0 = 不限制） */
  maxConcurrency?: number;
  /** 是否启用 */
  enabled?: boolean;
}

/** 凭据池统计信息 */
export interface CredentialPoolStats {
  provider: string;
  total: number;
  active: number;
  disabled: number;
  failures: number;
  currentIndex: number;
}

/** 凭据池构造选项 */
export interface CredentialPoolOptions {
  /** 选择策略（默认 'round-robin'） */
  strategy?: CredentialStrategy;
  /** 故障后恢复等待时间（毫秒），默认 60000（1 分钟） */
  recoveryMs?: number;
  /** 连续失败多少次后暂时禁用（默认 3） */
  maxConsecutiveFailures?: number;
}

// ============ 内部状态 ============

interface CredentialState {
  entry: CredentialEntry;
  resolvedKey: string;
  failures: number;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  disabled: boolean;
  disabledUntil: number | null;
  currentConcurrency: number;
}

// ============ CredentialPool ============

export class CredentialPool {
  readonly provider: string;
  private entries: CredentialState[];
  private strategy: CredentialStrategy;
  private recoveryMs: number;
  private maxConsecutiveFailures: number;
  private roundRobinIndex: number;
  /** 上一次 getKey() 返回的 key 索引（用于 markSuccess/markFailed） */
  private lastReturnedIndex: number;

  constructor(provider: string, entries: CredentialEntry[], options?: CredentialPoolOptions) {
    this.provider = provider;
    this.strategy = options?.strategy ?? 'round-robin';
    this.recoveryMs = options?.recoveryMs ?? 60_000;
    this.maxConsecutiveFailures = options?.maxConsecutiveFailures ?? 3;
    this.roundRobinIndex = 0;
    this.lastReturnedIndex = -1;

    this.entries = entries
      .filter((e) => e.enabled !== false)
      .map((entry) => ({
        entry,
        resolvedKey: resolveApiKey(entry.apiKey),
        failures: 0,
        consecutiveFailures: 0,
        lastFailureTime: null,
        disabled: false,
        disabledUntil: null,
        currentConcurrency: 0,
      }));

    if (this.entries.length === 0) {
      logger.warn(`凭据池 [${provider}] 没有可用的 Key`);
    }
  }

  // ============ 公开方法 ============

  /**
   * 获取下一个可用的 API Key
   *
   * 根据策略选择 Key，自动跳过 disabled、超并发、仍在恢复期的 Key。
   * 如果所有 Key 都不可用，返回 undefined。
   *
   * 注意：返回的 Key 需要调用方在使用后通过 markSuccess/markFailed 报告结果。
   */
  getKey(): string | undefined {
    // 先恢复已过恢复期的 Key
    this.recoverExpiredKeys();

    const activeEntries = this.getActiveEntries();

    if (activeEntries.length === 0) {
      logger.warn(`凭据池 [${this.provider}] 所有 Key 都不可用`);
      return undefined;
    }

    let selected: CredentialState | null = null;

    switch (this.strategy) {
      case 'round-robin':
        selected = this.selectRoundRobin(activeEntries);
        break;
      case 'random':
        selected = this.selectRandom(activeEntries);
        break;
      case 'priority-first':
        selected = this.selectPriorityFirst(activeEntries);
        break;
    }

    if (!selected) return undefined;

    // 找到原始索引（用于 markSuccess/markFailed）
    this.lastReturnedIndex = this.entries.indexOf(selected);

    logger.debug(
      `凭据池 [${this.provider}] 选择 Key: ${selected.entry.label ?? maskApiKey(selected.resolvedKey)}`
    );
    return selected.resolvedKey;
  }

  /**
   * 使用凭据执行操作（自动管理并发计数）
   */
  async withKey<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
    const key = this.getKey();
    if (!key) {
      throw new Error(`凭据池 [${this.provider}] 没有可用的 Key`);
    }

    const state = this.entries[this.lastReturnedIndex];
    if (!state) {
      throw new Error(`凭据池 [${this.provider}] 内部状态异常`);
    }
    state.currentConcurrency++;

    try {
      const result = await fn(key);
      this.markSuccess(key);
      return result;
    } catch (error) {
      this.markFailed(key, error instanceof Error ? error : undefined);
      throw error;
    } finally {
      state.currentConcurrency--;
    }
  }

  /**
   * 标记一个 Key 调用成功（重置失败计数）
   */
  markSuccess(apiKey: string): void {
    const state = this.findByKey(apiKey);
    if (!state) return;

    state.consecutiveFailures = 0;
    // 成功后不重置 failures 总数（保留统计信息）
  }

  /**
   * 标记一个 Key 调用失败
   *
   * 错误分类：
   * - HTTP 429 (Too Many Requests) → 立即禁用，等待恢复期
   * - 其他错误 → 累计连续失败计数，达到阈值后禁用
   */
  markFailed(apiKey: string, error?: Error): void {
    const state = this.findByKey(apiKey);
    if (!state) return;

    state.failures++;
    state.consecutiveFailures++;
    state.lastFailureTime = Date.now();

    const isRateLimited = error?.message?.includes('429') || error?.message?.includes('rate');

    if (isRateLimited) {
      // 限流：立即禁用
      state.disabled = true;
      state.disabledUntil = Date.now() + this.recoveryMs;
      logger.warn(
        `凭据池 [${this.provider}] Key ${state.entry.label ?? maskApiKey(apiKey)} 被限流，禁用 ${this.recoveryMs}ms`
      );
    } else if (state.consecutiveFailures >= this.maxConsecutiveFailures) {
      // 连续失败达到阈值
      state.disabled = true;
      state.disabledUntil = Date.now() + this.recoveryMs;
      logger.warn(
        `凭据池 [${this.provider}] Key ${state.entry.label ?? maskApiKey(apiKey)} 连续失败 ${state.consecutiveFailures} 次，禁用 ${this.recoveryMs}ms`
      );
    }
  }

  /** 获取统计信息 */
  getStats(): CredentialPoolStats {
    return {
      provider: this.provider,
      total: this.entries.length,
      active: this.getActiveEntries().length,
      disabled: this.entries.filter((e) => e.disabled).length,
      failures: this.entries.reduce((sum, e) => sum + e.failures, 0),
      currentIndex: this.roundRobinIndex,
    };
  }

  /** 重置所有 Key 状态（清空故障记录） */
  reset(): void {
    for (const entry of this.entries) {
      entry.failures = 0;
      entry.consecutiveFailures = 0;
      entry.lastFailureTime = null;
      entry.disabled = false;
      entry.disabledUntil = null;
      entry.currentConcurrency = 0;
    }
    this.roundRobinIndex = 0;
    this.lastReturnedIndex = -1;
    logger.debug(`凭据池 [${this.provider}] 已重置`);
  }

  /** 获取该提供商所有 Key 的数量（包括禁用的） */
  get totalCount(): number {
    return this.entries.length;
  }

  /** 获取当前可用 Key 的数量 */
  get activeCount(): number {
    return this.getActiveEntries().length;
  }

  // ============ 内部方法 ============

  /** 恢复已过恢复期的 Key */
  private recoverExpiredKeys(): void {
    const now = Date.now();
    for (const entry of this.entries) {
      if (entry.disabled && entry.disabledUntil !== null && now >= entry.disabledUntil) {
        entry.disabled = false;
        entry.disabledUntil = null;
        entry.consecutiveFailures = 0;
        logger.debug(
          `凭据池 [${this.provider}] Key ${entry.entry.label ?? maskApiKey(entry.resolvedKey)} 已恢复`
        );
      }
    }
  }

  /** 获取所有可用的 Key（未禁用、未超并发） */
  private getActiveEntries(): CredentialState[] {
    const maxConcurrencyDefault = 0; // 0 表示不限制
    this.recoverExpiredKeys();
    return this.entries.filter((e) => {
      if (e.disabled) return false;
      const max = e.entry.maxConcurrency ?? maxConcurrencyDefault;
      if (max > 0 && e.currentConcurrency >= max) return false;
      return true;
    });
  }

  /** Round-robin 选择 */
  private selectRoundRobin(active: CredentialState[]): CredentialState | null {
    if (active.length === 0) return null;

    // 在活跃列表中按原始顺序轮询
    if (this.entries.length === 0) return null;
    const start = this.roundRobinIndex % this.entries.length;
    for (let i = 0; i < this.entries.length; i++) {
      const idx = (start + i) % this.entries.length;
      const entry = this.entries[idx];
      if (entry && active.includes(entry)) {
        this.roundRobinIndex = (idx + 1) % this.entries.length;
        return entry;
      }
    }
    return null;
  }

  /** 随机选择 */
  private selectRandom(active: CredentialState[]): CredentialState | null {
    if (active.length === 0) return null;
    return active[randomInt(active.length)] ?? null;
  }

  /** 按优先级选择（同优先级内 round-robin） */
  private selectPriorityFirst(active: CredentialState[]): CredentialState | null {
    if (active.length === 0) return null;

    // 按 priority 排序
    const sorted = [...active].sort((a, b) => (a.entry.priority ?? 1) - (b.entry.priority ?? 1));

    // 优先使用最高优先级中轮询选择
    const first = sorted[0];
    if (!first) return null;
    const topPriority = first.entry.priority ?? 1;
    const topTier = sorted.filter((e) => (e.entry.priority ?? 1) === topPriority);

    return this.selectRoundRobin(topTier) ?? sorted[0] ?? null;
  }

  /** 根据 apiKey 值查找对应的状态 */
  private findByKey(apiKey: string): CredentialState | undefined {
    return this.entries.find((e) => e.resolvedKey === apiKey);
  }
}
