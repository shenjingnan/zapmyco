/**
 * permission-config 单元测试
 */
import { describe, expect, it } from 'vitest';
import { matchParamPatterns, matchToolPattern, resolveConfig } from '@/security/permission-config';

describe('resolveConfig', () => {
  it('should return default config when empty input', () => {
    const config = resolveConfig({});
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('normal');
    expect(config.defaultAction).toBe('ask');
    expect(config.persistence.enabled).toBe(true);
  });

  it('should use strict mode correctly', () => {
    const config = resolveConfig({ mode: 'strict' });
    expect(config.mode).toBe('strict');
    expect(config.modeStrategy.maxAutoAllow).toBe('low');
    expect(config.defaultAction).toBe('deny');
  });

  it('should use permissive mode correctly', () => {
    const config = resolveConfig({ mode: 'permissive' });
    expect(config.mode).toBe('permissive');
    expect(config.modeStrategy.maxAutoAllow).toBe('medium');
    expect(config.defaultAction).toBe('allow');
  });

  it('should respect explicit defaultAction', () => {
    const config = resolveConfig({ mode: 'normal', defaultAction: 'allow' });
    expect(config.defaultAction).toBe('allow');
  });

  it('should merge deny and allow rules', () => {
    const config = resolveConfig({
      denyRules: [{ action: 'deny', toolPattern: 'Exec' }],
      allowRules: [{ action: 'allow', toolPattern: 'Read*' }],
    });
    expect(config.denyRules).toHaveLength(1);
    expect(config.allowRules).toHaveLength(1);
  });

  it('should handle disabled security', () => {
    const config = resolveConfig({ enabled: false });
    expect(config.enabled).toBe(false);
  });
});

describe('matchToolPattern', () => {
  it('should match exact tool ID', () => {
    expect(matchToolPattern('ReadFile', 'ReadFile')).toBe(true);
  });

  it('should not match different tool ID', () => {
    expect(matchToolPattern('ReadFile', 'WriteFile')).toBe(false);
  });

  it('should match * wildcard', () => {
    expect(matchToolPattern('*', 'ReadFile')).toBe(true);
    expect(matchToolPattern('*', 'AnyTool')).toBe(true);
  });

  it('should match prefix wildcard', () => {
    expect(matchToolPattern('Web*', 'WebFetch')).toBe(true);
    expect(matchToolPattern('Web*', 'WebSearch')).toBe(true);
    expect(matchToolPattern('Web*', 'ReadFile')).toBe(false);
  });

  it('should match suffix wildcard', () => {
    expect(matchToolPattern('*File', 'ReadFile')).toBe(true);
    expect(matchToolPattern('*File', 'WriteFile')).toBe(true);
    expect(matchToolPattern('*File', 'Glob')).toBe(false);
  });
});

describe('matchParamPatterns', () => {
  it('should return true for empty patterns', () => {
    expect(matchParamPatterns(undefined, { key: 'value' })).toBe(true);
    expect(matchParamPatterns({}, { key: 'value' })).toBe(true);
  });

  it('should match single param', () => {
    expect(matchParamPatterns({ action: 'read' }, { action: 'read' })).toBe(true);
  });

  it('should reject non-matching param', () => {
    expect(matchParamPatterns({ action: 'write' }, { action: 'read' })).toBe(false);
  });

  it('should match multiple params', () => {
    expect(
      matchParamPatterns({ action: 'write', type: 'project' }, { action: 'write', type: 'project' })
    ).toBe(true);
  });

  it('should reject if any param mismatches', () => {
    expect(
      matchParamPatterns({ action: 'write', type: 'user' }, { action: 'write', type: 'project' })
    ).toBe(false);
  });

  it('should reject if param is missing', () => {
    expect(matchParamPatterns({ action: 'read' }, {})).toBe(false);
  });
});
