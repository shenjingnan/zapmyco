/**
 * 通用内存缓存模块
 *
 * 特性：
 * - TTL（Time-To-Live）过期机制
 * - LRU 淘汰策略（达到最大条目时淘汰最旧）
 * - 零外部依赖
 *
 * 参考实现: OpenClaw src/agents/tools/web-shared.ts
 *
 * @module cli/repl/tools/cache
 */

// ============ 类型定义 ============

/** 缓存条目 */
export interface CacheEntry<T> {
  /** 缓存的值 */
  value: T;
  /** 过期时间戳（毫秒） */
  expiresAt: number;
  /** 插入时间戳 */
  insertedAt: number;
}

/** 缓存配置 */
export interface CacheOptions {
  /** TTL（毫秒），默认 15 分钟 */
  ttlMs?: number;
  /** 最大条目数，默认 100 */
  maxEntries?: number;
}

/** 缓存读取结果 */
export interface CacheResult<T> {
  /** 缓存的值 */
  value: T;
  /** 是否命中缓存 */
  cached: boolean;
}

// ============ 默认值 ============

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 分钟
const DEFAULT_MAX_ENTRIES = 100;

// ============ 缓存实现 ============

/**
 * 创建内存缓存实例
 *
 * @param options - 缓存配置
 * @returns 缓存操作对象
 */
export function createCache<T>(options: CacheOptions = {}): {
  get(key: string): CacheResult<T> | null;
  set(key: string, value: T, customTtlMs?: number): void;
  delete(key: string): boolean;
  clear(): void;
  get size(): number;
} {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const store = new Map<string, CacheEntry<T>>();

  return {
    /**
     * 读取缓存
     *
     * @param key - 缓存 key
     * @returns 命中返回 { value, cached: true }，未命中返回 null
     */
    get(key: string): CacheResult<T> | null {
      const entry = store.get(key);
      if (!entry) {
        return null;
      }

      // 检查是否过期
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }

      return { value: entry.value, cached: true };
    },

    /**
     * 写入缓存
     *
     * @param key - 缓存 key
     * @param value - 要缓存的值
     * @param customTtlMs - 自定义 TTL（覆盖默认值）
     */
    set(key: string, value: T, customTtlMs?: number): void {
      // 如果 TTL <= 0，不缓存
      const effectiveTtl = customTtlMs ?? ttlMs;
      if (effectiveTtl <= 0) {
        return;
      }

      // LRU 淘汰：如果已满，删除最旧的条目
      if (store.size >= maxEntries && !store.has(key)) {
        const oldestKey = store.keys().next().value;
        if (oldestKey !== undefined) {
          store.delete(oldestKey);
        }
      }

      store.set(key, {
        value,
        expiresAt: Date.now() + effectiveTtl,
        insertedAt: Date.now(),
      });
    },

    /**
     * 删除指定 key 的缓存
     */
    delete(key: string): boolean {
      return store.delete(key);
    },

    /**
     * 清空所有缓存
     */
    clear(): void {
      store.clear();
    },

    /**
     * 获取当前缓存条目数
     */
    get size(): number {
      return store.size;
    },
  };
}
