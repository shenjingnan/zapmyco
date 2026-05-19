/**
 * secret-redaction 单元测试
 */
import { describe, expect, it } from 'vitest';
import { SecretRedactor } from '@/security/secret-redaction';

describe('SecretRedactor', () => {
  describe('redact()', () => {
    const redactor = new SecretRedactor({ enabled: true });

    it('should redact OpenAI API key', () => {
      const input = 'My key is sk-proj-1234567890abcdefghijklmnop';
      const result = redactor.redact(input);
      expect(result).not.toContain('sk-proj');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact GitHub token', () => {
      const input = 'Token: ghp_1234567890abcdefghijklmnopqrstuv';
      const result = redactor.redact(input);
      expect(result).not.toContain('ghp_');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact GitLab token', () => {
      const input = 'glpat-abcdef1234567890xyzabcde';
      const result = redactor.redact(input);
      expect(result).not.toContain('glpat-');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact AWS access key', () => {
      const input = 'AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF';
      const result = redactor.redact(input);
      expect(result).not.toContain('AKIA');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact JWT token', () => {
      const input =
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNiryPJToGQi8G0Ew';
      const result = redactor.redact(input);
      expect(result).not.toContain('eyJ');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact Slack bot token', () => {
      const input = 'xoxb-test-example-token-for-unit-testing-only';
      const result = redactor.redact(input);
      expect(result).not.toContain('xoxb-');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact Stripe key', () => {
      // 使用 pk_test_ 前缀 + 构建字符串以避免 GitHub secret scanning 误报
      const keyBody = 'a'.repeat(24);
      const input = `pk_test_${keyBody}`;
      const result = redactor.redact(input);
      expect(result).not.toContain('pk_test_');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact private key headers', () => {
      const input = '-----BEGIN RSA PRIVATE KEY----- content here';
      const result = redactor.redact(input);
      expect(result).not.toContain('PRIVATE KEY');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact connection strings', () => {
      const input = 'mongodb://admin:secret123@localhost:27017/db';
      const result = redactor.redact(input);
      expect(result).not.toContain('secret123');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact bearer token in auth header', () => {
      const input = 'Authorization: bearer abcdefghijklmnopqrstuvwxyz1234567890';
      const result = redactor.redact(input);
      expect(result).not.toContain('bearer abcdef');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact Google API key', () => {
      const input = 'AIzaSyD1234567890abcdefghijklmnopqrstuvwxyz';
      const result = redactor.redact(input);
      expect(result).not.toContain('AIza');
      expect(result).toContain('****REDACTED****');
    });

    it('should redact HuggingFace token', () => {
      const input = 'hf_1234567890abcdefghijklmnopq';
      const result = redactor.redact(input);
      expect(result).not.toContain('hf_');
      expect(result).toContain('****REDACTED****');
    });

    it('should preserve non-secret text', () => {
      const input = 'This is a normal message without any secrets.';
      const result = redactor.redact(input);
      expect(result).toBe(input);
    });

    it('should use custom placeholder', () => {
      const customRedactor = new SecretRedactor({ enabled: true, placeholder: '[REDACTED]' });
      const input = 'sk-proj-1234567890abcdefghijklmnop';
      const result = customRedactor.redact(input);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('sk-proj');
    });
  });

  describe('hasSecrets()', () => {
    const redactor = new SecretRedactor({ enabled: true });

    it('should return true for text with secrets', () => {
      expect(redactor.hasSecrets('sk-1234567890abcdefghijklmnopqrstuv')).toBe(true);
    });

    it('should return false for normal text', () => {
      expect(redactor.hasSecrets('Hello world')).toBe(false);
    });

    it('should return false for empty text', () => {
      expect(redactor.hasSecrets('')).toBe(false);
    });
  });

  describe('detectSecrets()', () => {
    const redactor = new SecretRedactor({ enabled: true });

    it('should return detected secret types', () => {
      const text =
        'Key: sk-proj-1234567890abcdefghijklmnop\nToken: ghp_1234567890abcdefghijklmnopqrstuv';
      const types = redactor.detectSecrets(text);
      expect(types).toContain('OpenAI API Key');
      expect(types).toContain('GitHub Token');
    });

    it('should return empty array for clean text', () => {
      const types = redactor.detectSecrets('No secrets here');
      expect(types).toEqual([]);
    });
  });

  describe('extra patterns', () => {
    it('should support custom regex patterns', () => {
      const redactor = new SecretRedactor({
        enabled: true,
        extraPatterns: ['my_custom_secret_\\d+'],
      });
      const input = 'Contains my_custom_secret_12345 in text';
      const result = redactor.redact(input);
      expect(result).not.toContain('my_custom_secret_12345');
      expect(result).toContain('****REDACTED****');
    });

    it('should handle invalid regex extraPatterns gracefully', () => {
      const redactor = new SecretRedactor({
        enabled: true,
        // Invalid regex pattern - unmatched opening bracket
        extraPatterns: ['[invalid'],
      });
      const input = 'some text';
      const result = redactor.redact(input);
      expect(result).toBe(input);
    });
  });
});
