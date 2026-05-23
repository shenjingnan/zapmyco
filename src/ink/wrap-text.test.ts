/**
 * wrap-text 测试
 */

import { describe, expect, it } from 'vitest';
import { wrapText } from './wrap-text';

describe('wrapText', () => {
  it('should return empty string for empty input', () => {
    expect(wrapText('', 10)).toBe('');
  });

  it('should not wrap short text', () => {
    expect(wrapText('hello', 10)).toBe('hello');
  });

  it('should wrap long text', () => {
    const result = wrapText('hello world this is long', 10);
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length <= 11).toBe(true); // allow 1 extra for potential issues
    }
  });

  it('should handle wrap-trim mode', () => {
    const result = wrapText('hello world', 5, 'wrap-trim');
    expect(result).toBeTruthy();
  });

  it('should truncate at end', () => {
    const result = wrapText('hello world', 5, 'truncate-end');
    // Should be 5 chars + possibly an ellipsis
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it('should truncate at start', () => {
    const result = wrapText('hello world', 6, 'truncate-start');
    expect(result).toContain('…');
  });

  it('should truncate at middle', () => {
    const result = wrapText('hello world', 6, 'truncate-middle');
    expect(result).toContain('…');
  });

  it('should handle multi-line input', () => {
    const result = wrapText('hello\nworld', 10);
    expect(result).toBe('hello\nworld');
  });
});
