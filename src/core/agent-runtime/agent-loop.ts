/**
 * Agent 核心循环
 *
 * 替代 @mariozechner/pi-agent-core 的 agent-loop 实现。
 * 职责：LLM 流式调用 → 解析响应 → 提取工具调用 → 执行工具 → 回填结果 → 循环
 *
 * @module core/agent-runtime/agent-loop
 */

import type Anthropic from '@anthropic-ai/sdk';
import { logger } from '@/infra/logger';
import { streamComplete } from '@/llm/anthropic-provider';
import type { ResolvedModel } from '@/llm/provider-types';
import { validateToolCallArguments } from '@/llm/tool-validator';
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  StreamFn,
} from './agent-types';
import type { AssistantMessage, ToolResultMessage } from './runtime-types';

const log = logger.child('agent-loop');

// ============ 工具 Schema 转换 ============

/**
 * 将 AgentTool 列表转换为 Anthropic.Tool 列表
 */
export function toAnthropicTools(tools: AgentTool[]): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    }))
    .filter((t) => Boolean(t.name));
}

// ============ 事件接收器类型 ============

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

// ============ 公共 API ============

/**
 * 启动 Agent 循环（带新 prompt 消息）
 *
 * @param prompts - 初始 prompt 消息列表
 * @param context - Agent 上下文快照
 * @param config - 循环配置
 * @param emit - 事件发射器
 * @param signal - 可选的取消信号
 * @param streamFn - 流函数（默认 streamComplete）
 * @returns 本轮新增的消息列表
 */
export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn
): Promise<AgentMessage[]> {
  const newMessages: AgentMessage[] = [...prompts];
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  await emit({ type: 'agent_start' });
  await emit({ type: 'turn_start' });

  for (const prompt of prompts) {
    await emit({ type: 'message_start', message: prompt });
    await emit({ type: 'message_end', message: prompt });
  }

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}

/**
 * 从当前上下文继续 Agent 循环（不加新消息）
 *
 * @param context - Agent 上下文快照
 * @param config - 循环配置
 * @param emit - 事件发射器
 * @param signal - 可选的取消信号
 * @param streamFn - 流函数（默认 streamComplete）
 * @returns 本轮新增的消息列表
 */
export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn
): Promise<AgentMessage[]> {
  if (context.messages.length === 0) {
    throw new Error('无法继续：上下文中没有消息');
  }

  const lastMessage = context.messages[context.messages.length - 1];
  const lastRole = lastMessage?.role;
  if (!lastRole || lastRole === 'assistant') {
    throw new Error('无法从 assistant 角色消息继续');
  }

  const newMessages: AgentMessage[] = [];
  const currentContext: AgentContext = { ...context };

  await emit({ type: 'agent_start' });
  await emit({ type: 'turn_start' });

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}

// ============ 核心循环逻辑 ============

/**
 * 主循环逻辑（runAgentLoop 和 runAgentLoopContinue 共享）
 */
async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn
): Promise<void> {
  let firstTurn = true;
  let turnCount = 0;
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

  const loopStartTime = Date.now();
  log.info('Agent 循环开始', {
    initialContextSize: currentContext.messages.length,
    initialSteeringCount: pendingMessages.length,
    model: config.model?.id ?? config.model,
  });

  // 外层循环：处理 follow-up 消息
  while (true) {
    let hasMoreToolCalls = true;

    // 内层循环：处理工具调用和 steering 消息
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      turnCount++;
      const turnStartTime = Date.now();

      if (!firstTurn) {
        await emit({ type: 'turn_start' });
      } else {
        firstTurn = false;
      }

      log.debug('内层循环迭代开始', {
        turnCount,
        pendingMessagesCount: pendingMessages.length,
        hasMoreToolCalls,
        contextSize: currentContext.messages.length,
      });

      // 处理 pending 消息（在下次 assistant 回复前注入）
      if (pendingMessages.length > 0) {
        const injectionTypes = pendingMessages.map((m) => m.role).join(',');
        log.debug('注入 pending 消息', {
          turnCount,
          count: pendingMessages.length,
          types: injectionTypes,
        });
        for (const message of pendingMessages) {
          await emit({ type: 'message_start', message });
          await emit({ type: 'message_end', message });
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      // 流式获取 assistant 回复
      const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
      const llmDuration = Date.now() - turnStartTime;
      newMessages.push(message);

      // 处理错误或中止
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        log.warn('Agent 循环因错误或中止退出', {
          turnCount,
          stopReason: message.stopReason,
          errorMessage: (message as unknown as Record<string, unknown>).errorMessage,
          duration: Date.now() - loopStartTime,
        });
        await emit({ type: 'turn_end', message, toolResults: [] });
        await emit({ type: 'agent_end', messages: newMessages });
        return;
      }

      // 检查是否有工具调用
      const toolCalls = message.content.filter((c): c is AgentToolCall => c.type === 'toolCall');

      const toolResults: ToolResultMessage[] = [];
      hasMoreToolCalls = false;

      if (toolCalls.length > 0) {
        log.info('LLM 返回工具调用', {
          turnCount,
          toolCallCount: toolCalls.length,
          toolNames: toolCalls.map((tc) => tc.name),
          llmDuration,
        });

        const executedBatch = await executeToolCalls(currentContext, message, config, signal, emit);
        const execDuration = Date.now() - turnStartTime - llmDuration;
        toolResults.push(...executedBatch.messages);
        hasMoreToolCalls = !executedBatch.terminate;

        log.info('工具调用执行完成', {
          turnCount,
          toolResultCount: toolResults.length,
          terminate: executedBatch.terminate,
          execDuration,
          totalDuration: Date.now() - turnStartTime,
        });

        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      } else {
        log.debug('LLM 回复无需工具调用', {
          turnCount,
          stopReason: message.stopReason,
          llmDuration,
          totalDuration: Date.now() - turnStartTime,
        });
      }

      await emit({ type: 'turn_end', message, toolResults });

      // 检查是否应该停止
      if (
        config.shouldStopAfterTurn &&
        (await config.shouldStopAfterTurn({
          message,
          toolResults,
          context: currentContext,
          newMessages,
        }))
      ) {
        log.info('Agent 循环因 shouldStopAfterTurn 停止', {
          turnCount,
          duration: Date.now() - loopStartTime,
        });
        await emit({ type: 'agent_end', messages: newMessages });
        return;
      }

      // 获取 steering 消息
      pendingMessages = (await config.getSteeringMessages?.()) || [];
    }

    // Agent 在此处自然停止。检查是否有 follow-up 消息
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      log.info('Agent 继续处理 follow-up 消息', {
        followUpCount: followUpMessages.length,
        followUpRoles: followUpMessages.map((m) => m.role).join(','),
      });
      pendingMessages = followUpMessages;
      continue;
    }

    // 没有更多消息，退出
    break;
  }

  log.info('Agent 循环正常结束', {
    totalTurns: turnCount,
    newMessagesCount: newMessages.length,
    duration: Date.now() - loopStartTime,
  });
  await emit({ type: 'agent_end', messages: newMessages });
}

// ============ LLM 流式调用 ============

/**
 * 从 LLM 流式获取 assistant 回复
 *
 * 使用 Anthropic SDK 原生事件格式处理流式响应。
 */
async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn
): Promise<AssistantMessage> {
  const startTime = Date.now();
  log.debug('开始 LLM 流式调用', {
    model: config.model?.id ?? config.model,
    contextSize: context.messages.length,
  });

  // 1. 应用上下文转换（AgentMessage[] → AgentMessage[]）
  let messages = context.messages;
  if (config.transformContext) {
    const t0 = Date.now();
    messages = await config.transformContext(messages, signal);
    log.debug('上下文转换完成', {
      duration: Date.now() - t0,
      originalSize: context.messages.length,
      trimmedSize: messages.length,
    });
  }

  // 2. 转换为 LLM 兼容消息（AgentMessage[] → Anthropic.MessageParam[]）
  if (!config.convertToLlm) {
    throw new Error('convertToLlm 未设置');
  }
  const t1 = Date.now();
  const llmMessages = await config.convertToLlm(messages);
  log.debug('消息格式转换完成', { duration: Date.now() - t1, llmMessageCount: llmMessages.length });

  // 3. 转换工具定义为 Anthropic SDK 格式（带缓存，确保字节级一致性）
  const anthropicTools = toAnthropicTools(context.tools ?? []);

  // 4. 解析 API Key 并构建 ResolvedModel
  const resolvedApiKey =
    (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;
  const model: ResolvedModel = {
    ...config.model,
    ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
  };

  // 5. 调用流函数（fallback 到 streamComplete）
  const streamFunction: StreamFn = streamFn ?? (streamComplete as unknown as StreamFn);
  const stream = await streamFunction(
    model,
    {
      systemPrompt: context.systemPrompt,
      messages: llmMessages,
      ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
    },
    {
      ...(signal ? { signal } : {}),
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      timeoutMs: 120_000,
    }
  );

  // 6. 流式状态
  let addedPartial = false;
  let firstDeltaTime = 0;
  let eventCount = 0;
  const YIELD_INTERVAL = 10;

  // 按 index 累积内容块
  const contentBlocks: Array<{
    type: 'text' | 'tool_use' | 'thinking';
    text?: string;
    id?: string;
    name?: string;
    partialJson?: string;
    signature?: string;
  }> = [];

  let messageModelId = '';
  const messageProvider = config.model.provider || '';
  const messageApi = config.model.provider || '';
  let stopReason: string | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: usage 字段使用字符串索引
  const usage: Record<string, any> = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  // 7. 事件处理循环
  try {
    for await (const event of stream) {
      switch (event.type) {
        case 'message_start': {
          messageModelId = event.message.model;
          if (event.message.usage) {
            const msgUsage = event.message.usage as unknown as Record<string, number | undefined>;
            usage.input = msgUsage.input_tokens ?? 0;
            usage.cacheRead =
              msgUsage.cache_read_input_tokens ?? msgUsage.prompt_cache_hit_tokens ?? 0;
            usage.cacheWrite = msgUsage.cache_creation_input_tokens ?? 0;
          }
          const initialMsg = buildPartialMessage(
            contentBlocks,
            usage,
            stopReason,
            messageModelId,
            messageProvider,
            messageApi
          );
          context.messages.push(initialMsg);
          addedPartial = true;
          await emit({ type: 'message_start', message: initialMsg });
          break;
        }

        case 'content_block_start': {
          const block = event.content_block;
          if (block.type === 'text') {
            contentBlocks[event.index] = { type: 'text', text: block.text ?? '' };
          } else if (block.type === 'tool_use') {
            contentBlocks[event.index] = {
              type: 'tool_use',
              id: block.id,
              name: block.name,
              partialJson: '',
            };
          } else if (block.type === 'thinking') {
            const thinkingBlock = block as unknown as {
              type: 'thinking';
              thinking: string;
              signature?: string;
            };
            contentBlocks[event.index] = {
              type: 'thinking',
              text: thinkingBlock.thinking ?? '',
              ...(thinkingBlock.signature ? { signature: thinkingBlock.signature } : {}),
            };
          }
          if (addedPartial) {
            const partial = buildPartialMessage(
              contentBlocks,
              usage,
              stopReason,
              messageModelId,
              messageProvider,
              messageApi
            );
            context.messages[context.messages.length - 1] = partial;
            await emit({ type: 'message_update', assistantMessageEvent: event, message: partial });
          }
          break;
        }

        case 'content_block_delta': {
          if (!firstDeltaTime) {
            firstDeltaTime = Date.now();
          }
          const block = contentBlocks[event.index];
          if (block) {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              block.text = (block.text ?? '') + delta.text;
            } else if (delta.type === 'input_json_delta') {
              block.partialJson = (block.partialJson ?? '') + delta.partial_json;
            } else if (delta.type === 'thinking_delta') {
              block.text = (block.text ?? '') + delta.thinking;
            }
          }
          if (addedPartial) {
            const partial = buildPartialMessage(
              contentBlocks,
              usage,
              stopReason,
              messageModelId,
              messageProvider,
              messageApi
            );
            context.messages[context.messages.length - 1] = partial;
            await emit({ type: 'message_update', assistantMessageEvent: event, message: partial });
          }
          break;
        }

        case 'content_block_stop': {
          if (addedPartial) {
            const partial = buildPartialMessage(
              contentBlocks,
              usage,
              stopReason,
              messageModelId,
              messageProvider,
              messageApi
            );
            context.messages[context.messages.length - 1] = partial;
          }
          break;
        }

        case 'message_delta': {
          stopReason = event.delta.stop_reason ?? undefined;
          if (event.usage) {
            usage.output = event.usage.output_tokens ?? 0;
          }
          break;
        }

        case 'message_stop': {
          const finalMessage = buildFinalMessage(
            contentBlocks,
            usage,
            stopReason,
            messageModelId,
            messageProvider,
            messageApi
          );
          if (addedPartial) {
            context.messages[context.messages.length - 1] = finalMessage;
          } else {
            context.messages.push(finalMessage);
            await emit({ type: 'message_start', message: finalMessage });
          }
          await emit({ type: 'message_end', message: finalMessage });

          const toolCalls =
            finalMessage.content?.filter((c): c is AgentToolCall => c.type === 'toolCall') ?? [];
          log.info('LLM 流式调用完成', {
            duration: Date.now() - startTime,
            firstDeltaLatency: firstDeltaTime ? firstDeltaTime - startTime : 0,
            stopReason: finalMessage.stopReason,
            toolCallCount: toolCalls.length,
            inputMessageCount: llmMessages.length,
          });
          return finalMessage;
        }
      }

      // 定期让出事件循环
      eventCount++;
      if (eventCount % YIELD_INTERVAL === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  } catch (error) {
    // 流迭代过程中抛出异常，构建错误消息
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn('LLM 流式调用异常', { error: errorMessage });

    const errorAssistantMessage = buildFinalMessage(
      contentBlocks,
      usage,
      'error',
      messageModelId || config.model.id,
      messageProvider,
      messageApi
    );
    (errorAssistantMessage as unknown as Record<string, unknown>).errorMessage = errorMessage;
    if (addedPartial) {
      context.messages[context.messages.length - 1] = errorAssistantMessage;
    } else {
      context.messages.push(errorAssistantMessage);
      await emit({ type: 'message_start', message: errorAssistantMessage });
    }
    await emit({ type: 'message_end', message: errorAssistantMessage });
    return errorAssistantMessage;
  }

  // 8. Fallthrough（流未正常结束——没有收到 message_stop）
  const finalMessage = buildFinalMessage(
    contentBlocks,
    usage,
    stopReason,
    messageModelId || config.model.id,
    messageProvider,
    messageApi
  );
  if (addedPartial) {
    context.messages[context.messages.length - 1] = finalMessage;
  } else {
    context.messages.push(finalMessage);
    await emit({ type: 'message_start', message: finalMessage });
  }
  await emit({ type: 'message_end', message: finalMessage });

  log.info('LLM 流式调用完成（无 message_stop 事件）', {
    duration: Date.now() - startTime,
    stopReason: finalMessage.stopReason,
    inputMessageCount: llmMessages.length,
  });
  return finalMessage;
}

// ============ 流式事件辅助函数 ============

/**
 * 从累积的 contentBlocks 构建部分 AssistantMessage
 */
function buildPartialMessage(
  contentBlocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    partialJson?: string;
    signature?: string;
  }>,
  // biome-ignore lint/suspicious/noExplicitAny: usage 使用字符串索引
  usage: Record<string, any>,
  stopReason: string | undefined,
  model: string,
  provider: string,
  api: string
): AssistantMessage {
  return {
    role: 'assistant',
    content: contentBlocksToAssistantContent(contentBlocks),
    usage: {
      input: usage.input ?? 0,
      output: usage.output ?? 0,
    },
    stopReason,
    model,
    provider,
    api,
    timestamp: Date.now(),
  } as AssistantMessage;
}

/**
 * 从累积的 contentBlocks 构建最终 AssistantMessage
 */
function buildFinalMessage(
  contentBlocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    partialJson?: string;
    signature?: string;
  }>,
  // biome-ignore lint/suspicious/noExplicitAny: usage 使用字符串索引
  usage: Record<string, any>,
  stopReason: string | undefined,
  model: string,
  provider: string,
  api: string
): AssistantMessage {
  return {
    role: 'assistant',
    content: contentBlocksToAssistantContent(contentBlocks),
    usage: {
      input: usage.input ?? 0,
      output: usage.output ?? 0,
    },
    stopReason: mapStopReason(stopReason),
    model: model || api,
    provider,
    api,
    timestamp: Date.now(),
  } as AssistantMessage;
}

/**
 * 将累积的 Anthropic 内容块转为 AssistantMessage 的 content 数组
 */
function contentBlocksToAssistantContent(
  blocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    partialJson?: string;
    signature?: string;
  }>
): AssistantMessage['content'] {
  const content: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text) {
        content.push({ type: 'text', text: block.text });
      }
    } else if (block.type === 'thinking') {
      if (block.text) {
        const thinkingBlock: Record<string, unknown> = {
          type: 'thinking',
          thinking: block.text,
        };
        if (block.signature) {
          thinkingBlock.signature = block.signature;
        }
        content.push(thinkingBlock);
      }
    } else if (block.type === 'tool_use') {
      let args: Record<string, unknown> = {};
      if (block.partialJson) {
        try {
          args = JSON.parse(block.partialJson);
        } catch {
          args = {};
        }
      }
      content.push({
        type: 'toolCall',
        id: block.id ?? '',
        name: block.name ?? '',
        arguments: args,
      });
    }
  }
  // 确保至少有一个 text 块（即使内容为空）
  if (content.length === 0 && blocks.some((b) => b.type === 'text' || b.type === 'thinking')) {
    content.push({ type: 'text', text: '' });
  }
  return content as unknown as AssistantMessage['content'];
}

/**
 * 映射 Anthropic SDK stop_reason 到内部 stopReason
 */
function mapStopReason(reason: string | undefined): string | undefined {
  switch (reason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'tool_use':
      return 'tool_use';
    case null:
    case undefined:
      return undefined;
    default:
      return reason;
  }
}

// ============ 工具调用执行 ============

/** 已执行工具调用批次 */
interface ExecutedToolCallBatch {
  messages: ToolResultMessage[];
  terminate: boolean;
}

/** 已预检的工具调用 */
interface PreparedToolCall {
  kind: 'prepared';
  toolCall: AgentToolCall;
  tool: AgentTool;
  args: unknown;
}

/** 立即完成的工具调用（失败/被阻止） */
interface ImmediateToolCallOutcome {
  kind: 'immediate';
  result: AgentToolResult<unknown>;
  isError: boolean;
}

/** 已执行的工具调用 */
interface ExecutedToolCallOutcome {
  result: AgentToolResult<unknown>;
  isError: boolean;
}

/** 已最终确定的工具调用 */
interface FinalizedToolCallOutcome {
  toolCall: AgentToolCall;
  result: AgentToolResult<unknown>;
  isError: boolean;
}

/** 最终确定的工具调用（并行模式：可能是懒函数） */
type FinalizedToolCallEntry = FinalizedToolCallOutcome | (() => Promise<FinalizedToolCallOutcome>);

/**
 * 执行工具调用（自动选择并行或顺序模式）
 */
async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink
): Promise<ExecutedToolCallBatch> {
  const toolCalls = assistantMessage.content.filter(
    (c): c is AgentToolCall => c.type === 'toolCall'
  );

  // 检查是否有工具指定了顺序执行
  const hasSequentialToolCall = toolCalls.some(
    (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === 'sequential'
  );

  const isParallel = config.toolExecution !== 'sequential' && !hasSequentialToolCall;
  log.debug('选择工具执行模式', {
    mode: isParallel ? 'parallel' : 'sequential',
    toolCount: toolCalls.length,
    toolNames: toolCalls.map((tc) => tc.name),
  });

  if (config.toolExecution === 'sequential' || hasSequentialToolCall) {
    return executeToolCallsSequential(
      currentContext,
      assistantMessage,
      toolCalls,
      config,
      signal,
      emit
    );
  }
  return executeToolCallsParallel(
    currentContext,
    assistantMessage,
    toolCalls,
    config,
    signal,
    emit
  );
}

/**
 * 顺序执行工具调用
 */
async function executeToolCallsSequential(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink
): Promise<ExecutedToolCallBatch> {
  const finalizedCalls: FinalizedToolCallOutcome[] = [];
  const messages: ToolResultMessage[] = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: 'tool_execution_start',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(
      currentContext,
      assistantMessage,
      toolCall,
      config,
      signal
    );

    let finalized: FinalizedToolCallOutcome;
    if (preparation.kind === 'immediate') {
      finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      };
    } else {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal
      );
    }

    await emitToolExecutionEnd(finalized, emit);
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);

    finalizedCalls.push(finalized);
    messages.push(toolResultMessage);
  }

  return {
    messages,
    terminate: shouldTerminateToolBatch(finalizedCalls),
  };
}

/**
 * 并行执行工具调用
 *
 * 策略：预检所有工具（串行），通过的用 Promise.all() 并行执行。
 * tool_execution_end 按完成顺序发出，工具结果消息按 assistant 源顺序发出。
 */
async function executeToolCallsParallel(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink
): Promise<ExecutedToolCallBatch> {
  const finalizedCalls: FinalizedToolCallEntry[] = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: 'tool_execution_start',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(
      currentContext,
      assistantMessage,
      toolCall,
      config,
      signal
    );

    if (preparation.kind === 'immediate') {
      const finalized: FinalizedToolCallOutcome = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      };
      await emitToolExecutionEnd(finalized, emit);
      finalizedCalls.push(finalized);
      continue;
    }

    // 延迟执行：返回函数而非立即执行
    finalizedCalls.push(async () => {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      const finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal
      );
      await emitToolExecutionEnd(finalized, emit);
      return finalized;
    });
  }

  // 并行执行所有延迟函数
  const orderedFinalizedCalls = await Promise.all(
    finalizedCalls.map((entry) => (typeof entry === 'function' ? entry() : Promise.resolve(entry)))
  );

  // 按 assistant 源顺序发出工具结果消息
  const messages: ToolResultMessage[] = [];
  for (const finalized of orderedFinalizedCalls) {
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }

  return {
    messages,
    terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
  };
}

// ============ 工具准备 ============

/**
 * 准备工具调用参数（兼容性 shim）
 */
function prepareToolCallArguments(tool: AgentTool, toolCall: AgentToolCall): AgentToolCall {
  if (!tool.prepareArguments) {
    return toolCall;
  }
  const preparedArguments = tool.prepareArguments(toolCall.arguments);
  if (preparedArguments === toolCall.arguments) {
    return toolCall;
  }
  return {
    ...toolCall,
    arguments: preparedArguments as Record<string, unknown>,
  };
}

/**
 * 预检工具调用
 *
 * 返回 prepared（可执行）或 immediate（立即完成，失败/被阻止）。
 */
async function prepareToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCall: AgentToolCall,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
  // 查找工具
  const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      kind: 'immediate',
      result: createErrorToolResult(`工具 ${toolCall.name} 未找到`),
      isError: true,
    };
  }

  try {
    // 准备参数（兼容性 shim）
    const preparedToolCall = prepareToolCallArguments(tool, toolCall);
    // 验证参数
    const validatedArgs = validateToolCallArguments(
      tool.name,
      tool.parameters as unknown as Record<string, unknown>,
      preparedToolCall.arguments as Record<string, unknown>
    );

    // 执行 beforeToolCall 钩子
    if (config.beforeToolCall) {
      const beforeResult = await config.beforeToolCall(
        {
          assistantMessage,
          toolCall,
          args: validatedArgs,
          context: currentContext,
        },
        signal
      );
      if (beforeResult?.block) {
        return {
          kind: 'immediate',
          result: createErrorToolResult(beforeResult.reason || '工具执行被阻止'),
          isError: true,
        };
      }
    }

    return {
      kind: 'prepared',
      toolCall,
      tool,
      args: validatedArgs,
    };
  } catch (error) {
    return {
      kind: 'immediate',
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}

/**
 * 执行已预检的工具
 */
async function executePreparedToolCall(
  prepared: PreparedToolCall,
  signal: AbortSignal | undefined,
  emit: AgentEventSink
): Promise<ExecutedToolCallOutcome> {
  const updateEvents: Promise<void>[] = [];
  const execStartTime = Date.now();

  const argsStr = JSON.stringify(prepared.args).slice(0, 200);
  log.debug('开始执行工具', {
    toolName: prepared.toolCall.name,
    args: argsStr,
  });

  try {
    const result = await prepared.tool.execute(
      prepared.toolCall.id,
      prepared.args,
      signal,
      (partialResult: AgentToolResult<unknown>) => {
        updateEvents.push(
          Promise.resolve(
            emit({
              type: 'tool_execution_update',
              toolCallId: prepared.toolCall.id,
              toolName: prepared.toolCall.name,
              args: prepared.toolCall.arguments,
              partialResult,
            })
          )
        );
      }
    );
    await Promise.all(updateEvents);
    const execDuration = Date.now() - execStartTime;

    if (execDuration > 30_000) {
      log.warn('工具执行时间过长', {
        toolName: prepared.toolCall.name,
        duration: execDuration,
        args: argsStr,
      });
    } else {
      log.debug('工具执行完成', {
        toolName: prepared.toolCall.name,
        duration: execDuration,
      });
    }

    return { result, isError: false };
  } catch (error) {
    await Promise.all(updateEvents);
    const execDuration = Date.now() - execStartTime;

    log.warn('工具执行失败', {
      toolName: prepared.toolCall.name,
      duration: execDuration,
      error: error instanceof Error ? error.message : String(error),
      args: argsStr,
    });

    return {
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}

// ============ 工具最终确定 ============

/**
 * 最终确定已执行的工具调用（运行 afterToolCall 钩子）
 */
async function finalizeExecutedToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  prepared: PreparedToolCall,
  executed: ExecutedToolCallOutcome,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined
): Promise<FinalizedToolCallOutcome> {
  let result = executed.result;
  let isError = executed.isError;

  if (config.afterToolCall) {
    try {
      const afterResult = await config.afterToolCall(
        {
          assistantMessage,
          toolCall: prepared.toolCall,
          args: prepared.args,
          result,
          isError,
          context: currentContext,
        },
        signal
      );
      if (afterResult) {
        result = {
          content: afterResult.content ?? result.content,
          details: afterResult.details ?? result.details,
          terminate: afterResult.terminate ?? result.terminate,
        } as AgentToolResult<unknown>;
        isError = afterResult.isError ?? isError;
      }
    } catch (error) {
      result = createErrorToolResult(error instanceof Error ? error.message : String(error));
      isError = true;
    }
  }

  return {
    toolCall: prepared.toolCall,
    result,
    isError,
  };
}

// ============ 辅助函数 ============

/**
 * 判断工具批次是否应终止
 */
function shouldTerminateToolBatch(finalizedCalls: FinalizedToolCallOutcome[]): boolean {
  return (
    finalizedCalls.length > 0 &&
    finalizedCalls.every((finalized) => finalized.result.terminate === true)
  );
}

/**
 * 创建错误工具结果
 */
function createErrorToolResult(message: string): AgentToolResult<unknown> {
  const result: AgentToolResult<unknown> = {
    content: [{ type: 'text' as const, text: message }],
    details: {},
    terminate: undefined as never,
  };
  return result;
}

/**
 * 发出 tool_execution_end 事件
 */
async function emitToolExecutionEnd(
  finalized: FinalizedToolCallOutcome,
  emit: AgentEventSink
): Promise<void> {
  await emit({
    type: 'tool_execution_end',
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    result: finalized.result,
    isError: finalized.isError,
  });
}

/**
 * 创建工具结果消息
 */
function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    content: finalized.result.content,
    isError: finalized.isError,
    timestamp: Date.now(),
  } as ToolResultMessage;
}

/**
 * 发出工具结果消息事件
 */
async function emitToolResultMessage(
  toolResultMessage: ToolResultMessage,
  emit: AgentEventSink
): Promise<void> {
  await emit({ type: 'message_start', message: toolResultMessage });
  await emit({ type: 'message_end', message: toolResultMessage });
}
