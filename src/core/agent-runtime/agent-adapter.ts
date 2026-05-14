/**
 * Agent Adapter — IAgent → Agent 适配器
 *
 * 将自有 Agent 运行时封装为 zapmyco 的 IAgent 接口实现。
 * 这是 agent-runtime 层的核心集成点。
 *
 * @module core/agent-runtime/agent-adapter
 */

import { EventEmitter } from 'node:events';
import type { ThinkingLevel } from '@earendil-works/pi-ai';
import { Agent } from '@/core/agent-runtime/agent';
import {
  Compactor,
  ContextErrorRecovery,
  isContextOverflowError,
  resolveContextWindow,
  TokenTracker,
  ToolResultPruner,
} from '@/core/context';
import type { CompactionResult, ContextWindowInfo } from '@/core/context/types';
import type { TaskResult } from '@/core/result/types';
import type { ConversationLogger } from '@/infra/conversation-logger';
import { eventBus } from '@/infra/event-bus';
import { logger } from '@/infra/logger';
import type { AgentLlmFacade } from '@/llm/agent-llm-facade';
import type {
  AgentExecuteRequest,
  AgentHealthStatus,
  AgentStatus,
  IStreamingAgent,
} from '@/protocol/agent';
import type { Capability } from '@/protocol/capability';
import { createDoomLoopDetector, type DoomLoopDetector } from '@/security/doom-loop-detector';
import { createEventBridgeListener } from './event-bridge';
import { type ToolRegistration, toAgentTools } from './tool-bridge';
import type { AgentAdapterOptions, AgentRuntimeConfig } from './types';

// ============ 默认配置 ============

const log = logger.child('agent-adapter');

const DEFAULT_RUNTIME_CONFIG: Required<AgentRuntimeConfig> = {
  enabled: true,
  toolExecution: 'sequential',
  maxTurns: 50,
  thinkingLevel: 'medium',
};

// ============ LlmBasedAgent 实现 ============

/**
 * 基于自有 Agent 运行时的 LLM 驱动 Agent 实现
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
  readonly EVENT_THINKING = 'thinking' as const;
  readonly EVENT_ERROR = 'error' as const;

  // ============ IAgent 契约 ============

  readonly agentId: string;
  readonly displayName: string;
  readonly capabilities: readonly Capability[];

  // ============ 内部状态 ============

  private inner: Agent;
  private config: Required<AgentRuntimeConfig>;
  private toolRegistrations: ToolRegistration[] = [];
  private _currentLoad = 0;

  /** 记忆快照内容（由外部注入，会话开始时冻结） */
  memorySnapshot: string = '';

  /** Skill 提示内容（由外部注入，会话开始时构建） */
  skillPrompt: string = '';

  /** Skill 条目列表（用于 allowed-tools 自动授权） */
  skillEntries: import('@/core/skill/types').SkillEntry[] = [];

  /**
   * 系统提示词覆盖
   *
   * 当设置时，execute() 将使用此内容替代默认的 buildSystemPrompt()。
   * 用于子 Agent 等需要自定义系统提示词的场景。
   * 设置为 null 或空字符串时恢复默认行为。
   */
  systemPromptOverride: string | null = null;

  /**
   * LLM 外观（由外部注入，用于 Model 解析 + Key 获取 + 故障转移）
   *
   * 设置后，子 Agent 可以通过共享此 facade 来获得独立的 Key 选择能力，
   * 而不是直接复制父 Agent 的 Model + Key。
   */
  llmFacade: AgentLlmFacade | null = null;

  /** 对话日志记录器（可选，注入后自动记录 LLM 对话） */
  conversationLogger: ConversationLogger | null = null;

  // ============ 上下文压缩 ============

  /** Token 追踪器 */
  readonly tokenTracker = new TokenTracker();

  /** 工具输出剪枝器 */
  readonly toolPruner = new ToolResultPruner();

  /** 自动压缩器 */
  readonly compactor = new Compactor();

  /** 错误恢复器 */
  readonly errorRecovery = new ContextErrorRecovery(3);

  /** Doom Loop 检测器 */
  readonly doomLoop: DoomLoopDetector;

  /** 上下文窗口信息（首次 execute() 时通过模型解析） */
  private _contextWindowInfo: ContextWindowInfo | null = null;

  constructor(options: AgentAdapterOptions) {
    super();

    this.agentId = options.agentId;
    this.displayName = options.displayName;
    this.capabilities = options.capabilities;
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...options.runtimeConfig };

    // 创建 Agent 实例
    this.inner = new Agent({
      toolExecution: this.config.toolExecution,
    });

    // 传递 thinkingLevel 配置到 Agent 状态（用于开启 Claude/DeepSeek 等模型的 reasoning/thinking）
    this.inner.state.thinkingLevel = this.config.thinkingLevel as ThinkingLevel;

    // 设置 transformContext hook：每次 LLM 调用前自动剪枝旧工具输出
    this.inner.transformContext = async (messages) => {
      return this.toolPruner.transform(messages);
    };

    // 初始化 Doom Loop 检测器
    this.doomLoop = createDoomLoopDetector();
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
   * 访问内部 Agent 实例（仅限高级用法）
   *
   * @internal 仅供测试和高级集成使用
   */
  get innerAgent(): Agent {
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
    let hadContextOverflowError = false;

    try {
      // 解析上下文窗口信息（首次执行时）
      if (!this._contextWindowInfo && this.llmFacade) {
        try {
          const model = this.llmFacade.resolvePiModel();
          this._contextWindowInfo = resolveContextWindow(model);
          // 将 LLM Facade 注入到 compactor
          this.compactor.setLlmFacade(this.llmFacade);
        } catch {
          // 上下文窗口解析失败非致命
        }
      }

      // 构建系统提示词并设置到 Agent 状态
      this.inner.state.systemPrompt = this.buildSystemPrompt(request);

      // 绑定事件桥接（带 taskId），收集清理函数用于后续移除
      cleanupFns.push(
        this.inner.subscribe(createEventBridgeListener(request.taskId, this.agentId))
      );

      // 同时监听并转发到本地的 EventEmitter（支持 IStreamingAgent）
      cleanupFns.push(
        this.inner.subscribe((event) => {
          // Token 追踪：从 turn_end 事件提取 usage
          if (event.type === 'turn_end' && event.message) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const usage = (event.message as any).usage;
            if (usage && typeof usage.input === 'number') {
              this.tokenTracker.recordUsage(usage);
            }
          }

          if (event.type === 'message_update') {
            const extracted = extractDeltaFromEvent(event);
            if (extracted) {
              if (extracted.kind === 'thinking') {
                this.emit(this.EVENT_THINKING, {
                  taskId: request.taskId,
                  text: extracted.delta,
                });
              } else {
                this.emit(this.EVENT_OUTPUT, {
                  taskId: request.taskId,
                  text: extracted.delta,
                });
              }
            }
          }
          if (event.type === 'tool_execution_start') {
            const paramsStr = formatToolArgs(event.args);
            this.emit(this.EVENT_PROGRESS, {
              taskId: request.taskId,
              percent: 0,
              message: paramsStr ? `${event.toolName}(${paramsStr})` : event.toolName,
            });

            // Doom Loop 检测：记录工具调用
            const doomResult = this.doomLoop.recordCall(
              event.toolName,
              (event.args ?? {}) as Record<string, unknown>
            );
            if (doomResult.detected) {
              this.emit(this.EVENT_PROGRESS, {
                taskId: request.taskId,
                percent: 0,
                message: `⚠️ ${doomResult.reason}`,
              });
              eventBus.emit('security:doom-loop', {
                toolId: event.toolName,
                type: doomResult.type ?? 'repeated-call',
                reason: doomResult.reason ?? '未知循环',
              });
            }
          }
          if (event.type === 'tool_execution_end') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toolResult = (event as any).result;
            const isSuccess =
              toolResult !== undefined &&
              !(toolResult instanceof Error) &&
              toolResult?.error === undefined;

            this.emit(this.EVENT_PROGRESS, {
              taskId: request.taskId,
              percent: 100,
              message: `工具 ${event.toolName} ${isSuccess ? '完成' : '失败'}`,
            });

            // Doom Loop 检测：记录执行结果
            const doomResult = this.doomLoop.recordResult(isSuccess);
            if (doomResult.detected) {
              this.emit(this.EVENT_PROGRESS, {
                taskId: request.taskId,
                percent: 100,
                message: `⚠️ ${doomResult.reason}`,
              });
              eventBus.emit('security:doom-loop', {
                toolId: event.toolName,
                type: doomResult.type ?? 'consecutive-failure',
                reason: doomResult.reason ?? '连续执行失败',
              });
            }
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

      // 记录对话日志（如已启用）
      if (this.conversationLogger?.isEnabled && this.inner.state.model) {
        const modelName =
          typeof this.inner.state.model === 'object' && this.inner.state.model !== null
            ? ((this.inner.state.model as { name?: string }).name ?? 'unknown')
            : 'unknown';
        this.conversationLogger.logExecution(
          modelName,
          this.inner.state.messages,
          result.tokenUsage,
          result.duration
        );
      }

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // 检测上下文溢出错误并尝试恢复
      if (
        isContextOverflowError(err) &&
        this.errorRecovery.shouldRecover(err) &&
        this._contextWindowInfo
      ) {
        hadContextOverflowError = true;
        log.warn('检测到上下文溢出错误，尝试紧急压缩恢复', {
          error: err.message,
          recoveryStatus: this.errorRecovery.getStatus(),
        });

        try {
          const recoveryConfig = this.errorRecovery.prepareRecovery();

          // 更激进的剪枝配置
          this.toolPruner.updateConfig({
            protectLastMessages: recoveryConfig.protectLastMessages,
          });

          // 紧急压缩
          const compactionResult = await this.compactor.compact(
            this.inner,
            this._contextWindowInfo,
            true
          );

          if (compactionResult.success) {
            this.tokenTracker.reset();
            this.errorRecovery.reset();
            log.info('紧急压缩成功，即将重试执行');
            // 不直接返回，由外部调用者处理重试
          } else {
            log.error('紧急压缩失败', { error: compactionResult.error });
          }
        } catch (compactionError) {
          log.error('紧急压缩过程中发生错误', {
            error:
              compactionError instanceof Error ? compactionError.message : String(compactionError),
          });
        }
      }

      // 发送错误事件
      this.emit(this.EVENT_ERROR, { taskId: request.taskId, error: err });

      // 构建错误结果
      const errorResult: TaskResult = {
        taskId: request.taskId,
        status: 'failure',
        output: null,
        artifacts: [],
        duration: Date.now() - startTime,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
        },
        error: {
          code: hadContextOverflowError ? 'CONTEXT_OVERFLOW' : 'AGENT_EXECUTION_FAILED',
          message: hadContextOverflowError ? `上下文超出窗口限制: ${err.message}` : err.message,
          retryable: hadContextOverflowError,
          details: { stack: err.stack },
        },
      };

      // 如果是上下文溢出，在 error 上附加恢复建议
      if (hadContextOverflowError) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (errorResult.error as any).suggestion =
          '建议使用 /compact 命令手动压缩上下文，或使用更长的上下文窗口模型';
      }

      return errorResult;
    } finally {
      // 清理本次执行的事件订阅（防止复用 Agent 实例时监听器累积）
      for (const fn of cleanupFns) {
        fn();
      }
      this._currentLoad--;
    }
  }

  // ============ 上下文压缩 ============

  /**
   * 判断是否应该触发自动压缩
   */
  shouldCompact(): boolean {
    if (!this._contextWindowInfo) return false;
    return this.compactor.shouldCompact(this.inner, this._contextWindowInfo);
  }

  /**
   * 执行压缩并返回结果
   */
  async compact(): Promise<CompactionResult> {
    if (!this._contextWindowInfo) {
      // 尝试解析上下文窗口
      if (this.llmFacade) {
        const model = this.llmFacade.resolvePiModel();
        this._contextWindowInfo = resolveContextWindow(model);
        this.compactor.setLlmFacade(this.llmFacade);
      }

      if (!this._contextWindowInfo) {
        return {
          beforeMessageCount: 0,
          afterMessageCount: 0,
          beforeEstimatedTokens: 0,
          afterEstimatedTokens: 0,
          savingsRatio: 0,
          success: false,
          durationMs: 0,
          error: '无法解析上下文窗口信息',
        };
      }
    }

    const result = await this.compactor.compact(this.inner, this._contextWindowInfo);
    if (result.success) {
      this.tokenTracker.reset();
    }
    return result;
  }

  /**
   * 获取上下文窗口信息
   */
  getContextWindowInfo(): ContextWindowInfo | null {
    return this._contextWindowInfo;
  }

  /**
   * 获取 token 追踪快照
   */
  getTokenSnapshot() {
    return this.tokenTracker.getSnapshot(this.inner.state.messages.length);
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
    // 子 Agent 等场景使用自定义系统提示词
    if (this.systemPromptOverride) {
      const parts = [this.systemPromptOverride];
      if (request.workdir) {
        parts.push(`\n## 工作目录\n${request.workdir}`);
      }
      return parts.join('\n');
    }

    const hasTaskManage = this.toolRegistrations.some((t) => t.id === 'TaskManage');
    const hasMemory = this.toolRegistrations.some((t) => t.id === 'Memory');
    const hasSkill = this.toolRegistrations.some((t) => t.id === 'Skill');
    const hasSpawnSubAgents = this.toolRegistrations.some((t) => t.id === 'SpawnSubAgents');
    const hasAskUserQuestion = this.toolRegistrations.some((t) => t.id === 'AskUserQuestion');

    const parts: string[] = [
      `你是 ${this.displayName}，一个专业的 AI 助手。`,
      `你的能力包括：${this.capabilities.map((c) => c.name).join('、')}。`,
    ];

    // 记忆块 — 在系统提示最前面注入（快照在会话开始时冻结）
    if (hasMemory && this.memorySnapshot) {
      parts.push('', '## 持久化记忆（快照）', '', this.memorySnapshot);
    }

    // 记忆使用引导
    if (hasMemory) {
      parts.push(
        '',
        '## 记忆管理规范',
        '',
        '你有跨会话的持久化记忆能力。记忆存储在 ~/.zapmyco/memory/ 目录中。',
        '会话开始时已加载记忆快照到系统提示中，你可以直接使用这些信息。',
        '',
        '### 何时保存记忆',
        '- 用户明确告知偏好、习惯、技术背景时 → 使用 memory add type="user"',
        '- 项目做出重要决策或约定时 → 使用 memory add type="project"',
        '- 用户纠正你的行为或给出反馈时 → 使用 memory add type="user"',
        '- 会话中有值得跨会话保留的结论时 → 使用 memory add type="session"',
        '',
        '### 何时不保存',
        '- 临时任务进度、会话状态（使用 TaskManage 管理）',
        '- 代码细节（可直接从代码库获取，不需要记忆）',
        '- 一次性查询的内容',
        ''
      );
    }

    // Skill 列表 — 在记忆后、任务管理前注入
    if (hasSkill && this.skillPrompt) {
      parts.push('', this.skillPrompt);
    }

    // 任务管理引导 — 必须放在最前面，确保 Agent 第一时间看到
    if (hasTaskManage) {
      parts.push(
        '## 任务管理规范（最高优先级）',
        '',
        '收到用户任务后，第一时间判断是否包含 2 个以上独立步骤。',
        '如果是，你的**第一个工具调用必须且只能是** `TaskManage` (action="write")，先分解任务列表！',
        '在任何搜索、读取、写入操作之前完成规划。不得先做再补！',
        '',
        '1. **规划优先**：第一个 tool call = TaskManage write。先规划，后执行。',
        '2. **逐个更新**：完成一个子任务 → 立即 update 为 "completed" → 再开始下一个。绝不批量更新。',
        '3. **保持专注**：同时只有 1 个 "in_progress"。',
        '4. **先读后写**：不确定当前任务时先用 action="read" 查看。'
      );

      // SpawnSubAgents 使用引导 — 紧接任务管理规范
      if (hasSpawnSubAgents) {
        parts.push(
          '',
          '## 并行执行规范（次高优先级）',
          '',
          '完成 TaskManage write 分解后，识别其中**互不依赖**的独立子任务。',
          '将这些子任务通过 `SpawnSubAgents` 工具并行派发给子 Agent 同时执行。',
          '',
          '### 工作流程',
          '1. `TaskManage write` → 分解所有子任务',
          '2. 识别可并行的独立任务（无顺序依赖、无共享状态）',
          '3. `SpawnSubAgents(agents: [...])` → 一次性并行执行',
          '4. 根据返回结果逐一 `TaskManage update` 更新状态',
          '5. 将有依赖的串行任务保留给自己后续执行',
          '',
          '### 何时使用 SpawnSubAgents',
          '- ✅ 多个独立的搜索/研究任务（如同时搜索三个不同技术方案）',
          '- ✅ 多个独立的文件读取/分析任务（如同时分析多个模块）',
          '- ✅ 互不依赖的信息收集任务',
          '- ❌ 任务之间有严格的顺序依赖（必须先 A 后 B）',
          '- ❌ 只有 1 个任务时（直接执行即可）',
          '- ❌ 任务需要修改文件（子 Agent 默认只有只读工具）',
          ''
        );
      }
    }

    // AskUserQuestion 使用引导
    if (hasAskUserQuestion) {
      parts.push(
        '',
        '## 交互式提问规范（AskUserQuestion）',
        '',
        '当需要用户决策时，使用 `AskUserQuestion` 工具向用户提问。',
        '',
        '### 何时使用',
        '- 需要在多个可行方案之间做出选择时',
        '- 需要技术选型、架构决策等需要用户判断的问题',
        '- 在 Plan Mode 中完成代码分析后需要确认方向时',
        '- 需要明确用户偏好以实现个性化功能时',
        '',
        '### 何时不使用',
        '- 可以通过代码分析直接确定的结论',
        '- 简单的确认（直接在回复中询问即可）',
        '- 已有明确最佳实践的问题',
        '',
        '### 提问原则',
        '- 每个问题提供 2-4 个具体、互斥的选项',
        '- 选项之间应覆盖所有合理可能',
        '- header 字段控制在 12 个字符以内',
        '- 使用 `multiSelect: true` 允许多选',
        '- 推荐选项放在第一位并加 "(Recommended)" 后缀',
        '- 如果选项有代码示例/配置对比，可在 `preview` 字段中提供（markdown 格式）',
        '- 用户始终可以选择 "Other" 输入自定义答案',
        '- 在 Plan Mode 中用 AskUserQuestion 明确需求，用 ExitPlanMode 请求审批',
        ''
      );
    }

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

    // 检测真正的错误状态（pi-agent-core 内部 catch 不会向外抛异常）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateError = (state as any).errorMessage as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasStreamError = (lastAssistantMessage as any)?.stopReason === 'error';
    const hasErrorMessage =
      hasStreamError &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (lastAssistantMessage as any)?.errorMessage === 'string';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorText = hasErrorMessage ? (lastAssistantMessage as any).errorMessage : undefined;
    const isEmpty = !output || output.trim().length === 0;

    if (stateError || hasStreamError || isEmpty) {
      const errorMsg =
        errorText ?? stateError ?? 'Agent 执行出错（未返回有效内容，请检查 API Key 配置）';
      return {
        taskId,
        status: 'failure',
        output,
        error: {
          code: stateError ? 'AGENT_ERROR' : 'EMPTY_OUTPUT',
          message: errorMsg,
          retryable: false,
        },
        artifacts: [],
        duration,
        tokenUsage: this.tokenTracker.getUsage(),
      };
    }

    return {
      taskId,
      status: 'success',
      output,
      artifacts: [],
      duration,
      tokenUsage: this.tokenTracker.getUsage(),
    };
  }

  /**
   * 获取 Agent 运行时版本号
   */
  private getPkgVersion(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('@earendil-works/pi-ai/package.json');
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
}): { delta: string; kind: 'text' | 'thinking' } | null {
  const evt = event.assistantMessageEvent as Record<string, unknown> | null;
  if (!evt || typeof evt !== 'object') return null;
  // 处理 text_delta
  if (evt.type === 'text_delta') {
    if (typeof evt.delta === 'string') return { delta: evt.delta, kind: 'text' };
    if (typeof (evt as Record<string, unknown>).text_delta === 'string') {
      return { delta: (evt as Record<string, unknown>).text_delta as string, kind: 'text' };
    }
  }
  // 处理 thinking_delta
  if (evt.type === 'thinking_delta') {
    if (typeof evt.delta === 'string') return { delta: evt.delta, kind: 'thinking' };
    if (typeof (evt as Record<string, unknown>).thinking_delta === 'string') {
      return { delta: (evt as Record<string, unknown>).thinking_delta as string, kind: 'thinking' };
    }
  }
  return null;
}

/**
 * 将工具调用参数格式化为可读字符串
 *
 * 例如: { file_path: "/a/b", pattern: "*.ts" }
 *    → file_path="/a/b", pattern="*.ts"
 */
function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      const display = raw.length > 80 ? raw.slice(0, 77) + '...' : raw;
      return `${key}="${display.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    })
    .join(', ');
}
