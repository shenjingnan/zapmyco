/**
 * StylePool 单元测试
 */
import { describe, expect, it } from 'vitest';
import { chalkToCodes, StylePool } from '@/cli/tui/style-pool';

describe('StylePool', () => {
  describe('constructor', () => {
    it('应创建空的样式池，none ID = 0', () => {
      const pool = new StylePool();
      expect(pool.none).toBe(0);
      expect(pool.size).toBe(1); // 只有 none
      expect(pool.getCodes(0)).toEqual([]);
    });
  });

  describe('intern', () => {
    it('应返回 ID 并递增', () => {
      const pool = new StylePool();
      const id1 = pool.intern(['36']); // cyan
      const id2 = pool.intern(['1']); // bold
      expect(id1).toBe(1);
      expect(id2).toBe(2);
    });

    it('重复驻留应返回相同 ID', () => {
      const pool = new StylePool();
      const id1 = pool.intern(['36']);
      const id2 = pool.intern(['36']);
      expect(id1).toBe(id2);
    });

    it('空数组应返回 ID 0', () => {
      const pool = new StylePool();
      expect(pool.intern([])).toBe(0);
    });

    it('复合样式应驻留', () => {
      const pool = new StylePool();
      const id = pool.intern(['1', '32']); // bold + green
      expect(pool.getCodes(id)).toEqual(['1', '32']);
    });
  });

  describe('getCodes', () => {
    it('不存在的 ID 应返回空数组', () => {
      const pool = new StylePool();
      expect(pool.getCodes(999)).toEqual([]);
    });
  });

  describe('transition', () => {
    it('相同 ID 应返回空串', () => {
      const pool = new StylePool();
      expect(pool.transition(0, 0)).toBe('');
      const id = pool.intern(['36']);
      expect(pool.transition(id, id)).toBe('');
    });

    it('从无样式切换到样式应生成设置序列', () => {
      const pool = new StylePool();
      const id = pool.intern(['36']);
      const result = pool.transition(0, id);
      expect(result).toContain('36');
      expect(result).toContain('\x1b[');
    });

    it('从样式切换到无样式应生成重置序列', () => {
      const pool = new StylePool();
      const id = pool.intern(['36']);
      const result = pool.transition(id, 0);
      expect(result).toContain('0m'); // SGR reset
    });

    it('样式间切换应重置后再设置', () => {
      const pool = new StylePool();
      const id1 = pool.intern(['36']); // cyan
      const id2 = pool.intern(['32']); // green
      const result = pool.transition(id1, id2);
      expect(result).toContain('0m'); // reset
      expect(result).toContain('32'); // green
    });

    it('transition 结果应被缓存，相同输入返回相同实例', () => {
      const pool = new StylePool();
      const id = pool.intern(['36']);
      const r1 = pool.transition(0, id);
      const r2 = pool.transition(0, id);
      expect(r1).toBe(r2); // 引用相同
    });
  });

  describe('clearCaches', () => {
    it('应清空 transition 缓存', () => {
      const pool = new StylePool();
      const id = pool.intern(['36']);
      pool.transition(0, id);
      pool.clearCaches();
      // 清空后应重新计算
      const result = pool.transition(0, id);
      expect(result).toContain('36');
    });
  });

  describe('size', () => {
    it('应返回已驻留样式数', () => {
      const pool = new StylePool();
      pool.intern(['36']);
      pool.intern(['32']);
      expect(pool.size).toBe(3); // 0(none) + 2 = 3
    });
  });
});

describe('chalkToCodes', () => {
  it('应从 chalk 函数提取 ANSI 码', () => {
    // 模拟 chalk 函数
    const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;
    const codes = chalkToCodes(cyan);
    expect(codes).toContain('36');
  });

  it('应正确处理复合样式', () => {
    const greenBold = (s: string) => `\x1b[1m\x1b[32m${s}\x1b[39m\x1b[22m`;
    const codes = chalkToCodes(greenBold);
    expect(codes).toContain('1');
    expect(codes).toContain('32');
  });

  it('无样式函数应返回空数组', () => {
    const plain = (s: string) => s;
    const codes = chalkToCodes(plain);
    expect(codes).toEqual([]);
  });

  it('仅重置的样式应返回空数组', () => {
    const reset = (s: string) => `\x1b[0m${s}`;
    const codes = chalkToCodes(reset);
    expect(codes).toEqual([]);
  });

  it('去重：同一码出现多次只保留一次', () => {
    // 模拟 chalk.bold.bold（重复设置）
    const doubleBold = (s: string) => `\x1b[1m\x1b[1m${s}\x1b[22m`;
    const codes = chalkToCodes(doubleBold);
    expect(codes).toEqual(['1', '22']); // 1=bold set, 22=bold reset
    // 但 "1" 只应出现一次（去重）
    expect(codes.filter((c) => c === '1')).toHaveLength(1);
  });
});
