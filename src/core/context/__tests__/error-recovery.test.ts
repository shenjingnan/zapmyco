import { describe, expect, it } from 'vitest';
import { ContextErrorRecovery, extractHttpStatus, isContextOverflowError } from '../error-recovery';

describe('isContextOverflowError', () => {
  it('should return false for null/undefined', () => {
    expect(isContextOverflowError(null)).toBe(false);
    expect(isContextOverflowError(undefined)).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isContextOverflowError('')).toBe(false);
  });

  it('should return false for non-Error objects without message', () => {
    expect(isContextOverflowError({})).toBe(false);
    expect(isContextOverflowError(123)).toBe(false);
  });

  it('should detect "context length" patterns', () => {
    expect(isContextOverflowError('context length exceeded')).toBe(true);
    expect(isContextOverflowError('Context Length is too large')).toBe(true);
    expect(isContextOverflowError('contextlength error')).toBe(true);
  });

  it('should detect "context size" patterns', () => {
    expect(isContextOverflowError('context size too large')).toBe(true);
    expect(isContextOverflowError('CONTEXT SIZE EXCEEDED')).toBe(true);
  });

  it('should detect "maximum context" patterns', () => {
    expect(isContextOverflowError('maximum context window reached')).toBe(true);
  });

  it('should detect "prompt too long" patterns', () => {
    expect(isContextOverflowError('prompt too long')).toBe(true);
    expect(isContextOverflowError('Prompt too Long error')).toBe(true);
  });

  it('should detect "413" status code in message', () => {
    expect(isContextOverflowError('HTTP 413 Request Entity Too Large')).toBe(true);
  });

  it('should detect "context_length_exceeded" patterns', () => {
    expect(isContextOverflowError('context_length_exceeded: max tokens reached')).toBe(true);
    expect(isContextOverflowError('CONTEXT_LENGTH_EXCEEDED')).toBe(true);
  });

  it('should detect "request too large" patterns', () => {
    expect(isContextOverflowError('request too large for processing')).toBe(true);
  });

  it('should detect "input too long" patterns', () => {
    expect(isContextOverflowError('input too long')).toBe(true);
  });

  it('should detect "exceeds context" patterns', () => {
    expect(isContextOverflowError('this exceeds context window limit')).toBe(true);
  });

  it('should detect "exceeds the maximum" patterns', () => {
    expect(isContextOverflowError('exceeds the maximum allowed tokens')).toBe(true);
  });

  it('should detect "token limit" patterns', () => {
    expect(isContextOverflowError('token limit exceeded')).toBe(true);
  });

  it('should detect "max tokens" patterns', () => {
    expect(isContextOverflowError('max tokens limit reached')).toBe(true);
  });

  it('should detect "reduce the length" patterns', () => {
    expect(isContextOverflowError('please reduce the length of your input')).toBe(true);
  });

  it('should work with Error instances', () => {
    const err = new Error('context length exceeded');
    expect(isContextOverflowError(err)).toBe(true);
  });

  it('should return false for non-matching error messages', () => {
    expect(isContextOverflowError('network timeout')).toBe(false);
    expect(isContextOverflowError('authentication failed')).toBe(false);
    expect(isContextOverflowError('rate limit exceeded')).toBe(false);
  });
});

describe('extractHttpStatus', () => {
  it('should return undefined for non-object input', () => {
    expect(extractHttpStatus(null)).toBeUndefined();
    expect(extractHttpStatus(undefined)).toBeUndefined();
    expect(extractHttpStatus('string')).toBeUndefined();
    expect(extractHttpStatus(123)).toBeUndefined();
  });

  it('should return undefined for object without status fields', () => {
    expect(extractHttpStatus({ message: 'error' })).toBeUndefined();
  });

  it('should extract numeric status field', () => {
    expect(extractHttpStatus({ status: 400 })).toBe(400);
  });

  it('should extract numeric statusCode field', () => {
    expect(extractHttpStatus({ statusCode: 413 })).toBe(413);
  });

  it('should extract numeric httpStatus field', () => {
    expect(extractHttpStatus({ httpStatus: 500 })).toBe(500);
  });

  it('should extract numeric code field', () => {
    expect(extractHttpStatus({ code: 429 })).toBe(429);
  });

  it('should parse string status fields to number', () => {
    expect(extractHttpStatus({ status: '400' })).toBe(400);
  });

  it('should return undefined for non-numeric strings', () => {
    expect(extractHttpStatus({ status: 'abc' })).toBeUndefined();
  });

  it('should respect priority: status > statusCode > httpStatus > code', () => {
    const err = { status: 400, statusCode: 413, httpStatus: 500, code: 429 };
    expect(extractHttpStatus(err)).toBe(400);
  });

  it('should fall through to next field if first is not numeric', () => {
    const err = { status: 'abc', statusCode: 413 };
    expect(extractHttpStatus(err)).toBe(413);
  });
});

describe('ContextErrorRecovery', () => {
  it('should default to maxAttempts = 3', () => {
    const recovery = new ContextErrorRecovery();
    expect(recovery.isExhausted).toBe(false);
    expect(recovery.getStatus()).toBe('紧急恢复: 0/3 次尝试');
  });

  it('should accept custom maxAttempts', () => {
    const recovery = new ContextErrorRecovery(5);
    expect(recovery.getStatus()).toBe('紧急恢复: 0/5 次尝试');
  });

  describe('shouldRecover', () => {
    it('should return true for context overflow error with status 400', () => {
      const recovery = new ContextErrorRecovery();
      const error = new Error('context length exceeded');
      (error as unknown as Record<string, unknown>).status = 400;
      expect(recovery.shouldRecover(error)).toBe(true);
    });

    it('should return true for context overflow error with status 413', () => {
      const recovery = new ContextErrorRecovery();
      const error = new Error('prompt too long');
      (error as unknown as Record<string, unknown>).statusCode = 413;
      expect(recovery.shouldRecover(error)).toBe(true);
    });

    it('should return true for context overflow error with undefined status', () => {
      const recovery = new ContextErrorRecovery();
      expect(recovery.shouldRecover('context length exceeded')).toBe(true);
    });

    it('should return false for non-overflow errors', () => {
      const recovery = new ContextErrorRecovery();
      expect(recovery.shouldRecover('network error')).toBe(false);
    });

    it('should return false for status 500 even with overflow message', () => {
      const recovery = new ContextErrorRecovery();
      const error = new Error('context length exceeded');
      (error as unknown as Record<string, unknown>).status = 500;
      expect(recovery.shouldRecover(error)).toBe(false);
    });

    it('should return false once exhausted', () => {
      const recovery = new ContextErrorRecovery(2);
      // Simulate using all attempts
      recovery.prepareRecovery();
      recovery.prepareRecovery();

      expect(recovery.isExhausted).toBe(true);
      expect(recovery.shouldRecover('context length exceeded')).toBe(false);
    });
  });

  describe('prepareRecovery', () => {
    it('should return progressively aggressive parameters on first call', () => {
      const recovery = new ContextErrorRecovery();
      const params = recovery.prepareRecovery();

      expect(params.attempt).toBe(1);
      expect(params.protectLastMessages).toBe(15); // max(5, 20 - 1*5) = 15
      expect(params.thresholdPercent).toBeCloseTo(0.55); // max(0.3, 0.7 - 1*0.15) = 0.55
    });

    it('should return more aggressive parameters on second call', () => {
      const recovery = new ContextErrorRecovery();
      recovery.prepareRecovery();
      const params = recovery.prepareRecovery();

      expect(params.attempt).toBe(2);
      expect(params.protectLastMessages).toBe(10); // max(5, 20 - 2*5) = 10
      expect(params.thresholdPercent).toBeCloseTo(0.4); // max(0.3, 0.7 - 2*0.15) = 0.4
    });

    it('should floor protectLastMessages at 5', () => {
      const recovery = new ContextErrorRecovery();
      recovery.prepareRecovery(); // 1
      recovery.prepareRecovery(); // 2
      recovery.prepareRecovery(); // 3
      const params = recovery.prepareRecovery(); // 4

      expect(params.protectLastMessages).toBe(5); // max(5, 20 - 4*5) = 5
      expect(params.thresholdPercent).toBeCloseTo(0.3); // max(0.3, 0.7 - 4*0.15) = 0.3
    });

    it('should floor thresholdPercent at 0.3', () => {
      const recovery = new ContextErrorRecovery();
      for (let i = 0; i < 10; i++) {
        recovery.prepareRecovery();
      }
      const params = recovery.prepareRecovery();
      // max(0.3, 0.7 - 11*0.15 = -0.95) = 0.3
      expect(params.thresholdPercent).toBeCloseTo(0.3);
    });
  });

  describe('reset', () => {
    it('should reset consecutiveAttempts to 0', () => {
      const recovery = new ContextErrorRecovery();
      recovery.prepareRecovery();
      recovery.prepareRecovery();

      recovery.reset();

      expect(recovery.isExhausted).toBe(false);
      expect(recovery.getStatus()).toBe('紧急恢复: 0/3 次尝试');
    });
  });

  describe('isExhausted', () => {
    it('should return false initially', () => {
      const recovery = new ContextErrorRecovery();
      expect(recovery.isExhausted).toBe(false);
    });

    it('should return true when attempts reach maxAttempts', () => {
      const recovery = new ContextErrorRecovery(2);
      recovery.prepareRecovery();
      expect(recovery.isExhausted).toBe(false);
      recovery.prepareRecovery();
      expect(recovery.isExhausted).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return Chinese status string', () => {
      const recovery = new ContextErrorRecovery(2);
      expect(recovery.getStatus()).toBe('紧急恢复: 0/2 次尝试');

      recovery.prepareRecovery();
      expect(recovery.getStatus()).toBe('紧急恢复: 1/2 次尝试');
    });
  });
});
