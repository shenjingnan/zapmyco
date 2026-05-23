/**
 * style-cache — 样式缓存管理单元测试
 *
 * PR6: 新增 generational GC 测试
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  bumpGeneration,
  clearStyleCaches,
  getCachedStyleCount,
  getGeneration,
  getStyleCodes,
  getStyleId,
  resetGeneration,
  transitionStyle,
} from './style-cache';

describe('StyleCache', () => {
  beforeEach(() => {
    clearStyleCaches();
    resetGeneration();
  });

  describe('getStyleId', () => {
    it('空键应返回 0', () => {
      expect(getStyleId('', [])).toBe(0);
      expect(getStyleId('', ['32'])).toBe(0);
    });

    it('新样式应分配递增的 ID', () => {
      const id1 = getStyleId('32', ['32']);
      const id2 = getStyleId('33', ['33']);
      expect(id1).toBe(1);
      expect(id2).toBe(2);
      expect(id1).not.toBe(id2);
    });

    it('相同样式应返回相同 ID', () => {
      const id1 = getStyleId('32', ['32']);
      const id2 = getStyleId('32', ['32']);
      expect(id1).toBe(id2);
    });
  });

  describe('getStyleCodes', () => {
    it('已注册的样式应返回 codes 数组', () => {
      const id = getStyleId('31;1', ['31', '1']);
      const codes = getStyleCodes(id);
      expect(codes).toEqual(['31', '1']);
    });

    it('未注册的 ID 应返回空数组', () => {
      const codes = getStyleCodes(999);
      expect(codes).toEqual([]);
    });

    it('ID 0 应返回空数组', () => {
      const codes = getStyleCodes(0);
      expect(codes).toEqual([]);
    });
  });

  describe('transitionStyle', () => {
    it('相同 ID 应返回空字符串', () => {
      expect(transitionStyle(3, 3)).toBe('');
      expect(transitionStyle(0, 0)).toBe('');
    });

    it('切换到 ID 0 应返回重置序列', () => {
      expect(transitionStyle(1, 0)).toBe('\x1b[0m');
    });

    it('从 0 切换到有效样式应返回 SGR 序列', () => {
      getStyleId('32', ['32']);
      const seq = transitionStyle(0, 1);
      expect(seq).toBe('\x1b[32m');
    });

    it('不同样式间切换应重置后设置新样式', () => {
      getStyleId('31', ['31']);
      getStyleId('32;1', ['32', '1']);
      const seq = transitionStyle(1, 2);
      expect(seq).toBe('\x1b[0m\x1b[32;1m');
    });
  });

  describe('clearStyleCaches', () => {
    it('清空后应重新注册样式', () => {
      getStyleId('31', ['31']);
      expect(getCachedStyleCount()).toBe(1);
      clearStyleCaches();
      expect(getCachedStyleCount()).toBe(0);
      // 清空后重新注册
      const id = getStyleId('31', ['31']);
      expect(id).toBe(1); // 从 1 重新开始
    });
  });

  describe('getCachedStyleCount', () => {
    it('初始状态应为 0', () => {
      expect(getCachedStyleCount()).toBe(0);
    });

    it('注册样式后应递增', () => {
      getStyleId('32', ['32']);
      expect(getCachedStyleCount()).toBe(1);
      getStyleId('33', ['33']);
      expect(getCachedStyleCount()).toBe(2);
    });
  });
});

describe('Generational GC', () => {
  beforeEach(() => {
    clearStyleCaches();
    resetGeneration();
  });

  describe('bumpGeneration', () => {
    it('在代际阈值内应返回 false', () => {
      // 第一次 bump: 0→1
      expect(bumpGeneration()).toBe(false);
      // 正常 bump 多次
      for (let i = 1; i < 299; i++) {
        bumpGeneration();
      }
      // 第 299 次后 generation = 299，仍未到阈值（300）
    });

    it('达到阈值时应触发 GC 并返回 true', () => {
      // 注册一个样式，确认 GC 后清除
      getStyleId('31', ['31']);
      expect(getCachedStyleCount()).toBe(1);

      // bump 到阈值
      let gcTriggered = false;
      for (let i = 0; i < 300; i++) {
        const result = bumpGeneration();
        if (result) gcTriggered = true;
      }

      expect(gcTriggered).toBe(true);
      // GC 后缓存应被清空
      expect(getCachedStyleCount()).toBe(0);
      expect(getGeneration()).toBe(0);
    });

    it('GC 后样式可重新注册', () => {
      // 先注册
      getStyleId('32', ['32']);
      expect(getCachedStyleCount()).toBe(1);

      // 触发 GC
      for (let i = 0; i < 300; i++) {
        bumpGeneration();
      }

      // GC 后重新注册
      const id = getStyleId('32', ['32']);
      const codes = getStyleCodes(id);
      expect(codes).toEqual(['32']);
    });
  });

  describe('resetGeneration', () => {
    it('应重置代际计数', () => {
      bumpGeneration();
      bumpGeneration();
      expect(getGeneration()).toBe(2);
      resetGeneration();
      expect(getGeneration()).toBe(0);
    });
  });
});
