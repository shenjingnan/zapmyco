/**
 * ProviderRegistry — 提供商 + 模型统一注册中心
 *
 * 从 LlmConfig 构建，提供模型解析、故障转移链构建、按能力筛选等功能。
 * 依赖 pi-ai 的 getModel() 进行懒加载 Model 对象创建。
 */

import type { KnownProvider, Model } from '@mariozechner/pi-ai';
import { getModel, getModels } from '@mariozechner/pi-ai';
import type { LlmConfig, LlmFallbackConfig, LlmRoutingConfig } from '@/config/types';
import { logger } from '@/infra/logger';
import { CredentialPoolManager } from '@/llm/credential-pool-manager';
import { parseModelKey } from '@/llm/pi-ai-provider';

// ============ 类型定义 ============

/** 模型能力标签 */
export type ModelCapability = 'chat' | 'code' | 'reasoning' | 'vision' | 'fast' | 'streaming';

/** 成本层级 */
export type CostTier = 'low' | 'medium' | 'high' | 'premium';

/** 模型信息 */
export interface ModelInfo {
  /** 模型 ID（API 实际值） */
  id: string;
  /** 所属提供商名称 */
  provider: string;
  /** 唯一 key："provider/modelId" */
  key: string;
  /** 模型描述 */
  description?: string;
  /** 支持的输入类型 */
  input?: string[];
  /** 能力标签 */
  capabilities?: ModelCapability[];
  /** 成本层级 */
  costTier?: CostTier;
  /** 自定义 baseUrl */
  baseUrl?: string;
}

/** 提供商信息 */
export interface ProviderInfo {
  name: string;
  displayName: string;
  models: ModelInfo[];
  priority?: number;
  enabled?: boolean;
}

/** 注册统计 */
export interface RegistryStats {
  providerCount: number;
  modelCount: number;
  providers: string[];
}

// ============ ProviderRegistry ============

export class ProviderRegistry {
  private providers: Map<string, ProviderInfo> = new Map();
  private models: Map<string, ModelInfo> = new Map();
  readonly credentialManager: CredentialPoolManager;
  private fallbackConfig: LlmFallbackConfig | undefined;
  private routingConfig: LlmRoutingConfig | undefined;
  private defaultModelKey: string;

  private constructor(
    credentialManager: CredentialPoolManager,
    defaultModelKey: string,
    fallbackConfig?: LlmFallbackConfig,
    routingConfig?: LlmRoutingConfig
  ) {
    this.credentialManager = credentialManager;
    this.defaultModelKey = defaultModelKey;
    this.fallbackConfig = fallbackConfig;
    this.routingConfig = routingConfig;
  }

  /**
   * 从 LlmConfig 构建注册表
   */
  static fromConfig(config: LlmConfig): ProviderRegistry {
    const credentialManager = CredentialPoolManager.fromConfig(config);

    const registry = new ProviderRegistry(
      credentialManager,
      config.defaultModel,
      config.fallback,
      config.routing
    );

    // 1. 遍历 providers 配置，注册每个提供商及其模型
    for (const [providerName, providerConfig] of Object.entries(config.providers)) {
      registry.ensureProvider(providerName);

      const hasExplicitModels =
        providerConfig.models !== undefined && Object.keys(providerConfig.models).length > 0;

      if (hasExplicitModels) {
        // 用户显式配置了模型 → 使用用户配置
        for (const [modelName, modelConfig] of Object.entries(providerConfig.models!)) {
          registry.addModelFromConfig(providerName, modelName, modelConfig, providerConfig.baseUrl);
        }
      } else {
        // 无显式模型 → 从 pi-ai 内置注册表自动填充
        registry.populateFromPiAi(providerName, providerConfig.baseUrl);
      }
    }

    // 2. 确保 defaultModel 已注册（用户可能只配了 apiKey 没配模型）
    registry.ensureDefaultModel(config);

    // 3. 为未注册但有凭据的提供商创建空条目
    for (const providerName of credentialManager.getProviderNames()) {
      registry.ensureProvider(providerName);
    }

    logger.debug(
      `ProviderRegistry 初始化完成: ${registry.getStats().modelCount} 个模型, ${registry.getStats().providerCount} 个提供商`
    );
    return registry;
  }

  // ============ 注册辅助方法 ============

  /** 确保提供商条目存在 */
  private ensureProvider(providerName: string): void {
    if (!this.providers.has(providerName)) {
      this.providers.set(providerName, {
        name: providerName,
        displayName: providerName,
        models: [],
        enabled: true,
      });
    }
  }

  /** 从用户配置注册单个模型 */
  private addModelFromConfig(
    providerName: string,
    modelName: string,
    modelConfig: import('@/config/types').ModelConfig,
    providerBaseUrl?: string
  ): void {
    const modelKey = `${providerName}/${modelName}`;
    const modelInfo: ModelInfo = {
      id: modelConfig.id ?? modelName,
      provider: providerName,
      key: modelKey,
    };

    if (modelConfig.description !== undefined) {
      modelInfo.description = modelConfig.description;
    }
    if (modelConfig.input !== undefined) {
      modelInfo.input = modelConfig.input;
    }
    // baseUrl 优先级：模型级别 > provider 级别
    if (modelConfig.baseUrl !== undefined) {
      modelInfo.baseUrl = modelConfig.baseUrl;
    } else if (providerBaseUrl !== undefined) {
      modelInfo.baseUrl = providerBaseUrl;
    }

    this.models.set(modelKey, modelInfo);
    this.providers.get(providerName)?.models.push(modelInfo);
  }

  /** 从 pi-ai 内置注册表自动填充模型 */
  private populateFromPiAi(providerName: string, providerBaseUrl?: string): void {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束
      const piModels = getModels(providerName as any);
      for (const piModel of piModels) {
        const modelKey = `${providerName}/${piModel.id}`;
        if (this.models.has(modelKey)) continue;

        const modelInfo: ModelInfo = {
          id: piModel.id,
          provider: providerName,
          key: modelKey,
          input: [...piModel.input],
        };

        // 用户 provider 级别的 baseUrl 覆盖 pi-ai 内置值
        if (providerBaseUrl) {
          modelInfo.baseUrl = providerBaseUrl;
        }

        this.models.set(modelKey, modelInfo);
        this.providers.get(providerName)?.models.push(modelInfo);
      }
      logger.debug(`从 pi-ai 自动填充 ${piModels.length} 个模型 [${providerName}]`);
    } catch {
      logger.debug(`pi-ai 中没有提供商 [${providerName}] 的模型数据`);
    }
  }

  /** 确保 defaultModel 在注册表中 */
  private ensureDefaultModel(config: LlmConfig): void {
    if (this.models.has(config.defaultModel)) return;

    const parsed = parseModelKey(config.defaultModel);
    if (!parsed) return;

    this.ensureProvider(parsed.provider);
    const providerConfig = config.providers[parsed.provider];

    // 尝试从 pi-ai 获取
    try {
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束
      const piModel = getModel(parsed.provider as any, parsed.modelId as any);
      if (piModel) {
        const modelInfo: ModelInfo = {
          id: piModel.id,
          provider: parsed.provider,
          key: config.defaultModel,
          input: [...piModel.input],
        };
        if (providerConfig?.baseUrl) {
          modelInfo.baseUrl = providerConfig.baseUrl;
        }
        this.models.set(config.defaultModel, modelInfo);
        this.providers.get(parsed.provider)?.models.push(modelInfo);
        return;
      }
    } catch {
      // pi-ai 中没有，使用手动兜底
    }

    // 兜底：手动注册最小模型信息
    const modelInfo: ModelInfo = {
      id: parsed.modelId,
      provider: parsed.provider,
      key: config.defaultModel,
    };
    if (providerConfig?.baseUrl) {
      modelInfo.baseUrl = providerConfig.baseUrl;
    }
    this.models.set(config.defaultModel, modelInfo);
    this.providers.get(parsed.provider)?.models.push(modelInfo);
  }

  // ============ 模型解析 ============

  /** 解析模型 key，返回 ModelInfo */
  resolveModel(modelKey: string): ModelInfo | undefined {
    return this.models.get(modelKey);
  }

  /** 获取默认模型 */
  getDefaultModel(): ModelInfo {
    const model = this.models.get(this.defaultModelKey);
    if (!model) {
      throw new Error(`默认模型 ${this.defaultModelKey} 未在配置中注册`);
    }
    return model;
  }

  // ============ pi-ai Model 对象 ============

  /**
   * 懒加载创建 pi-ai Model 对象
   *
   * 与 PiAiProvider.resolveModel() 逻辑相同，但通过 ProviderRegistry 管理。
   * 复用 parseModelKey + getModel + 属性覆盖的解析策略。
   */
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束需要运行时动态类型
  resolvePiModel(modelKey?: string): Model<any> {
    const key = modelKey ?? this.defaultModelKey;
    const modelInfo = this.models.get(key);
    const parsed = parseModelKey(key);

    if (!parsed) {
      throw new Error(`无效的模型标识符格式: ${key}，期望格式为 provider/modelId`);
    }

    const provider = (modelInfo?.provider ?? parsed.provider) as KnownProvider;
    const modelId = modelInfo?.id ?? parsed.modelId;

    // 始终用同 provider 的已知模型作为基础模板
    const baseModelId = provider === 'anthropic' ? 'claude-sonnet-4-20250514' : modelId;

    // biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束需要运行时动态类型
    let model: any;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束需要运行时动态类型
      model = getModel(provider as any, baseModelId as any);
    } catch {
      logger.warn(`无法获取 ${provider}/${baseModelId}，回退到默认基础模型`);
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束需要运行时动态类型
      model = getModel('anthropic' as any, 'claude-sonnet-4-20250514' as any);
    }

    if (!model) {
      throw new Error(`无法初始化模型 ${key}：pi-ai 返回了无效的模型对象`);
    }

    // 覆盖自定义属性
    model.name = key;
    model.id = modelId;

    if (modelInfo?.baseUrl) {
      model.baseUrl = modelInfo.baseUrl;
    }

    return model;
  }

  // ============ 故障转移链 ============

  /**
   * 获取故障转移链
   *
   * 如果配置了 fallback.chain，使用配置的链。
   * 否则自动构建：同提供商其他模型 → 其他提供商模型
   */
  getFallbackChain(modelKey: string): ModelInfo[] {
    // 优先使用配置的 fallback chain
    if (this.fallbackConfig?.enabled && this.fallbackConfig.chain?.length) {
      return this.fallbackConfig.chain
        .filter((k) => k !== modelKey)
        .map((k) => this.models.get(k))
        .filter((m): m is ModelInfo => m !== undefined);
    }

    // 自动构建：先同提供商，再跨提供商
    const source = this.models.get(modelKey);
    if (!source) return [];

    const chain: ModelInfo[] = [];

    // 同提供商其他模型
    for (const m of this.models.values()) {
      if (m.provider === source.provider && m.key !== modelKey) {
        chain.push(m);
      }
    }

    // 其他提供商模型
    for (const m of this.models.values()) {
      if (m.provider !== source.provider) {
        chain.push(m);
      }
    }

    return chain;
  }

  // ============ 查询 ============

  /** 获取指定提供商的 ModelInfo 列表 */
  getProviderModels(provider: string): ModelInfo[] {
    return this.providers.get(provider)?.models ?? [];
  }

  /** 获取所有提供商 */
  getProviders(): ProviderInfo[] {
    return Array.from(this.providers.values());
  }

  /** 获取所有模型 */
  getAllModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  /** 按能力筛选模型 */
  findModels(capabilities: ModelCapability[]): ModelInfo[] {
    return Array.from(this.models.values()).filter(
      (m) => m.capabilities && capabilities.every((c) => m.capabilities?.includes(c))
    );
  }

  /** 获取路由配置 */
  getRoutingConfig(): LlmRoutingConfig | undefined {
    return this.routingConfig;
  }

  /** 获取统计 */
  getStats(): RegistryStats {
    return {
      providerCount: this.providers.size,
      modelCount: this.models.size,
      providers: Array.from(this.providers.keys()),
    };
  }
}
