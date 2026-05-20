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
  /** 系统提示词 */
  systemPrompt?: string;
  /** 消息列表（Anthropic SDK 原生格式） */
  messages: Anthropic.MessageParam[];
  /** 工具定义列表 */
  tools?: Anthropic.Tool[];
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
  const client = getClient(model.baseURL, model.apiKey, model.provider);

  return client.messages.create(
    {
      model: model.id,
      max_tokens: options?.maxTokens ?? 4096,
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(params.systemPrompt && { system: params.systemPrompt }),
      ...(params.tools && params.tools.length > 0 && { tools: params.tools }),
      messages: params.messages,
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
  const client = getClient(model.baseURL, model.apiKey, model.provider);

  const stream = client.messages.stream(
    {
      model: model.id,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(params.systemPrompt && { system: params.systemPrompt }),
      ...(params.tools && params.tools.length > 0 && { tools: params.tools }),
      messages: params.messages,
    },
    {
      signal: options?.signal,
    }
  );

  return stream;
}
