/**
 * Anthropic Messages API 统一调用层
 *
 * 封装 @anthropic-ai/sdk 的 messages API，提供多 baseURL 支持。
 * 可用于 Anthropic、DeepSeek、GLM、Kimi、MiniMax 等兼容 Anthropic Messages API 格式的提供商。
 *
 * @module llm/anthropic-provider
 */

import type Anthropic from '@anthropic-ai/sdk';
import { getClient } from '@/llm/client-manager';
import type { ResolvedModel } from '@/llm/provider-types';

/** 非流式补全调用参数 */
export interface CompleteParams {
  /**
   * 系统提示词
   *
   * 支持两种格式：
   * - `string`: 传统纯文本格式，provider 内部包装为可缓存 block
   * - `Anthropic.TextBlockParam[]`: 预拆分的多 block 格式，每个 block 可独立设置 cache_control
   */
  systemPrompt?: string | Anthropic.TextBlockParam[];
  /** 消息列表（Anthropic SDK 原生格式） */
  messages: Anthropic.MessageParam[];
  /** 工具定义列表 */
  tools?: Anthropic.Tool[];
  /** 缓存保留期（none = 不启用 prompt caching） */
  cacheRetention?: 'none' | 'short' | 'long';
}

/** 补全调用选项 */
export interface CompleteOptions {
  /** 最大生成 token 数 */
  maxTokens?: number;
  /** 温度参数（0-1） */
  temperature?: number;
  /** 取消信号 */
  signal?: AbortSignal;
}

/**
 * 非流式补全
 *
 * 包装 client.messages.create()，返回完整的 Message 响应。
 *
 * @param model  - 已解析的模型信息
 * @param params - 调用参数（systemPrompt + messages）
 * @param options - 可选参数（maxTokens, temperature, signal）
 * @returns Anthropic Message 响应
 */
export async function complete(
  model: ResolvedModel,
  params: CompleteParams,
  options?: CompleteOptions
): Promise<Anthropic.Message> {
  const client = getClient(model.baseURL, model.apiKey, model.provider, model.betaHeaders);

  const enableCache = params.cacheRetention !== undefined && params.cacheRetention !== 'none';

  return client.messages.create(
    {
      model: model.id,
      max_tokens: options?.maxTokens ?? 4096,
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(params.systemPrompt && {
        system: buildSystemParam(params.systemPrompt, enableCache, params.cacheRetention),
      }),
      ...(params.tools && params.tools.length > 0 && { tools: params.tools }),
      messages: enableCache ? addCacheControlToLastUserMessage(params.messages) : params.messages,
    },
    {
      signal: options?.signal,
    }
  );
}

/**
 * 流式补全
 *
 * 包装 client.messages.stream()，返回 Anthropic SDK 原生事件流。
 *
 * @param model  - 已解析的模型信息
 * @param params - 调用参数（systemPrompt + messages）
 * @param options - 可选参数（maxTokens, temperature, signal）
 * @returns Anthropic SDK 原生事件流（AsyncIterable<RawMessageStreamEvent>）
 */
export function streamComplete(
  model: ResolvedModel,
  params: CompleteParams,
  options?: CompleteOptions
): AsyncIterable<Anthropic.RawMessageStreamEvent> {
  const client = getClient(model.baseURL, model.apiKey, model.provider, model.betaHeaders);

  const enableCache = params.cacheRetention !== undefined && params.cacheRetention !== 'none';

  const stream = client.messages.stream(
    {
      model: model.id,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(params.systemPrompt && {
        system: buildSystemParam(params.systemPrompt, enableCache, params.cacheRetention),
      }),
      ...(params.tools && params.tools.length > 0 && { tools: params.tools }),
      messages: enableCache ? addCacheControlToLastUserMessage(params.messages) : params.messages,
    },
    {
      signal: options?.signal,
    }
  );

  return stream;
}

/**
 * 将 cacheRetention 配置映射为 cache_control TTL
 *
 * - 'short': 默认 5 分钟，不显式设置（SDK 默认行为）
 * - 'long': 1 小时
 */
function resolveCacheTtl(cacheRetention?: 'none' | 'short' | 'long'): '5m' | '1h' | undefined {
  if (cacheRetention === 'long') return '1h';
  return undefined;
}

/**
 * 构建 Anthropic SDK system 参数
 *
 * 支持两种输入：
 * - `string`: 旧格式，内部包装为 TextBlockParam 数组（启用缓存时添加 cache_control）
 * - `TextBlockParam[]`: 预拆分多 block 格式，透传给 SDK
 *
 * 启用缓存时，根据 cacheRetention 设置 TTL。
 * 禁用缓存时，移除所有 cache_control。
 */
function buildSystemParam(
  systemPrompt: string | Anthropic.TextBlockParam[],
  enableCache: boolean,
  cacheRetention?: 'none' | 'short' | 'long'
): string | Anthropic.TextBlockParam[] {
  if (typeof systemPrompt === 'string') {
    // 旧格式：包装为单 block
    if (enableCache) {
      const ttl = resolveCacheTtl(cacheRetention);
      return [
        {
          type: 'text' as const,
          text: systemPrompt,
          cache_control: {
            type: 'ephemeral' as const,
            ...(ttl ? { ttl } : {}),
          },
        },
      ];
    }
    return systemPrompt;
  }

  // 预拆分多 block 格式 —— 只更新 TTL
  if (enableCache) {
    const ttl = resolveCacheTtl(cacheRetention);
    return systemPrompt.map((block) => {
      if (block.type === 'text' && block.cache_control) {
        return {
          ...block,
          cache_control: { ...block.cache_control, ...(ttl ? { ttl } : {}) },
        };
      }
      return block;
    });
  }

  // 禁用缓存时移除 cache_control
  return systemPrompt.map((block) => {
    if (block.type === 'text' && block.cache_control) {
      const { cache_control: _, ...rest } = block;
      return rest as Anthropic.TextBlockParam;
    }
    return block;
  });
}

/**
 * 在最后一条 user 消息的 text content 上添加 cache_control，启用 prompt caching。
 *
 * Anthropic 要求：
 * - system prompt 必须以 content block 数组形式传递，其中最后一个 block 含 cache_control
 * - 最后一条 user 消息的 text content 需要添加 cache_control 作为缓存断点
 *
 * @param messages - Anthropic SDK 格式的消息列表
 * @returns 添加了 cache_control 的消息列表
 */
function addCacheControlToLastUserMessage(
  messages: Anthropic.MessageParam[]
): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;

  const result: Anthropic.MessageParam[] = [...messages];

  // 从后往前找最后一条 user 消息
  for (let i = result.length - 1; i >= 0; i--) {
    const msg: Anthropic.MessageParam | undefined = result[i];
    if (!msg || msg.role !== 'user') continue;

    const content = msg.content;
    if (typeof content === 'string') {
      result[i] = {
        role: 'user',
        content: [
          { type: 'text' as const, text: content, cache_control: { type: 'ephemeral' as const } },
        ],
      };
    } else if (Array.isArray(content) && content.length > 0) {
      const blocks = [...content];
      // 在第一个 text block 上添加 cache_control
      const firstTextIdx = blocks.findIndex((b) => b.type === 'text');
      if (firstTextIdx >= 0) {
        blocks[firstTextIdx] = {
          ...blocks[firstTextIdx],
          cache_control: { type: 'ephemeral' },
        } as Anthropic.TextBlockParam & { cache_control: { type: 'ephemeral' } };
      }
      result[i] = { role: 'user', content: blocks };
    }
    break;
  }

  return result;
}
