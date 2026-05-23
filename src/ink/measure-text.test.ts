/**
 * measure-text 测试
 */

import { describe, expect, it } from 'vitest';
import { measureText } from './measure-text';

describe('measureText', () => {
  it('should measure empty string', () => {
    const result = measureText('', 10);
    expect(result.width).toBe(0);
    expect(result.height).toBe(1);
  });

  it('should measure single-line text', () => {
    const result = measureText('hello', 100);
    expect(result.width).toBe(5);
    expect(result.height).toBe(1);
  });

  it('should measure multi-line text', () => {
    const result = measureText('hello\nworld', 100);
    expect(result.width).toBe(5);
    expect(result.height).toBe(2);
  });

  it('should calculate wrapping height', () => {
    // 'hello world' with width=5 should wrap each word
    const result = measureText('hello world', 5);
    expect(result.height).toBeGreaterThanOrEqual(2);
  });
});
