import { describe, expect, it, vi } from 'vitest';
import { createCache } from '@/cli/repl/tools/cache';

describe('createCache', () => {
  describe('基本读写', () => {
    it('应该能写入和读取缓存', () => {
      const cache = createCache<string>({ ttlMs: 60_000, maxEntries: 10 });
      cache.set('key1', 'value1');
      const result = cache.get('key1');
      expect(result).not.toBeNull();
      expect(result?.value).toBe('value1');
      expect(result?.cached).toBe(true);
    });

    it('读取不存在的 key 应该返回 null', () => {
      const cache = createCache<string>();
      expect(cache.get('nonexistent')).toBeNull();
    });
  });

  describe('TTL 过期', () => {
    it('过期的条目应该返回 null', () => {
      const cache = createCache<string>({ ttlMs: 100, maxEntries: 10 });
      cache.set('key1', 'value1');

      // 未过期
      expect(cache.get('key1')?.value).toBe('value1');

      // 模拟过期
      vi.useFakeTimers();
      vi.advanceTimersByTime(150);
      expect(cache.get('key1')).toBeNull();
      vi.useRealTimers();
    });

    it('TTL 为 0 或负数时不应该缓存', () => {
      const cache = createCache<string>({ ttlMs: 0, maxEntries: 10 });
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBeNull();
    });

    it('自定义 TTL 应该覆盖默认值', () => {
      const cache = createCache<string>({ ttlMs: 10_000, maxEntries: 10 });
      cache.set('key1', 'value1', 50); // 自定义 50ms TTL

      vi.useFakeTimers();
      vi.advanceTimersByTime(40);
      expect(cache.get('key1')?.value).toBe('value1'); // 未过期

      vi.advanceTimersByTime(20);
      expect(cache.get('key1')).toBeNull(); // 已过期
      vi.useRealTimers();
    });
  });

  describe('LRU 淘汰', () => {
    it('达到最大条目数时应该淘汰最旧的条目', () => {
      const cache = createCache<string>({ ttlMs: 60_000, maxEntries: 3 });
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3'); // 已满 (3/3)

      // 所有条目都存在
      expect(cache.get('a')?.value).toBe('1');
      expect(cache.get('b')?.value).toBe('2');
      expect(cache.get('c')?.value).toBe('3');

      // 添加第 4 个，应淘汰 a（最旧）
      cache.set('d', '4');
      expect(cache.get('a')).toBeNull(); // 被淘汰
      expect(cache.get('b')?.value).toBe('2');
      expect(cache.get('c')?.value).toBe('3');
      expect(cache.get('d')?.value).toBe('4');
    });

    it('更新已存在的 key 不应触发淘汰', () => {
      const cache = createCache<string>({ ttlMs: 60_000, maxEntries: 2 });
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('a', '1-updated'); // 更新已有 key

      expect(cache.size).toBe(2);
      expect(cache.get('a')?.value).toBe('1-updated');
      expect(cache.get('b')?.value).toBe('2');
    });
  });

  describe('删除与清空', () => {
    it('delete 应该删除指定 key', () => {
      const cache = createCache<string>();
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeNull();
    });

    it('delete 不存在的 key 应该返回 false', () => {
      const cache = createCache<string>();
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('clear 应该清空所有缓存', () => {
      const cache = createCache<string>();
      cache.set('a', '1');
      cache.set('b', '2');
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toBeNull();
    });
  });

  describe('size 属性', () => {
    it('应该正确报告当前条目数', () => {
      const cache = createCache<string>();
      expect(cache.size).toBe(0);
      cache.set('a', '1');
      expect(cache.size).toBe(1);
      cache.set('b', '2');
      expect(cache.size).toBe(2);
      cache.delete('a');
      expect(cache.size).toBe(1);
    });
  });
});
