/**
 * LLM Provider 接口
 *
 * 所有 LLM 提供商实现必须遵循此接口。
 * MVP 阶段使用 Anthropic Claude，后续可扩展 OpenAI 等。
 */

import type { ChatMessage, LlmCallOptions, LlmResponse } from '@/llm/types';

/**
 * LLM 提供商接口
 *
 * 实现此接口以支持不同的 LLM 后端：
 * - AnthropicProvider (Claude API)
 * - OpenAIProvider (GPT API)
 * - CustomProvider (兼容 OpenAI API 的服务)
 */
export interface ILlmProvider {
  /** 提供商标识 */
  readonly providerId: string;

  /**
   * 发送聊天请求
   * @param messages - 消息列表
   * @param options - 调用选项
   * @returns LLM 响应
   */
  chat(messages: ChatMessage[], options?: LlmCallOptions): Promise<LlmResponse>;

  /**
   * 流式聊天请求
   * @param messages - 消息列表
   * @param options - 调用选项
   * @returns 异步文本块迭代器
   */
  chatStream(
    messages: ChatMessage[],
    options?: LlmCallOptions
  ): AsyncGenerator<string, void, unknown>;
}
