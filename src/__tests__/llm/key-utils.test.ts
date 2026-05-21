/**
 * key-utils 测试
 */
import { describe, expect, it } from 'vitest';
import { isEnvVarReference, maskApiKey, resolveApiKey } from '@/llm/key-utils';

describe('maskApiKey', () => {
  it('短 key（<=8 字符）应返回 ****', () => {
    expect(maskApiKey('short')).toBe('****');
    expect(maskApiKey('12345678')).toBe('****');
  });

  it('长 key 应显示前后各 4 个字符', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-1...cdef'); // cspell:disable-line
  });

  it('恰好 9 字符的 key', () => {
    expect(maskApiKey('123456789')).toBe('1234...6789');
  });
});

describe('isEnvVarReference', () => {
  it(`包含 \${VAR} 语法应返回 true`, () => {
    expect(isEnvVarReference(`\${API_KEY}`)).toBe(true);
    expect(isEnvVarReference(`prefix-\${API_KEY}`)).toBe(true);
  });

  it('普通字符串应返回 false', () => {
    expect(isEnvVarReference('plain-string')).toBe(false);
    expect(isEnvVarReference('')).toBe(false);
  });

  it('美元符号但不是环境变量语法应返回 false', () => {
    expect(isEnvVarReference('$100')).toBe(false);
    expect(isEnvVarReference('cost $50.00')).toBe(false);
  });
});

describe('resolveApiKey', () => {
  it('非环境变量引用应原样返回', () => {
    expect(resolveApiKey('sk-plain-key')).toBe('sk-plain-key');
  });

  it('应解析环境变量引用', () => {
    process.env.TEST_KEY = 'resolved-value';
    expect(resolveApiKey(`\${TEST_KEY}`)).toBe('resolved-value');
    delete process.env.TEST_KEY;
  });

  it('不存在的环境变量应替换为空字符串', () => {
    expect(resolveApiKey(`\${NONEXISTENT_VAR_12345}`)).toBe('');
  });

  it('混合文本中的环境变量引用', () => {
    process.env.MIX_KEY = 'middle';
    expect(resolveApiKey(`start-\${MIX_KEY}-end`)).toBe('start-middle-end');
    delete process.env.MIX_KEY;
  });

  it('多个环境变量引用', () => {
    process.env.A = '1';
    process.env.B = '2';
    expect(resolveApiKey(`\${A}\${B}`)).toBe('12');
    delete process.env.A;
    delete process.env.B;
  });
});
