import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAnthropic } = vi.hoisted(() => ({
  mockAnthropic: vi.fn(),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: mockAnthropic,
}));

import { clearClients, getClient } from '@/llm/client-manager';

describe('client-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearClients();
  });

  describe('getClient()', () => {
    it('should use default baseURL when called with no arguments', () => {
      getClient();
      expect(mockAnthropic).toHaveBeenCalledTimes(1);
      expect(mockAnthropic).toHaveBeenCalledWith({
        baseURL: 'https://api.anthropic.com',
      });
    });

    it('should use custom baseURL when provided', () => {
      getClient('https://custom.com', 'key-1');
      expect(mockAnthropic).toHaveBeenCalledTimes(1);
      expect(mockAnthropic).toHaveBeenCalledWith({
        baseURL: 'https://custom.com',
        apiKey: 'key-1',
      });
    });

    it('should pass apiKey when provided', () => {
      getClient(undefined, 'sk-ant-xxx');
      expect(mockAnthropic).toHaveBeenCalledTimes(1);
      expect(mockAnthropic).toHaveBeenCalledWith({
        baseURL: 'https://api.anthropic.com',
        apiKey: 'sk-ant-xxx',
      });
    });

    it('should return cached client for same key (cache reuse)', () => {
      const client1 = getClient('https://same.com', 'same-key');
      const client2 = getClient('https://same.com', 'same-key');
      expect(client1).toBe(client2);
      expect(mockAnthropic).toHaveBeenCalledTimes(1);
    });

    it('should return different instances for different baseURL', () => {
      const client1 = getClient('https://url1.com', 'same-key');
      const client2 = getClient('https://url2.com', 'same-key');
      expect(client1).not.toBe(client2);
      expect(mockAnthropic).toHaveBeenCalledTimes(2);
    });

    it('should return different instances for different apiKey', () => {
      const client1 = getClient('https://same.com', 'key-1');
      const client2 = getClient('https://same.com', 'key-2');
      expect(client1).not.toBe(client2);
      expect(mockAnthropic).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearClients()', () => {
    it('should create a new instance after clearing cache', () => {
      getClient('https://example.com', 'key-1');
      expect(mockAnthropic).toHaveBeenCalledTimes(1);

      clearClients();

      getClient('https://example.com', 'key-1');
      expect(mockAnthropic).toHaveBeenCalledTimes(2);
    });

    it('should invalidate all cache keys after clear', () => {
      getClient('https://a.com', 'key-a');
      getClient('https://b.com', 'key-b');
      expect(mockAnthropic).toHaveBeenCalledTimes(2);

      clearClients();

      getClient('https://a.com', 'key-a');
      getClient('https://b.com', 'key-b');
      expect(mockAnthropic).toHaveBeenCalledTimes(4);
    });
  });

  describe('betaHeaders', () => {
    it('should pass betaHeaders as defaultHeaders to Anthropic constructor', () => {
      const betaHeaders = { 'anthropic-beta': 'prompt-caching-2025-01-01' };
      getClient('https://api.anthropic.com', 'key-1', 'anthropic', betaHeaders);
      expect(mockAnthropic).toHaveBeenCalledWith({
        baseURL: 'https://api.anthropic.com',
        apiKey: 'key-1',
        defaultHeaders: betaHeaders,
      });
    });

    it('should create separate clients for different betaHeaders', () => {
      getClient('https://same.com', 'key', 'anthropic', { a: '1' });
      getClient('https://same.com', 'key', 'anthropic', { a: '2' });
      expect(mockAnthropic).toHaveBeenCalledTimes(2);
    });

    it('should reuse same client for same betaHeaders (order-independent)', () => {
      getClient('https://same.com', 'key', 'anthropic', { a: '1', b: '2' });
      getClient('https://same.com', 'key', 'anthropic', { b: '2', a: '1' });
      expect(mockAnthropic).toHaveBeenCalledTimes(1);
    });

    it('should not pass defaultHeaders when betaHeaders is empty', () => {
      getClient('https://api.anthropic.com', 'key-1', 'anthropic', {});
      expect(mockAnthropic).toHaveBeenCalledWith({
        baseURL: 'https://api.anthropic.com',
        apiKey: 'key-1',
      });
    });

    it('should not pass defaultHeaders when betaHeaders is undefined', () => {
      getClient('https://api.anthropic.com', 'key-1');
      expect(mockAnthropic).toHaveBeenCalledWith({
        baseURL: 'https://api.anthropic.com',
        apiKey: 'key-1',
      });
    });

    it('should reuse cached client when betaHeaders is same', () => {
      const headers = { 'anthropic-beta': 'test-2025-01-01' };
      const client1 = getClient('https://api.anthropic.com', 'key-1', 'anthropic', headers);
      const client2 = getClient('https://api.anthropic.com', 'key-1', 'anthropic', headers);
      expect(client1).toBe(client2);
      expect(mockAnthropic).toHaveBeenCalledTimes(1);
    });
  });
});
