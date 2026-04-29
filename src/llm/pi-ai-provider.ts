/**
 * PiAiProvider — 基于 @mariozechner/pi-ai 的 LLM 提供商适配器
 *
 * 将 pi-ai 的统一 LLM API 适配为 zapmyco 的 ILlmProvider 接口。
 * 支持多提供商、流式响应、工具调用和成本追踪。
 */

import type { KnownProvider } from '@mariozechner/pi-ai';
import {
  type AssistantMessage,
  type Context,
  complete,
  getModel,
  type Message,
  stream,
} from '@mariozechner/pi-ai';
import type { LlmConfig, ModelConfig } from '@/config/types';
import { logger } from '@/infra/logger';
import { costTracker } from '@/llm/cost-tracker';
import type { ILlmProvider } from '@/llm/provider';
import type { ChatMessage, LlmCallOptions, LlmResponse } from '@/llm/types';

/**
 * 解析模型标识符
 *
 * 支持格式：provider/modelId（如 anthropic/claude-sonnet-4-20250514）
 * 导出供其他模块复用（如 REPL Session 为 Agent 解析 Model 对象）
 */
export function parseModelKey(key: string): { provider: string; modelId: string } | null {
  const slashIndex = key.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= key.length - 1) {
    return null;
  }
  return {
    provider: key.slice(0, slashIndex),
    modelId: key.slice(slashIndex + 1),
  };
}

/**
 * 将 zapmyco 的 ChatMessage 转换为 pi-ai 的 Message 数组
 */
function toPiAiMessages(messages: ChatMessage[]): Message[] {
  const result: Message[] = [];

  for (const msg of messages) {
    // system 消息在 buildContext 中作为 systemPrompt 处理
    if (msg.role === 'system') {
      continue;
    }

    if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: msg.content,
        timestamp: Date.now(),
      });
    } else if (msg.role === 'assistant') {
      result.push({
        role: 'assistant',
        content: [{ type: 'text', text: msg.content }],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: '',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      } satisfies AssistantMessage);
    }
  }

  return result;
}

/**
 * 从消息列表中提取 system prompt
 */
function extractSystemPrompt(messages: ChatMessage[]): string | undefined {
  return messages.find((m) => m.role === 'system')?.content;
}

/**
 * 构建 pi-ai 的 Context 对象
 */
function buildContext(messages: ChatMessage[]): Context {
  const systemPrompt = extractSystemPrompt(messages);
  const piMessages = toPiAiMessages(messages);

  if (systemPrompt) {
    return { systemPrompt, messages: piMessages };
  }
  return { messages: piMessages };
}

/**
 * 构建 pi-ai 的 StreamOptions（过滤掉 undefined 值）
 */
function buildStreamOptions(
  options?: LlmCallOptions,
  defaults?: { maxTokens?: number; temperature?: number },
  extra?: { apiKey?: string }
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const temperature = options?.temperature ?? defaults?.temperature;
  if (temperature !== undefined) {
    result.temperature = temperature;
  }

  const maxTokens = options?.maxTokens ?? defaults?.maxTokens;
  if (maxTokens !== undefined) {
    result.maxTokens = maxTokens;
  }

  if (options?.timeoutMs !== undefined) {
    result.timeoutMs = options.timeoutMs;
  }

  if (options?.signal !== undefined) {
    result.signal = options.signal;
  }

  // 自定义 API Key（用于非环境变量方式配置的提供商，如 Deepseek）
  if (extra?.apiKey) {
    result.apiKey = extra.apiKey;
  }

  if (options?.timeoutMs !== undefined) {
    result.timeoutMs = options.timeoutMs;
  }

  return result;
}

/**
 * PiAiProvider — ILlmProvider 的 pi-ai 实现
 *
 * 使用方式：
 * ```typescript
 * import { PiAiProvider } from '@/llm/pi-ai-provider';
 * import type { LlmConfig } from '@/config/types';
 *
 * const provider = new PiAiProvider(config.llm);
 * const response = await provider.chat([{ role: 'user', content: 'Hello' }]);
 * ```
 */
export class PiAiProvider implements ILlmProvider {
  readonly providerId = 'pi-ai';

  private config: LlmConfig;
  private resolvedModel: ReturnType<typeof getModel> | null = null;

  constructor(config: LlmConfig) {
    this.config = config;
  }

  /** 获取或懒解析 pi-ai Model 实例 */
  private resolveModel(overrideModel?: string) {
    const modelKey = overrideModel ?? this.config.defaultModel;

    // 如果已缓存且 key 相同，直接返回
    if (this.resolvedModel && this.resolvedModel.id === modelKey) {
      return this.resolvedModel;
    }

    const parsed = parseModelKey(modelKey);
    if (!parsed) {
      throw new Error(`无效的模型标识符格式: ${modelKey}，期望格式为 provider/modelId`);
    }

    // 优先从 models 配置中获取详细信息
    const modelConfig = this.config.models[modelKey] as ModelConfig | undefined;

    const provider = (modelConfig?.provider ?? parsed.provider) as KnownProvider;
    const modelId = modelConfig?.modelId ?? parsed.modelId;

    // 始终用同 provider 的已知模型作为基础模板（保证返回有效 Model 对象）
    const baseModelId = provider === 'anthropic' ? 'claude-sonnet-4-20250514' : modelId; // 非 anthropic provider 尝试直接获取

    logger.debug('解析模型', { provider, modelId, baseModelId, modelKey });

    try {
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束需要运行时动态类型
      this.resolvedModel = getModel(provider as any, baseModelId as any);
    } catch {
      // 最终兜底：使用 anthropic 的已知模型作为基础
      logger.warn(`无法获取 ${provider}/${baseModelId}，回退到默认基础模型`);
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束需要运行时动态类型
      this.resolvedModel = getModel('anthropic' as any, 'claude-sonnet-4-20250514' as any);
    }

    // 防御性检查：确保拿到有效对象
    if (!this.resolvedModel) {
      throw new Error(`无法初始化模型 ${modelKey}：pi-ai 返回了无效的模型对象`);
    }

    // 无条件覆盖自定义属性
    // name 用于显示，id 是发送给 API 的模型名（必须是 API 实际接受的值）
    this.resolvedModel.name = modelKey;
    this.resolvedModel.id = modelId;

    if (modelConfig?.baseUrl) {
      logger.debug('覆盖模型 baseUrl', {
        original: this.resolvedModel.baseUrl,
        custom: modelConfig.baseUrl,
      });
      this.resolvedModel.baseUrl = modelConfig.baseUrl;
    }

    return this.resolvedModel;
  }

  /**
   * 获取当前模型的认证信息（API Key）
   */
  private getApiKey(modelKey: string): string | undefined {
    const modelConfig = this.config.models[modelKey] as ModelConfig | undefined;
    const providerName = modelConfig?.provider;

    // 优先从对应提供商的 auth 配置中获取
    if (providerName) {
      const auth = this.config.providers[providerName];
      if (auth?.apiKey) {
        return auth.apiKey;
      }
    }

    return undefined;
  }

  /**
   * 发送聊天请求（非流式）
   */
  async chat(messages: ChatMessage[], options?: LlmCallOptions): Promise<LlmResponse> {
    const model = this.resolveModel(options?.model);
    const context = buildContext(messages);

    const modelKey = options?.model ?? this.config.defaultModel;
    const apiKey = this.getApiKey(modelKey);
    const streamOptions = buildStreamOptions(
      options,
      this.config.defaults,
      apiKey !== undefined ? { apiKey } : undefined
    );

    logger.debug('发送 LLM 请求', {
      model: model.name,
      messageCount: context.messages.length,
    });

    const startTime = Date.now();
    const response = await complete(model, context, streamOptions);
    const elapsedMs = Date.now() - startTime;

    // 提取文本内容
    const content = this.extractTextContent(response.content);

    // 记录成本
    costTracker.record(
      {
        inputTokens: response.usage.input,
        outputTokens: response.usage.output,
        totalTokens: response.usage.totalTokens,
      },
      model.name
    );

    logger.debug('LLM 响应完成', {
      model: model.name,
      inputTokens: response.usage.input,
      outputTokens: response.usage.output,
      elapsedMs,
    });

    const result: LlmResponse = {
      content,
      inputTokens: response.usage.input,
      outputTokens: response.usage.output,
      model: model.name,
      truncated: response.stopReason === 'length',
    };

    if (response.responseId !== undefined) {
      result.id = response.responseId;
    }

    return result;
  }

  /**
   * 流式聊天请求
   */
  async *chatStream(
    messages: ChatMessage[],
    options?: LlmCallOptions
  ): AsyncGenerator<string, void, unknown> {
    const model = this.resolveModel(options?.model);
    const context = buildContext(messages);

    const modelKey = options?.model ?? this.config.defaultModel;
    const apiKey = this.getApiKey(modelKey);
    const streamOptions = buildStreamOptions(
      options,
      this.config.defaults,
      apiKey !== undefined ? { apiKey } : undefined
    );

    logger.debug('发送流式 LLM 请求', {
      model: model.name,
      messageCount: context.messages.length,
    });

    const startTime = Date.now();
    const eventStream = stream(model, context, streamOptions);

    let finalUsage = { input: 0, output: 0, totalTokens: 0, costTotal: 0 };

    for await (const event of eventStream) {
      switch (event.type) {
        case 'text_delta':
          yield event.delta;
          break;

        case 'done':
          finalUsage = {
            input: event.message.usage.input,
            output: event.message.usage.output,
            totalTokens: event.message.usage.totalTokens,
            costTotal: event.message.usage.cost.total,
          };
          break;

        case 'error':
          logger.error('流式 LLM 请求出错', {
            model: model.name,
            reason: event.reason,
            error: event.error.errorMessage,
          });
          throw new Error(`LLM 流式请求失败: ${event.error.errorMessage ?? event.reason}`);
      }
    }

    const elapsedMs = Date.now() - startTime;

    // 记录成本
    costTracker.record(
      {
        inputTokens: finalUsage.input,
        outputTokens: finalUsage.output,
        totalTokens: finalUsage.totalTokens,
      },
      model.name
    );

    logger.debug('流式 LLM 响应完成', {
      model: model.name,
      inputTokens: finalUsage.input,
      outputTokens: finalUsage.output,
      elapsedMs,
    });
  }

  /**
   * 从 pi-ai 的 content 数组中提取纯文本
   */
  private extractTextContent(content: AssistantMessage['content']): string {
    return content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
}
