import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '@/config/types';
import { ProviderRegistry } from '@/llm/provider-registry';

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

describe('ProviderRegistry betaHeaders', () => {
  let registry: ProviderRegistry;

  describe('fromConfig', () => {
    it('should read betaHeaders from provider config', () => {
      const config = createMinimalConfig({
        providers: {
          anthropic: {
            apiKey: 'sk-ant-test',
            betaHeaders: { 'anthropic-beta': 'prompt-caching-2025-01-01' },
          },
        },
      });

      registry = ProviderRegistry.fromConfig(config);
      const resolved = registry.resolveResolvedModel();
      expect(resolved.betaHeaders).toEqual({ 'anthropic-beta': 'prompt-caching-2025-01-01' });
    });

    it('should not include betaHeaders when not configured', () => {
      const config = createMinimalConfig();
      registry = ProviderRegistry.fromConfig(config);
      const resolved = registry.resolveResolvedModel();
      expect(resolved.betaHeaders).toBeUndefined();
    });

    it('should handle empty betaHeaders gracefully', () => {
      const config = createMinimalConfig({
        providers: {
          anthropic: {
            apiKey: 'sk-ant-test',
            betaHeaders: {},
          },
        },
      });

      registry = ProviderRegistry.fromConfig(config);
      const resolved = registry.resolveResolvedModel();
      expect(resolved.betaHeaders).toBeUndefined();
    });

    it('should keep betaHeaders per provider', () => {
      const config = createMinimalConfig({
        defaultModel: 'anthropic/claude-sonnet-4-20250514',
        providers: {
          anthropic: {
            apiKey: 'sk-ant-test',
            betaHeaders: { 'anthropic-beta': 'v1' },
          },
          deepseek: {
            apiKey: 'sk-ds-test',
            betaHeaders: { 'custom-header': 'v2' },
          },
        },
      });

      registry = ProviderRegistry.fromConfig(config);
      const anthropic = registry.resolveResolvedModel('anthropic/claude-sonnet-4-20250514');
      expect(anthropic.betaHeaders).toEqual({ 'anthropic-beta': 'v1' });
    });

    it('resolveResolvedModel should include betaHeaders for explicit model key', () => {
      const config = createMinimalConfig({
        providers: {
          anthropic: {
            apiKey: 'sk-ant-test',
            betaHeaders: { 'anthropic-beta': 'prompt-caching-2025-01-01' },
          },
        },
      });

      registry = ProviderRegistry.fromConfig(config);
      const resolved = registry.resolveResolvedModel('anthropic/claude-sonnet-4-20250514');
      expect(resolved.betaHeaders).toEqual({ 'anthropic-beta': 'prompt-caching-2025-01-01' });
    });

    it('resolveResolvedModel should use default model when no key given', () => {
      const config = createMinimalConfig({
        providers: {
          anthropic: {
            apiKey: 'sk-ant-test',
            betaHeaders: { 'anthropic-beta': 'prompt-caching-2025-01-01' },
          },
        },
      });

      registry = ProviderRegistry.fromConfig(config);
      const resolved = registry.resolveResolvedModel();
      expect(resolved.betaHeaders).toEqual({ 'anthropic-beta': 'prompt-caching-2025-01-01' });
    });
  });
});
