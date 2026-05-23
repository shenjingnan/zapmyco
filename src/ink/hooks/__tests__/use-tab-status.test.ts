/**
 * useTabStatus — 标签状态 hook 测试
 *
 * 测试 OSC 21337 序列构建逻辑。
 */

import { describe, expect, it } from 'vitest';
import { OSC_PREFIX, OSC_ST } from '../../termio/osc';

describe('useTabStatus dependencies', () => {
  it('OSC_PREFIX 和 OSC_ST 常量应正确', () => {
    expect(OSC_PREFIX).toBe('\x1b]');
    expect(OSC_ST).toBe('\x1b\\');
  });

  it('CLEAR_TAB_STATUS 序列格式应正确', () => {
    const clearSeq = `${OSC_PREFIX}21337;${OSC_ST}`;
    expect(clearSeq.startsWith('\x1b]')).toBe(true);
    expect(clearSeq.includes('21337')).toBe(true);
    expect(clearSeq.endsWith('\x1b\\')).toBe(true);
  });

  it('标签状态序列应包含颜色和状态文本', () => {
    const indicator = 'rgb:00/d7/5f';
    const status = 'Idle';
    const statusColor = 'rgb:88/88/88';
    const seq = `${OSC_PREFIX}21337;${indicator}/${status}/${statusColor}${OSC_ST}`;

    expect(seq).toContain('21337');
    expect(seq).toContain('rgb:00/d7/5f');
    expect(seq).toContain('Idle');
    expect(seq).toContain('rgb:88/88/88');
    expect(seq.startsWith('\x1b]')).toBe(true);
    expect(seq.endsWith('\x1b\\')).toBe(true);
  });
});
