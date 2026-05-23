/**
 * tabstops 测试
 */

import { describe, expect, it } from 'vitest';
import { expandTabs } from './tabstops';

describe('expandTabs', () => {
  it('should return text unchanged if no tabs', () => {
    expect(expandTabs('hello world')).toBe('hello world');
  });

  it('should expand tabs at start of line', () => {
    const result = expandTabs('\thello');
    expect(result.length).toBe(8 + 5);
    expect(result.startsWith(' '.repeat(8))).toBe(true);
  });

  it('should expand tabs in the middle of text', () => {
    const result = expandTabs('a\tb');
    expect(result.length).toBeGreaterThan(3);
  });

  it('should handle multiple tabs', () => {
    const result = expandTabs('a\tb\tc');
    expect(result).not.toContain('\t');
  });

  it('should respect custom interval', () => {
    const result = expandTabs('\ta', 4);
    expect(result.startsWith(' '.repeat(4))).toBe(true);
  });

  it('should handle empty string', () => {
    expect(expandTabs('')).toBe('');
  });

  it('should preserve newlines and reset column', () => {
    const result = expandTabs('a\tb\nc\td');
    expect(result).not.toContain('\t');
    expect(result).toContain('\n');
  });
});
