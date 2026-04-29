/**
 * Agent Adapter — IAgent → pi-agent-core.Agent 适配器
 *
 * 将 pi-agent-core 的有状态 Agent 封装为 zapmyco 的 IAgent 接口实现。
 * 这是 agent-runtime 层的核心集成点。
 *
 * @module core/agent-runtime/agent-adapter
 */

import { EventEmitter } from 'node:events';
import { Agent as PiAgent } from '@mariozechner/pi-agent-core';
import type { TaskResult } from '@/core/result/types';
import type {
  AgentExecuteRequest,
  AgentHealthStatus,
  AgentStatus,
  IStreamingAgent,
} from '@/protocol/agent';
import type { Capability } from '@/protocol/capability';
import { createEventBridgeListener } from './event-bridge';
import { type ToolRegistration, toAgentTools } from './tool-bridge';
import type { AgentAdapterOptions, AgentRuntimeConfig } from './types';

// ============ 默认配置 ============

const DEFAULT_RUNTIME_CONFIG: Required<AgentRuntimeConfig> = {
  enabled: true,
  toolExecution: 'sequential',
  maxTurns: 50,
  thinkingLevel: 'medium',
};

// ============ LlmBasedAgent 实现 ============

/**
 * 基于 pi-agent-core 的 LLM 驱动 Agent 实现
 *
 * 将 zapmyco 的 IAgent 接口适配到 pi-agent-core 的 Agent 类，
 * 实现完整的 Agent 生命周期管理：
 * - execute(): 通过 Agent.prompt() 发起任务
 * - cancel(): 通过 Agent.abort() 中止执行
 * - healthCheck(): 检查 Agent 内部状态
 * - 流式事件: 通过 EventEmitter + EventBridge 双通道输出
 */
export class LlmBasedAgent extends EventEmitter implements IStreamingAgent {
  readonly EVENT_PROGRESS = 'progress' as const;
  readonly EVENT_OUTPUT = 'output' as const;
  readonly EVENT_ERROR = 'error' as const;

  // ============ IAgent 契约 ============

  readonly agentId: string;
  readonly displayName: string;
  readonly capabilities: readonly Capability[];

  // ============ 内部状态 ============

  private inner: PiAgent;
  private config: Required<AgentRuntimeConfig>;
  private toolRegistrations: ToolRegistration[] = [];
  private _currentLoad = 0;

  constructor(options: AgentAdapterOptions) {
    super();

    this.agentId = options.agentId;
    this.displayName = options.displayName;
    this.capabilities = options.capabilities;
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...options.runtimeConfig };

    // 创建 pi-agent-core Agent 实例
    this.inner = new PiAgent({
      toolExecution: this.config.toolExecution,
    });
  }

  // ============ 属性访问器 ============

  get status(): AgentStatus {
    if (!this.config.enabled) return 'offline';
    if (this._currentLoad > 0) return 'busy';
    return 'online';
  }

  get currentLoad(): number {
    return this._currentLoad;
  }

  /**
   * 访问内部 pi-agent-core Agent 实例（仅限高级用法）
   *
   * @internal 仅供测试和高级集成使用
   */
  get innerAgent(): PiAgent {
    return this.inner;
  }

  // ============ 工具注册 ============

  /**
   * 注册工具到 Agent
   *
   * @param tools - 工具注册列表
   */
  registerTools(tools: ToolRegistration[]): void {
    this.toolRegistrations.push(...tools);
    const agentTools = toAgentTools(tools);
    // 通过 state.tools 设置（AgentState 的 tools 是 getter/setter）
    this.inner.state.tools = [...this.inner.state.tools, ...agentTools];
  }

  /**
   * 清除所有已注册的工具
   */
  clearTools(): void {
    this.toolRegistrations = [];
    this.inner.state.tools = [];
  }

  // ============ IAgent 核心方法 ============

  /**
   * 执行任务
   *
   * 将 AgentExecuteRequest 转换为 pi-agent-core Agent 的 prompt 调用：
   * 1. 构建执行上下文（任务描述 + 上游结果）
   * 2. 设置系统提示词
   * 3. 绑定事件桥接到 eventBus + EventEmitter
   * 4. 调用 Agent.prompt() 并等待完成
   * 5. 提取结果并组装为 TaskResult
   */
  async execute(request: AgentExecuteRequest): Promise<TaskResult> {
    const startTime = Date.now();
    this._currentLoad++;
    const cleanupFns: (() => void)[] = [];

    try {
      // 构建系统提示词并设置到 Agent 状态
      this.inner.state.systemPrompt = this.buildSystemPrompt(request);

      // 绑定事件桥接（带 taskId），收集清理函数用于后续移除
      cleanupFns.push(
        this.inner.subscribe(createEventBridgeListener(request.taskId, this.agentId))
      );

      // 同时监听并转发到本地的 EventEmitter（支持 IStreamingAgent）
      cleanupFns.push(
        this.inner.subscribe((event) => {
          if (event.type === 'message_update') {
            const delta = extractDeltaFromEvent(event);
            if (delta) {
              this.emit(this.EVENT_OUTPUT, {
                taskId: request.taskId,
                text: delta,
              });
            }
          }
          if (event.type === 'tool_execution_start') {
            this.emit(this.EVENT_PROGRESS, {
              taskId: request.taskId,
              percent: 0,
              message: `执行工具: ${event.toolName}`,
            });
          }
          if (event.type === 'tool_execution_end') {
            this.emit(this.EVENT_PROGRESS, {
              taskId: request.taskId,
              percent: 100,
              message: `工具 ${event.toolName} 完成`,
            });
          }
          if (event.type === 'agent_end') {
            this.emit(this.EVENT_PROGRESS, {
              taskId: request.taskId,
              percent: 100,
              message: '任务完成',
            });
          }
        })
      );

      // 执行 prompt
      await this.inner.prompt(request.taskDescription);

      // 等待 Agent 进入空闲状态
      await this.inner.waitForIdle();

      // 提取结果
      const result = this.extractTaskResult(request.taskId, startTime);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // 发送错误事件
      this.emit(this.EVENT_ERROR, { taskId: request.taskId, error: err });

      return {
        taskId: request.taskId,
        status: 'failure',
        output: null,
        artifacts: [],
        duration: Date.now() - startTime,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        },
        error: {
          code: 'AGENT_EXECUTION_FAILED',
          message: err.message,
          retryable: false,
          details: { stack: err.stack },
        },
      };
    } finally {
      // 清理本次执行的事件订阅（防止复用 Agent 实例时监听器累积）
      for (const fn of cleanupFns) {
        fn();
      }
      this._currentLoad--;
    }
  }

  /**
   * 取消正在执行的任务
   */
  async cancel(taskId: string): Promise<void> {
    this.inner.abort();
    this.emit(this.EVENT_PROGRESS, {
      taskId,
      percent: -1,
      message: '任务已取消',
    });
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<AgentHealthStatus> {
    const startTime = Date.now();
    try {
      // 检查内部 Agent 状态是否可访问
      const state = this.inner.state;
      const latencyMs = Date.now() - startTime;

      return {
        是否健康: this.config.enabled && !state.isStreaming,
        latencyMs,
        version: `pi-agent-core@${this.getPkgVersion()}`,
        details: {
          isStreaming: state.isStreaming,
          messagesCount: state.messages.length,
          toolsCount: state.tools.length,
          currentLoad: this._currentLoad,
        },
      };
    } catch {
      return {
        是否健康: false,
        latencyMs: Date.now() - startTime,
        version: 'unknown',
        details: { error: 'Health check failed' },
      };
    }
  }

  // ============ 辅助方法 ============

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(request: AgentExecuteRequest): string {
    const parts: string[] = [
      `你是 ${this.displayName}，一个专业的 AI 助手。`,
      `你的能力包括：${this.capabilities.map((c) => c.name).join('、')}。`,
    ];

    if (request.upstreamResults?.length) {
      parts.push(
        '\n## 上游任务结果\n',
        ...request.upstreamResults.map((r, i) => `[上游任务 ${i + 1}] ${JSON.stringify(r.output)}`)
      );
    }

    if (request.workdir) {
      parts.push(`\n## 工作目录\n${request.workdir}`);
    }

    return parts.join('\n');
  }

  /**
   * 从 Agent 状态中提取 TaskResult
   */
  private extractTaskResult(taskId: string, startTime: number): TaskResult {
    const state = this.inner.state;
    const duration = Date.now() - startTime;

    // 从消息历史中提取最后的 assistant 回复作为 output
    const lastAssistantMessage = [...state.messages].reverse().find((m) => m.role === 'assistant');

    const output = lastAssistantMessage ? extractTextFromMessage(lastAssistantMessage) : null;

    return {
      taskId,
      status: 'success',
      output,
      artifacts: [],
      duration,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    };
  }

  /**
   * 获取 pi-agent-core 包版本号
   */
  private getPkgVersion(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('@mariozechner/pi-agent-core/package.json');
      return pkg.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

// ============ 工厂函数 ============

/**
 * 创建 LlmBasedAgent 实例的工厂函数
 *
 * @param options - 适配器选项
 * @returns 配置好的 LlmBasedAgent 实例
 */
export function createLlmBasedAgent(options: AgentAdapterOptions): LlmBasedAgent {
  return new LlmBasedAgent(options);
}

/**
 * 从 SubTask 创建 Agent 执行请求
 *
 * 将 zapmyco 的 SubTask 转换为 AgentExecuteRequest 格式。
 *
 * @param subTask - 子任务定义
 * @param workdir - 项目工作目录
 * @param options - 执行选项
 * @returns AgentExecuteRequest
 */
export function createRequestFromSubTask(
  subTask: import('@/core/task/types').SubTask,
  workdir: string,
  options?: Partial<AgentExecuteRequest['options']>
): AgentExecuteRequest {
  return {
    taskId: subTask.id,
    taskDescription: subTask.description,
    workdir,
    options: {
      timeout: 300_000, // 默认 5 分钟超时
      verbose: false,
      ...options,
    },
  };
}

// ============ 辅助函数 ============

/**
 * 从 AgentMessage 中提取文本内容
 */
function extractTextFromMessage(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(
        (block): block is { type: string; text?: string } =>
          typeof block === 'object' && block !== null && block.type === 'text'
      )
      .map((block) => block.text ?? '')
      .join('');
  }
  return null;
}

/**
 * 从 message_update 事件中提取 delta 文本
 */
function extractDeltaFromEvent(event: {
  type: 'message_update';
  message: unknown;
  assistantMessageEvent: unknown;
}): string | null {
  const evt = event.assistantMessageEvent as Record<string, unknown> | null;
  if (!evt || typeof evt !== 'object') return null;
  if (typeof evt.delta === 'string') return evt.delta;
  if (
    evt.type === 'text_delta' &&
    typeof (evt as Record<string, unknown>).text_delta === 'string'
  ) {
    return (evt as Record<string, unknown>).text_delta as string;
  }
  return null;
}
