/**
 * AgentLlmFacade — Agent LLM 统一外观
 *
 * 将 ProviderRegistry + ModelRouter 封装为 Agent 可直接使用的接口，
 * 替代 session.ts 中分散的模型解析和 Key 注入逻辑。
 *
 * 职责：
 * - 解析本地 Model 对象
 * - 提供 getApiKey 闭包（支持凭据池轮转）
 * - 报告 Key 使用结果（更新凭据池状态）
 * - 故障转移（获取备选 Model + Key）
 */

import type { LlmConfig } from '@/config/types';
import type { Model } from '@/core/agent-runtime/runtime-types';
import type { RoutingContext } from '@/llm/model-router';
import { ModelRouter } from '@/llm/model-router';
import type { ModelInfo } from '@/llm/provider-registry';
import { ProviderRegistry } from '@/llm/provider-registry';
import type { ResolvedModel } from '@/llm/provider-types';

export class AgentLlmFacade {
  readonly registry: ProviderRegistry;
  readonly router: ModelRouter;

  constructor(config: LlmConfig) {
    this.registry = ProviderRegistry.fromConfig(config);
    this.router = new ModelRouter(this.registry);
  }

  /**
   * 解析本地 Model 对象
   *
   * 返回与 Model 结构兼容的本地对象。
   * 新代码应优先使用 resolveResolvedModel()。
   */
  resolvePiModel(modelKey?: string): Model {
    return this.registry.resolvePiModel(modelKey) as unknown as Model;
  }

  /**
   * 解析 ResolvedModel（用于 API 调用）
   *
   * 返回 ResolvedModel 对象。
   */
  resolveResolvedModel(modelKey?: string): ResolvedModel {
    return this.registry.resolveResolvedModel(modelKey);
  }

  /**
   * 获取 API Key（从凭据池按策略获取）
   *
   * 替代 session.ts 中只返回 defaultModel Key 的简单闭包。
   * 支持凭据池轮转，自动跳过 disabled/超并发 Key。
   */
  getApiKey(provider: string): string | undefined {
    return this.registry.credentialManager.getKey(provider);
  }

  /**
   * 创建与 pi-agent-core 兼容的 getApiKey 函数
   *
   * pi-agent-core 在每次 LLM 调用时会调用此函数传入 provider 名获取 Key。
   * 返回的函数签名与 session.ts 中旧闭包保持一致：(provider: string) => string | undefined
   */
  createGetApiKeyFn(): (provider: string) => string | undefined {
    return (provider: string) => this.getApiKey(provider);
  }

  /**
   * 报告 Key 使用结果（Agent 调用结束后调用）
   *
   * 成功时重置故障计数，失败时触发故障标记。
   * 用于保持凭据池状态与实际调用结果一致。
   */
  reportKeyResult(provider: string, apiKey: string, success: boolean, error?: Error): void {
    this.registry.credentialManager.reportKeyResult(provider, apiKey, success, error);
  }

  /**
   * 获取路由决策（模型 + Key）
   *
   * 通过 ModelRouter 进行模型选择和 Key 获取。
   * 支持基于任务类型的智能路由。
   */
  route(context?: RoutingContext) {
    return this.router.route(context);
  }

  /**
   * 获取故障转移的 Model + Key
   *
   * 当 Agent 执行遇到 LLM 错误时调用。
   * 自动在同提供商 Key 和跨提供商模型间进行故障转移。
   */
  async getFallback(
    previousDecision: ReturnType<ModelRouter['route']> extends infer R | null
      ? NonNullable<R>
      : never,
    error: Error
  ) {
    return this.router.fallback(previousDecision, error);
  }

  /**
   * 解析模型信息
   */
  getModelInfo(modelKey?: string): ModelInfo | undefined {
    if (modelKey) return this.registry.resolveModel(modelKey);
    return this.registry.getDefaultModel();
  }

  /** 获取深度分析模型 */
  getAnalysisModel(): ModelInfo | undefined {
    return this.registry.getAnalysisModel();
  }

  /** 获取轻量模型 */
  getLightModel(): ModelInfo | undefined {
    return this.registry.getLightModel();
  }

  /** 获取视觉/多模态模型 */
  getVisionModel(): ModelInfo | undefined {
    return this.registry.getVisionModel();
  }

  /**
   * 解析语义化模型对应的兼容 Model 对象
   *
   * 支持 'analysis' | 'light' | 'vision' 三种语义名称
   */
  resolveSemanticPiModel(semanticName: 'analysis' | 'light' | 'vision'): Model {
    const modelInfo = this.registry.resolveSemanticModel(semanticName);
    if (!modelInfo) {
      // 全部 fallback 失败，使用默认模型
      return this.resolvePiModel();
    }
    return this.registry.resolvePiModel(modelInfo.key) as unknown as Model;
  }

  /**
   * 获取默认模型的提供商名称
   *
   * 用于向后兼容旧的 getApiKey 闭包模式。
   */
  getDefaultProviderName(): string {
    return this.registry.getDefaultModel().provider;
  }

  /**
   * 获取凭据池管理器统计信息
   */
  getCredentialStats() {
    return this.registry.credentialManager.getStats();
  }

  /**
   * 获取路由器统计信息
   */
  getRouterStats() {
    return this.router.getRoutingStats();
  }

  /**
   * 打印当前配置摘要（用于调试）
   */
  printSummary(): string {
    const registryStats = this.registry.getStats();
    const credStats = this.getCredentialStats();

    const lines: string[] = [
      `ProviderRegistry: ${registryStats.providerCount} 个提供商, ${registryStats.modelCount} 个模型`,
      `提供商: ${registryStats.providers.join(', ')}`,
      '凭据池状态:',
    ];

    for (const [name, stats] of Object.entries(credStats)) {
      lines.push(`  ${name}: ${stats.active}/${stats.total} 可用 (${stats.disabled} 禁用)`);
    }

    return lines.join('\n');
  }
}
