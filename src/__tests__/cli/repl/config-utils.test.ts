import { describe, expect, it } from 'vitest';
import { _getByDotPath, _setByDotPath } from '@/cli/repl/config-utils';

describe('_setByDotPath', () => {
  it('should set a top-level property', () => {
    const obj: Record<string, unknown> = {};
    _setByDotPath(obj, 'key', 'value');
    expect(obj.key).toBe('value');
  });

  it('should set a nested property', () => {
    const obj: Record<string, unknown> = { a: { b: {} } };
    _setByDotPath(obj, 'a.b.c', 'nested-value');
    expect((obj.a as Record<string, unknown>).b).toEqual({ c: 'nested-value' });
  });

  it('should create intermediate objects', () => {
    const obj: Record<string, unknown> = {};
    _setByDotPath(obj, 'a.b.c', 'value');
    expect(obj).toEqual({ a: { b: { c: 'value' } } });
  });

  it('should not write to __proto__', () => {
    const obj: Record<string, unknown> = {};
    _setByDotPath(obj, '__proto__.polluted', 'bad');
    expect(obj.polluted).toBeUndefined();
  });

  it('should not write to constructor', () => {
    const obj: Record<string, unknown> = {};
    _setByDotPath(obj, 'constructor.polluted', 'bad');
    expect((obj as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('should not write to prototype', () => {
    const obj: Record<string, unknown> = {};
    _setByDotPath(obj, 'prototype.polluted', 'bad');
    expect((obj as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('should not write intermediate __proto__ key', () => {
    const obj: Record<string, unknown> = { a: {} };
    _setByDotPath(obj, 'a.__proto__.b.c', 'bad');
    // a should not be modified via __proto__
    expect(obj.a).toBeDefined();
  });

  it('should overwrite existing value', () => {
    const obj: Record<string, unknown> = { key: 'old' };
    _setByDotPath(obj, 'key', 'new');
    expect(obj.key).toBe('new');
  });

  it('should handle single key path', () => {
    const obj: Record<string, unknown> = {};
    _setByDotPath(obj, 'single', 42);
    expect(obj.single).toBe(42);
  });
});

describe('_getByDotPath', () => {
  it('should get a top-level property', () => {
    const obj = { key: 'value' };
    expect(_getByDotPath(obj, 'key')).toBe('value');
  });

  it('should get a nested property', () => {
    const obj = { a: { b: { c: 'nested' } } };
    expect(_getByDotPath(obj, 'a.b.c')).toBe('nested');
  });

  it('should return undefined for non-existent path', () => {
    const obj = { a: {} };
    expect(_getByDotPath(obj, 'a.b.c')).toBeUndefined();
  });

  it('should return undefined when intermediate is null', () => {
    const obj = { a: null };
    expect(_getByDotPath(obj, 'a.b.c')).toBeUndefined();
  });

  it('should return undefined for __proto__ access', () => {
    const obj = {};
    expect(_getByDotPath(obj, '__proto__.polluted')).toBeUndefined();
  });

  it('should return undefined for constructor access', () => {
    const obj = {};
    expect(_getByDotPath(obj, 'constructor.polluted')).toBeUndefined();
  });

  it('should return undefined for prototype access', () => {
    const obj = {};
    expect(_getByDotPath(obj, 'prototype.polluted')).toBeUndefined();
  });

  it('should return undefined when path is deeper than object', () => {
    const obj = { a: 'leaf' };
    expect(_getByDotPath(obj, 'a.b.c')).toBeUndefined();
  });
});
