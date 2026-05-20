/**
 * Agent 核心循环
 *
 * 替代 @mariozechner/pi-agent-core 的 agent-loop 实现。
 * 职责：LLM 流式调用 → 解析响应 → 提取工具调用 → 执行工具 → 回填结果 → 循环
 *
 * @module core/agent-runtime/agent-loop
 */

import {
  type AssistantMessage,
  type Context,
  streamSimple,
  type ToolResultMessage,
} from '@earendil-works/pi-ai';
import { logger } from '@/infra/logger';
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

const log = logger.child('agent-loop');

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
 * @param streamFn - 流函数（默认 streamSimple）
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
 * @param streamFn - 流函数（默认 streamSimple）
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
 * 此处将 AgentMessage[] 转换为 Message[] 供 LLM 使用。
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

  // 应用上下文转换（AgentMessage[] → AgentMessage[]）
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

  // 转换为 LLM 兼容消息（AgentMessage[] → Message[]）
  if (!config.convertToLlm) {
    throw new Error('convertToLlm 未设置');
  }
  const t1 = Date.now();
  const llmMessages = await config.convertToLlm(messages);
  log.debug('消息格式转换完成', { duration: Date.now() - t1, llmMessageCount: llmMessages.length });

  // 构建 LLM 上下文
  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools as Context['tools'],
  } as Context;

  const streamFunction = streamFn || streamSimple;

  // 解析 API Key
  const resolvedApiKey =
    (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

  const response = await streamFunction(config.model, llmContext, {
    ...config,
    apiKey: resolvedApiKey,
    signal,
    timeoutMs: 120_000, // 网络层 HTTP 请求超时（2 分钟），防止 LLM 调用无限挂起
  } as Record<string, unknown>);

  let partialMessage: AssistantMessage | null = null;
  let addedPartial = false;
  let firstDeltaTime = 0;
  let eventCount = 0;
  const YIELD_INTERVAL = 10; // 每处理 10 个事件用 setImmediate 让出事件循环

  for await (const event of response) {
    switch (event.type) {
      case 'start':
        partialMessage = event.partial;
        context.messages.push(partialMessage);
        addedPartial = true;
        await emit({ type: 'message_start', message: { ...partialMessage } });
        break;

      case 'text_start':
      case 'text_delta':
      case 'text_end':
      case 'thinking_start':
      case 'thinking_delta':
      case 'thinking_end':
      case 'toolcall_start':
      case 'toolcall_delta':
      case 'toolcall_end':
        if (!firstDeltaTime) {
          firstDeltaTime = Date.now();
        }
        if (partialMessage) {
          partialMessage = event.partial;
          context.messages[context.messages.length - 1] = partialMessage;
          await emit({
            type: 'message_update',
            assistantMessageEvent: event,
            message: { ...partialMessage },
          });
        }
        break;

      case 'done':
      case 'error': {
        const finalMessage = await response.result();
        if (addedPartial) {
          context.messages[context.messages.length - 1] = finalMessage;
        } else {
          context.messages.push(finalMessage);
        }
        if (!addedPartial) {
          await emit({ type: 'message_start', message: { ...finalMessage } });
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

    // 定期让出事件循环，让 TUI setInterval (spinner/timer) 有机会执行
    eventCount++;
    if (eventCount % YIELD_INTERVAL === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  const finalMessage = await response.result();
  if (addedPartial) {
    context.messages[context.messages.length - 1] = finalMessage;
  } else {
    context.messages.push(finalMessage);
    await emit({ type: 'message_start', message: { ...finalMessage } });
  }
  await emit({ type: 'message_end', message: finalMessage });

  const toolCalls =
    finalMessage.content?.filter((c): c is AgentToolCall => c.type === 'toolCall') ?? [];
  log.info('LLM 流式调用完成（无事件结束标记）', {
    duration: Date.now() - startTime,
    stopReason: finalMessage.stopReason,
    toolCallCount: toolCalls.length,
    inputMessageCount: llmMessages.length,
  });
  return finalMessage;
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
