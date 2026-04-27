import { describe, expect, it } from 'vitest';
import { APP_NAME, VERSION } from '../index';

describe('VERSION', () => {
  it('should be a string', () => {
    expect(typeof VERSION).toBe('string');
  });

  it('should match semver format', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('APP_NAME', () => {
  it('should be zapmyco', () => {
    expect(APP_NAME).toBe('zapmyco');
  });
});
