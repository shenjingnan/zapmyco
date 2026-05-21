import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '@/config/types';
import { ProviderRegistry, parseModelKey } from '@/llm/provider-registry';

function createMinimalConfig(overrides?: Partial<LlmConfig>): LlmConfig {
  return {
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    providers: {
      anthropic: {
        apiKey: 'sk-ant-test',
      },
    },
    ...overrides,
  };
}

describe('parseModelKey', () => {
  it('should parse valid provider/model key', () => {
    const result = parseModelKey('anthropic/claude-sonnet-4-20250514');
    expect(result).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
    });
  });

  it('should return null for key without slash', () => {
    expect(parseModelKey('claude-sonnet-4-20250514')).toBeNull();
  });

  it('should return null for empty provider', () => {
    expect(parseModelKey('/model')).toBeNull();
  });

  it('should return null for empty model', () => {
    expect(parseModelKey('provider/')).toBeNull();
  });

  it('should handle multi-segment model names', () => {
    const result = parseModelKey('deepseek/deepseek-v4-flash');
    expect(result).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
  });
});

describe('ProviderRegistry', () => {
  describe('fromConfig', () => {
    it('should create registry from minimal config', () => {
      const config = createMinimalConfig();
      const registry = ProviderRegistry.fromConfig(config);
      expect(registry).toBeInstanceOf(ProviderRegistry);
      expect(registry.getStats().providerCount).toBeGreaterThanOrEqual(1);
    });

    it('should register models from builtin registry', () => {
      const config = createMinimalConfig();
      const registry = ProviderRegistry.fromConfig(config);
      const models = registry.getAllModels();
      expect(models.length).toBeGreaterThan(0);
    });

    it('should register multiple providers', () => {
      const config = createMinimalConfig({
        providers: {
          anthropic: { apiKey: 'sk-ant-test' },
          deepseek: { apiKey: 'sk-ds-test' },
        },
      });
      const registry = ProviderRegistry.fromConfig(config);
      const stats = registry.getStats();
      expect(stats.providers).toContain('anthropic');
      expect(stats.providers).toContain('deepseek');
    });
  });

  describe('resolveResolvedModel', () => {
    it('should return default model when no key given', () => {
      const config = createMinimalConfig();
      const registry = ProviderRegistry.fromConfig(config);
      const resolved = registry.resolveResolvedModel();
      expect(resolved.id).toBe('claude-sonnet-4-20250514');
      expect(resolved.provider).toBe('anthropic');
      expect(resolved.apiKey).toBe('sk-ant-test');
    });

    it('should resolve model by explicit key', () => {
      const config = createMinimalConfig();
      const registry = ProviderRegistry.fromConfig(config);
      const resolved = registry.resolveResolvedModel('anthropic/claude-sonnet-4-20250514');
      expect(resolved.id).toBe('claude-sonnet-4-20250514');
      expect(resolved.provider).toBe('anthropic');
    });

    it('should include baseURL when provider has one', () => {
      const config = createMinimalConfig({
        providers: {
          anthropic: {
            apiKey: 'sk-ant-test',
            baseUrl: 'https://custom.anthropic.com',
          },
        },
      });
      const registry = ProviderRegistry.fromConfig(config);
      const resolved = registry.resolveResolvedModel();
      expect(resolved.baseURL).toBe('https://custom.anthropic.com');
    });

    it('should throw for invalid model key format', () => {
      const config = createMinimalConfig();
      const registry = ProviderRegistry.fromConfig(config);
      expect(() => registry.resolveResolvedModel('invalid-key')).toThrow('无效的模型标识符');
    });
  });

  describe('resolveModel', () => {
    it('should resolve existing model info', () => {
      const config = createMinimalConfig();
      const registry = ProviderRegistry.fromConfig(config);
      const model = registry.resolveModel('anthropic/claude-sonnet-4-20250514');
      expect(model).toBeDefined();
      expect(model!.id).toBe('claude-sonnet-4-20250514');
    });

    it('should return undefined for unknown model', () => {
      const config = createMinimalConfig();
      const registry = ProviderRegistry.fromConfig(config);
      expect(registry.resolveModel('unknown/provider')).toBeUndefined();
    });
  });

  describe('getDefaultModel', () => {
    it('should return default model info', () => {
      const config = createMinimalConfig();
      const registry = ProviderRegistry.fromConfig(config);
      const model = registry.getDefaultModel();
      expect(model.key).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('should throw when default model key has no slash and is not registered', () => {
      const config = createMinimalConfig({
        defaultModel: 'plain-model-name',
        providers: {},
      });
      const registry = ProviderRegistry.fromConfig(config);
      expect(() => registry.getDefaultModel()).toThrow('未在配置中注册');
    });
  });

  describe('getStats', () => {
    it('should return registry statistics', () => {
      const config = createMinimalConfig();
      const registry = ProviderRegistry.fromConfig(config);
      const stats = registry.getStats();
      expect(stats).toHaveProperty('providerCount');
      expect(stats).toHaveProperty('modelCount');
      expect(stats).toHaveProperty('providers');
    });
  });
});
