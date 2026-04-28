import { beforeEach, describe, expect, it } from 'vitest';
import { HistoryStore } from '@/cli/repl/history-store';

describe('HistoryStore', () => {
  let store: HistoryStore;

  beforeEach(() => {
    store = new HistoryStore(5);
  });

  describe('push', () => {
    it('应添加条目并返回带 id 的副本', () => {
      const entry = store.push({
        timestamp: 1000,
        input: '测试输入',
      });

      expect(entry.id).toBe(1);
      expect(entry.input).toBe('测试输入');
      expect(entry.timestamp).toBe(1000);
    });

    it('id 应递增', () => {
      store.push({ timestamp: 1000, input: '第一条' });
      const entry2 = store.push({ timestamp: 2000, input: '第二条' });
      expect(entry2.id).toBe(2);
    });
  });

  describe('getAll', () => {
    it('空存储应返回空数组', () => {
      expect(store.getAll()).toEqual([]);
    });

    it('应返回所有条目', () => {
      store.push({ timestamp: 1000, input: 'a' });
      store.push({ timestamp: 2000, input: 'b' });
      expect(store.getAll()).toHaveLength(2);
    });
  });

  describe('getLast', () => {
    it('应返回最近 n 条记录', () => {
      store.push({ timestamp: 1000, input: 'a' });
      store.push({ timestamp: 2000, input: 'b' });
      store.push({ timestamp: 3000, input: 'c' });

      const last2 = store.getLast(2);
      expect(last2).toHaveLength(2);
      expect(last2[0]?.input).toBe('b');
      expect(last2[1]?.input).toBe('c');
    });

    it('n 超过总数时应返回全部', () => {
      store.push({ timestamp: 1000, input: 'a' });
      store.push({ timestamp: 2000, input: 'b' });
      expect(store.getLast(10)).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('应清空所有条目', () => {
      store.push({ timestamp: 1000, input: 'a' });
      store.push({ timestamp: 2000, input: 'b' });
      store.clear();
      expect(store.getAll()).toEqual([]);
    });

    it('clear 后 id 不重置', () => {
      store.push({ timestamp: 1000, input: 'a' });
      store.clear();
      const entry = store.push({ timestamp: 2000, input: 'b' });
      expect(entry.id).toBe(2);
    });
  });

  describe('search', () => {
    it('应按输入内容模糊匹配', () => {
      store.push({ timestamp: 1000, input: '修复登录 bug' });
      store.push({ timestamp: 2000, input: '写一个函数' });
      store.push({ timestamp: 3000, input: '部署到生产环境' });

      const results = store.search('登录');
      expect(results).toHaveLength(1);
      expect(results[0]?.input).toContain('登录');
    });

    it('大小写不敏感', () => {
      store.push({ timestamp: 1000, input: 'Hello World' });
      expect(store.search('hello')).toHaveLength(1);
      expect(store.search('HELLO')).toHaveLength(1);
    });

    it('无匹配时应返回空数组', () => {
      store.push({ timestamp: 1000, input: '测试' });
      expect(store.search('不存在')).toEqual([]);
    });
  });

  describe('容量限制 (FIFO)', () => {
    it('超过最大容量时应淘汰最旧条目', () => {
      const smallStore = new HistoryStore(3);

      smallStore.push({ timestamp: 1, input: '第一条' });
      smallStore.push({ timestamp: 2, input: '第二条' });
      smallStore.push({ timestamp: 3, input: '第三条' });
      smallStore.push({ timestamp: 4, input: '第四条' }); // 应淘汰第一条

      const all = smallStore.getAll();
      expect(all).toHaveLength(3);
      expect(all[0]?.input).toBe('第二条');
      expect(all[2]?.input).toBe('第四条');
    });
  });
});
