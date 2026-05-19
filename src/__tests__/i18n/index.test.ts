import { describe, expect, it } from 'vitest';
import { getCurrentLocale, setLocale, t } from '@/i18n';

describe('i18n', () => {
  it('should have default locale as zh-CN', () => {
    expect(getCurrentLocale()).toBe('zh-CN');
  });

  it('should translate known keys', () => {
    const translated = t('session.displayName');
    expect(translated).toBeTruthy();
    expect(typeof translated).toBe('string');
  });

  it('should change locale and switch back', async () => {
    const prev = getCurrentLocale();
    await setLocale('en');
    expect(getCurrentLocale()).toBe('en');
    await setLocale(prev);
    expect(getCurrentLocale()).toBe(prev);
  });

  it('should not throw on invalid locale', () => {
    expect(() => setLocale('invalid-locale')).not.toThrow();
  });
});
