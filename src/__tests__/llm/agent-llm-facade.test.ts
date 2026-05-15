/**
 * AgentLlmFacade 测试
 */

import type { Model } from '@earendil-works/pi-ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmConfig } from '@/config/types';
import { AgentLlmFacade } from '@/llm/agent-llm-facade';

// Mock ProviderRegistry
const mockResolvePiModel = vi.fn();
const mockResolveModel = vi.fn();
const mockGetDefaultModel = vi.fn();
const mockGetKey = vi.fn();
const mockReportKeyResult = vi.fn();
const mockGetStats = vi.fn();
const mockGetProviderNames = vi.fn();

vi.mock('@/llm/provider-registry', () => ({
  ProviderRegistry: {
    fromConfig: vi.fn(() => ({
      resolvePiModel: mockResolvePiModel,
      resolveModel: mockResolveModel,
      getDefaultModel: mockGetDefaultModel,
      credentialManager: {
        getKey: mockGetKey,
        reportKeyResult: mockReportKeyResult,
        getStats: mockGetStats,
        getProviderNames: mockGetProviderNames,
      },
      getStats: vi.fn(() => ({
        providerCount: 2,
        modelCount: 5,
        providers: ['anthropic', 'openai'],
      })),
    })),
  },
}));

// Mock ModelRouter
const mockRoute = vi.fn();
const mockFallback = vi.fn();
const mockGetRoutingStats = vi.fn();

vi.mock('@/llm/model-router', () => ({
  ModelRouter: vi.fn(() => ({
    route: mockRoute,
    fallback: mockFallback,
    getRoutingStats: mockGetRoutingStats,
  })),
}));

const baseConfig: LlmConfig = {
  defaultModel: 'anthropic/claude-sonnet-4-20250514',
  providers: {
    anthropic: { apiKey: 'sk-ant-test' },
  },
};

describe('AgentLlmFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultModel.mockReturnValue({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      modelKey: 'anthropic/claude-sonnet-4-20250514',
    });
    mockGetKey.mockReturnValue('sk-ant-test');
    mockGetStats.mockReturnValue({
      anthropic: { total: 1, active: 1, disabled: 0 },
      openai: { total: 2, active: 2, disabled: 0 },
    });
    mockGetProviderNames.mockReturnValue(['anthropic', 'openai']);
    mockRoute.mockReturnValue({
      modelKey: 'anthropic/claude-sonnet-4-20250514',
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: {} as Model<never>,
      apiKeyMasked: 'sk-a***est',
      fallbackChain: [],
    } as never);
    mockGetRoutingStats.mockReturnValue({ routes: 0, fallbacks: 0 });
  });

  describe('resolvePiModel', () => {
    it('应委托给 registry.resolvePiModel', () => {
      const mockModel = { name: 'test' } as Model<never>;
      mockResolvePiModel.mockReturnValue(mockModel);
      const facade = new AgentLlmFacade(baseConfig);
      const result = facade.resolvePiModel('anthropic/test');
      expect(result).toBe(mockModel);
    });

    it('不传 modelKey 时应使用默认模型', () => {
      const mockModel = { name: 'default' } as Model<never>;
      mockResolvePiModel.mockReturnValue(mockModel);
      const facade = new AgentLlmFacade(baseConfig);
      expect(facade.resolvePiModel()).toBe(mockModel);
    });
  });

  describe('getApiKey', () => {
    it('应委托给 credentialManager.getKey', () => {
      const facade = new AgentLlmFacade(baseConfig);
      expect(facade.getApiKey('anthropic')).toBe('sk-ant-test');
    });
  });

  describe('createGetApiKeyFn', () => {
    it('应返回调用 getApiKey 的函数', () => {
      const facade = new AgentLlmFacade(baseConfig);
      const fn = facade.createGetApiKeyFn();
      expect(fn('anthropic')).toBe('sk-ant-test');
    });
  });

  describe('reportKeyResult', () => {
    it('应委托给 credentialManager.reportKeyResult', () => {
      const facade = new AgentLlmFacade(baseConfig);
      facade.reportKeyResult('anthropic', 'sk-ant-test', false, new Error('fail'));
      expect(mockReportKeyResult).toHaveBeenCalledWith(
        'anthropic',
        'sk-ant-test',
        false,
        expect.any(Error)
      );
    });
  });

  describe('route', () => {
    it('应委托给 router.route', () => {
      const facade = new AgentLlmFacade(baseConfig);
      const result = facade.route();
      expect(result).toBeDefined();
    });
  });

  describe('getFallback', () => {
    it('应委托给 router.fallback', async () => {
      mockFallback.mockResolvedValue({
        modelKey: 'openai/gpt-4o',
        provider: 'openai',
        apiKey: 'sk-openai',
      });
      const facade = new AgentLlmFacade(baseConfig);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prev = {
        modelKey: 'anthropic/claude',
        provider: 'anthropic',
        apiKey: 'sk-old',
      } as any;
      const result = await facade.getFallback(prev, new Error('rate limit'));
      expect(result).toBeDefined();
      expect(mockFallback).toHaveBeenCalled();
    });
  });

  describe('getModelInfo', () => {
    it('传入 modelKey 时应解析', () => {
      mockResolveModel.mockReturnValue({
        provider: 'anthropic',
        modelId: 'claude-opus',
        modelKey: 'anthropic/claude-opus',
      });
      const facade = new AgentLlmFacade(baseConfig);
      const result = facade.getModelInfo('anthropic/claude-opus');
      expect(result).toBeDefined();
    });

    it('不传 modelKey 时应返回默认模型', () => {
      const facade = new AgentLlmFacade(baseConfig);
      const result = facade.getModelInfo();
      expect(result).toBeDefined();
      expect(result?.provider).toBe('anthropic');
    });
  });

  describe('getDefaultProviderName', () => {
    it('应返回默认模型的提供商名称', () => {
      const facade = new AgentLlmFacade(baseConfig);
      expect(facade.getDefaultProviderName()).toBe('anthropic');
    });
  });

  describe('getCredentialStats', () => {
    it('应返回凭据池统计', () => {
      const facade = new AgentLlmFacade(baseConfig);
      const stats = facade.getCredentialStats();
      expect(stats.anthropic).toBeDefined();
    });
  });

  describe('getRouterStats', () => {
    it('应返回路由统计', () => {
      const facade = new AgentLlmFacade(baseConfig);
      const stats = facade.getRouterStats();
      expect(stats).toBeDefined();
    });
  });

  describe('printSummary', () => {
    it('应返回格式化的摘要字符串', () => {
      const facade = new AgentLlmFacade(baseConfig);
      const summary = facade.printSummary();
      expect(summary).toContain('ProviderRegistry');
      expect(summary).toContain('anthropic');
      expect(summary).toContain('openai');
      expect(summary).toContain('凭据池状态');
    });
  });
});
