/**
 * stringWidth 测试
 */

import { describe, expect, it } from 'vitest';
import { stringWidth } from './stringWidth';

describe('stringWidth', () => {
  it('should return 0 for empty string', () => {
    expect(stringWidth('')).toBe(0);
  });

  it('should count ASCII characters', () => {
    expect(stringWidth('hello')).toBe(5);
    expect(stringWidth('a b c')).toBe(5);
  });

  it('should count CJK characters as width 2', () => {
    expect(stringWidth('中文')).toBe(4);
    expect(stringWidth('a中文b')).toBe(6);
  });

  it('should ignore ANSI escape sequences', () => {
    const red = '\x1b[31m';
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const green = '\x1b[32m';
    expect(stringWidth(`${red}red${reset}`)).toBe(3);
    expect(stringWidth(`${bold}${green}bold green${reset}`)).toBe(10);
  });

  it('should count emoji as width 2', () => {
    expect(stringWidth('😀')).toBe(2);
    expect(stringWidth('a😀b')).toBe(4);
  });

  it('should handle mixed content', () => {
    expect(stringWidth('Hello 你好 🌍')).toBe(13); // 5 + 1 + 4 + 1 + 2
  });

  it('should handle newlines and tabs as zero-width', () => {
    // \n and \t are control characters, don't have display width
    expect(stringWidth('\n')).toBe(0);
    expect(stringWidth('\t')).toBe(0);
    // But regular text with them should still work
    expect(stringWidth('a\nb')).toBe(2);
    expect(stringWidth('a\tb')).toBe(2);
  });

  it('should treat zero-width characters correctly', () => {
    // Combining diaeresis (¨) on 'a'
    expect(stringWidth('a\u0308')).toBe(1); // a + combining umlaut = width 1
    // Variation selector
    expect(stringWidth('a\uFE0F')).toBe(1);
  });
});
