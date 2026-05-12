/**
 * CredentialPoolManager 测试
 */
import { describe, expect, it } from 'vitest';
import { CredentialPool } from '@/llm/credential-pool';
import { CredentialPoolManager } from '@/llm/credential-pool-manager';

function makeConfig(overrides?: Record<string, unknown>) {
  return {
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    providers: {
      anthropic: {
        apiKey: 'sk-ant-test',
      },
      openai: {
        credentials: [
          { apiKey: 'sk-openai-1', priority: 1, label: 'primary' },
          { apiKey: 'sk-openai-2', priority: 2, label: 'backup' },
        ],
      },
      ...overrides,
    },
  };
}

describe('CredentialPoolManager', () => {
  describe('fromConfig', () => {
    it('应从配置创建管理器并初始化池', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      expect(manager.getProviderNames()).toHaveLength(2);
      expect(manager.getProviderNames()).toContain('anthropic');
      expect(manager.getProviderNames()).toContain('openai');
    });

    it('应跳过没有凭据的提供商', () => {
      const config = makeConfig({
        emptyProvider: { apiFormat: 'openai' },
      });
      const manager = CredentialPoolManager.fromConfig(config);
      expect(manager.getProviderNames()).not.toContain('emptyProvider');
    });

    it('应跳过 null/undefined 的提供商', () => {
      const config = makeConfig();
      (config.providers as Record<string, unknown>).nullProvider = null;
      const manager = CredentialPoolManager.fromConfig(config);
      expect(manager.getProviderNames()).not.toContain('nullProvider');
    });

    it('apiKey 配置应自动包装为单条目凭据池', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      const key = manager.getKey('anthropic');
      expect(key).toBeDefined();
    });

    it('credentials 配置应优先于 apiKey', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      const pool = manager.getPool('openai');
      expect(pool).toBeDefined();
      // openai 有两个凭据
      expect(pool?.getStats().total).toBe(2);
    });
  });

  describe('getPool', () => {
    it('应返回存在的池', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      expect(manager.getPool('anthropic')).toBeInstanceOf(CredentialPool);
    });

    it('不存在的提供商应返回 undefined', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      expect(manager.getPool('nonexistent')).toBeUndefined();
    });
  });

  describe('getKey', () => {
    it('应返回指定提供商的 Key', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      const key = manager.getKey('anthropic');
      expect(key).toBe('sk-ant-test');
    });

    it('不存在的提供商应返回 undefined', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      expect(manager.getKey('nonexistent')).toBeUndefined();
    });
  });

  describe('reportKeyResult', () => {
    it('成功调用应标记 success', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      const key = manager.getKey('anthropic');
      expect(() => manager.reportKeyResult('anthropic', key!, true)).not.toThrow();
    });

    it('失败调用应标记 failed', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      const key = manager.getKey('anthropic');
      expect(() =>
        manager.reportKeyResult('anthropic', key!, false, new Error('test error'))
      ).not.toThrow();
    });

    it('不存在的提供商不应抛异常', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      expect(() => manager.reportKeyResult('nonexistent', 'key', true)).not.toThrow();
    });
  });

  describe('getStats', () => {
    it('应返回所有提供商的统计', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      const stats = manager.getStats();
      expect(stats.anthropic).toBeDefined();
      expect(stats.openai).toBeDefined();
      expect(stats.anthropic?.total).toBe(1);
      expect(stats.openai?.total).toBe(2);
    });
  });

  describe('resetAll', () => {
    it('应重置所有池', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      expect(() => manager.resetAll()).not.toThrow();
    });
  });

  describe('getProviderNames', () => {
    it('应返回所有提供商名称', () => {
      const manager = CredentialPoolManager.fromConfig(makeConfig());
      expect(manager.getProviderNames().sort()).toEqual(['anthropic', 'openai']);
    });

    it('空管理器应返回空数组', () => {
      const manager = new CredentialPoolManager();
      expect(manager.getProviderNames()).toEqual([]);
    });
  });
});
