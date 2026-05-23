/**
 * useTerminalTitle — 终端标题 hook 测试
 *
 * 测试 hook 依赖的 osc.ts 工具函数。
 */

import { describe, expect, it } from 'vitest';
import { OSC, osc } from '../../termio/osc';

describe('useTerminalTitle dependencies', () => {
  it('osc 函数应生成正确格式的序列', () => {
    const result = osc(OSC.SET_TITLE_AND_ICON, 'test-title');
    expect(result.startsWith('\x1b]')).toBe(true);
    expect(result.includes('0')).toBe(true);
    expect(result.includes('test-title')).toBe(true);
    expect(result.endsWith('\x1b\\')).toBe(true);
  });

  it('osc 函数应支持多参数', () => {
    const result = osc(OSC.SET_TITLE, 'my-title');
    expect(result.startsWith('\x1b]')).toBe(true);
    expect(result.includes('2;my-title')).toBe(true);
    expect(result.endsWith('\x1b\\')).toBe(true);
  });

  it('OSC 常量应定义正确值', () => {
    expect(OSC.SET_TITLE_AND_ICON).toBe(0);
    expect(OSC.SET_ICON).toBe(1);
    expect(OSC.SET_TITLE).toBe(2);
  });
});
