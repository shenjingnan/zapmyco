import { describe, it, expect, vi } from 'vitest';
import { RecordUtils } from './utils';

describe('RecordUtils', () => {
  describe('map', () => {
    it('should transform all values in the record', () => {
      const input = { a: 1, b: 2, c: 3 };
      const result = RecordUtils.map(input, (value) => value * 2);
      expect(result).toEqual({ a: 2, b: 4, c: 6 });
    });

    it('should handle empty record', () => {
      const input = {};
      const result = RecordUtils.map(input, (value) => value);
      expect(result).toEqual({});
    });

    it('should provide key to mapping function', () => {
      const input = { a: 1, b: 2 };
      const result = RecordUtils.map(input, (value, key) => `${key}:${value}`);
      expect(result).toEqual({ a: 'a:1', b: 'b:2' });
    });
  });

  describe('filter', () => {
    it('should filter values based on predicate', () => {
      const input = { a: 1, b: 2, c: 3, d: 4 };
      const result = RecordUtils.filter(input, (value) => value % 2 === 0);
      expect(result).toEqual({ b: 2, d: 4 });
    });

    it('should handle empty record', () => {
      const input = {};
      const result = RecordUtils.filter(input, () => true);
      expect(result).toEqual({});
    });

    it('should provide key to filter function', () => {
      const input = { a: 1, b: 2, c: 3 };
      const result = RecordUtils.filter(input, (_, key) => key === 'b');
      expect(result).toEqual({ b: 2 });
    });

    it('should return empty object when no items match', () => {
      const input = { a: 1, b: 2, c: 3 };
      const result = RecordUtils.filter(input, () => false);
      expect(result).toEqual({});
    });
  });

  describe('forEach', () => {
    it('should execute callback for each entry', () => {
      const input = { a: 1, b: 2, c: 3 };
      const mockFn = vi.fn();

      RecordUtils.forEach(input, mockFn);

      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(mockFn).toHaveBeenCalledWith(1, 'a');
      expect(mockFn).toHaveBeenCalledWith(2, 'b');
      expect(mockFn).toHaveBeenCalledWith(3, 'c');
    });

    it('should handle empty record', () => {
      const input = {};
      const mockFn = vi.fn();

      RecordUtils.forEach(input, mockFn);

      expect(mockFn).not.toHaveBeenCalled();
    });
  });

  describe('transform', () => {
    it('should transform values according to the transform function', () => {
      const input = { a: 1, b: 2, c: 3 };
      const result = RecordUtils.transform(input, (value) => value.toString());
      expect(result).toEqual({ a: '1', b: '2', c: '3' });
    });

    it('should handle empty record', () => {
      const input = {};
      const result = RecordUtils.transform(input, (value) => value);
      expect(result).toEqual({});
    });

    it('should provide key to transform function', () => {
      const input = { a: 1, b: 2 };
      const result = RecordUtils.transform(input, (value, key) => ({ value, key }));
      expect(result).toEqual({
        a: { value: 1, key: 'a' },
        b: { value: 2, key: 'b' },
      });
    });

    it('should handle complex transformations', () => {
      const input = { a: 'hello', b: 'world' };
      const result = RecordUtils.transform(input, (value) => ({
        original: value,
        length: value.length,
      }));
      expect(result).toEqual({
        a: { original: 'hello', length: 5 },
        b: { original: 'world', length: 5 },
      });
    });
  });
});
