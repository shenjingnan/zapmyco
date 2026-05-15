/**
 * Agent 编排器
 *
 * 替代 SubAgentManager，提供三种编排模式：
 * - spawnFlat(): 扁平并行（兼容旧 SubAgentManager.spawnAndWait()）
 * - spawnTeam(): Coordinator + Workers 模式
 * - spawnWorker(): 按类型创建单个 Worker
 *
 * @module core/agent-team
 */

import type { SubAgentConfig } from '@/config/types';
import type { LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import type {
  AgentCurrentActivity,
  AgentTeamConfig,
  TeamResult,
  WorkerResult,
} from '@/core/agent-team/types';
import type { SubAgentResultEntry, SubAgentResults, SubAgentSpec } from '@/core/sub-agent/types';
import type { WorktreeInfo } from '@/core/worktree/types';
import { runInWorktree } from '@/core/worktree/worktree-context';
import { getWorktreeManager } from '@/core/worktree/worktree-manager';
import { logger } from '@/infra/logger';
import { createAgentFromType } from './agent-factory';
import { getAgentInstanceManager } from './agent-instance-manager';
import { aggregateResults } from './agent-result-aggregator';
import { getAgentTypeRegistry } from './agent-type-registry';

const log = logger.child('agent-orchestrator');

/** spawnWorker 选项 */
export interface SpawnWorkerOptions {
  /** 任务 ID（自动生成若不提供） */
  taskId?: string;
  /** 超时（毫秒） */
  timeoutMs?: number;
  /** 是否继承父级上下文 */
  inheritContext?: boolean | undefined;
  /** 背景上下文 */
  context?: string | undefined;
  /** 父实例 ID（自动使用 parentAgent 的 ID 若不提供） */
  parentInstanceId?: string | undefined;
  /**
   * 执行包装器
   *
   * 用于在 agent.execute() 前后注入运行时上下文（如 ToolGuardContext）。
   * 接收原始 execute 函数，返回包装后的结果。
   *
   * 典型用途：后台 Agent 通过此钩子设置 isBackgroundAgent 上下文，
   * 使 ToolGuard 自动将 ASK 降级为 DENY。
   */
  wrapExecute?: (execute: () => Promise<unknown>) => Promise<unknown>;
  /** 隔离模式（默认 undefined = 无隔离） */
  isolation?: 'worktree' | undefined;
}

/** spawnTeam Worker 规格 */
export interface WorkerSpec {
  /** Agent 类型 ID */
  typeId: string;
  /** 任务描述 */
  taskDescription: string;
  /** 可选配置覆盖 */
  options?: SpawnWorkerOptions;
}

/**
 * Agent 编排器
 *
 * 负责 Agent 实例的创建、执行编排和结果聚合。
 * 实现三种编排模式，支持递归深度控制和向后兼容。
 */
export class AgentOrchestrator {
  private teamConfig: AgentTeamConfig;
  private flatConfig: SubAgentConfig;
  private parentAgent: LlmBasedAgent;
  private availableTools: ToolRegistration[];
  private teamCounter = 0;

  constructor(
    teamConfig: AgentTeamConfig,
    flatConfig: SubAgentConfig,
    parentAgent: LlmBasedAgent,
    availableTools: ToolRegistration[]
  ) {
    this.teamConfig = teamConfig;
    this.flatConfig = flatConfig;
    this.parentAgent = parentAgent;
    this.availableTools = availableTools;
  }

  // ============ spawnFlat: 扁平并行模式 ============

  /**
   * 扁平并行执行（兼容旧 SubAgentManager.spawnAndWait()）
   *
   * 使用 general-purpose Agent 类型创建子 Agent，批量并行执行。
   * 行为与现有 SubAgentManager.spawnAndWait() 完全一致。
   *
   * @param specs - 子任务规格列表
   * @param context - 可选的背景摘要
   * @returns 结构化执行结果（与 SubAgentResults 兼容）
   */
  async spawnFlat(specs: SubAgentSpec[], context?: string): Promise<SubAgentResults> {
    const startTime = Date.now();
    const registry = getAgentTypeRegistry();
    const defaultType = registry.getDefault();
    if (!defaultType) {
      throw new Error('无法获取默认 Agent 类型（general-purpose）');
    }

    log.info('开始扁平并行执行', {
      count: specs.length,
      maxConcurrent: this.flatConfig.maxConcurrent,
      hasContext: context != null,
    });

    const allResults: SubAgentResultEntry[] = [];

    for (let i = 0; i < specs.length; i += this.flatConfig.maxConcurrent) {
      const batch = specs.slice(i, i + this.flatConfig.maxConcurrent);
      log.debug('执行扁平批次', {
        batchStart: i,
        batchSize: batch.length,
        totalSpecs: specs.length,
      });

      const batchResults = await Promise.all(
        batch.map((spec) => this.executeFlatOne(spec, defaultType.typeId, context))
      );
      allResults.push(...batchResults);
    }

    const succeeded = allResults.filter((r) => r.status === 'success').length;
    const totalDuration = Date.now() - startTime;

    log.info('扁平并行执行完成', {
      total: allResults.length,
      succeeded,
      failed: allResults.length - succeeded,
      duration: totalDuration,
    });

    return {
      total: allResults.length,
      succeeded,
      failed: allResults.length - succeeded,
      results: allResults,
      summary: this.buildFlatSummary(allResults),
    };
  }

  /**
   * 执行单个扁平子任务
   */
  private async executeFlatOne(
    spec: SubAgentSpec,
    defaultTypeId: string,
    context?: string
  ): Promise<SubAgentResultEntry> {
    const startTime = Date.now();
    const instanceManager = getAgentInstanceManager();
    const registry = getAgentTypeRegistry();
    const definition = registry.get(defaultTypeId);
    if (!definition) {
      return {
        specId: spec.id,
        status: 'failure',
        output: null,
        error: `Agent 类型 '${defaultTypeId}' 未找到`,
        duration: Date.now() - startTime,
      };
    }

    const depth = 1; // flat workers 在 depth=1
    const instanceId = `flat-${spec.id}-${Date.now()}`;

    let stopRelay: (() => void) | undefined;
    try {
      // 1. 使用 Agent 类型系统创建隔离的子 Agent
      const agent = createAgentFromType(
        definition,
        {
          instanceId,
          depth,
          task: {
            taskId: `flat-${spec.id}`,
            description: spec.description,
            mode: 'sync',
            timeoutMs: this.flatConfig.taskTimeoutMs,
            inheritContext: false,
          },
        },
        this.parentAgent,
        this.availableTools,
        this.teamConfig
      );

      // 2. 注册到 InstanceManager
      instanceManager.register(
        definition,
        agent,
        {
          taskId: `flat-${spec.id}`,
          description: spec.description,
          mode: 'sync',
          timeoutMs: this.flatConfig.taskTimeoutMs,
          inheritContext: false,
        },
        null,
        depth
      );

      // 3. 监听子 Agent 进度事件，中继到 InstanceManager 驱动 UI 状态栏
      stopRelay = this.#relayAgentProgress(agent, instanceId);

      // 4. 构建系统提示词（含上下文）
      const systemPrompt = this.buildFlatSystemPrompt(spec, context);
      agent.systemPromptOverride = systemPrompt;

      // 5. 带超时执行
      const result = await Promise.race([
        agent.execute({
          taskId: `flat-${spec.id}`,
          taskDescription: spec.description,
          workdir: process.cwd(),
          options: {
            timeout: this.flatConfig.taskTimeoutMs,
            verbose: false,
          },
        }),
        this.createTimeoutPromise(spec.id, this.flatConfig.taskTimeoutMs),
      ]);

      const duration = Date.now() - startTime;

      // 5. 提取输出文本
      const outputText = this.extractOutputText(result);
      const isSuccess =
        typeof result === 'object' &&
        result !== null &&
        'status' in result &&
        (result as { status: string }).status === 'success';

      instanceManager.transition(instanceId, isSuccess ? 'completed' : 'failed');

      // 停止进度中继
      stopRelay();

      return {
        specId: spec.id,
        status: isSuccess ? 'success' : 'failure',
        output: outputText,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      log.warn('扁平子任务执行失败', {
        specId: spec.id,
        error: message,
        duration,
      });

      // 清理进度中继（如已设置）
      try {
        stopRelay?.();
      } catch {
        /* ignore */
      }
      // 尝试标记失败状态
      try {
        instanceManager.transition(instanceId, 'failed');
      } catch {
        // 实例可能尚未注册，忽略
      }

      return {
        specId: spec.id,
        status: 'failure',
        output: null,
        error: message,
        duration,
      };
    }
  }

  // ============ spawnWorker: 按类型创建单个 Worker ============

  /**
   * 按类型创建并执行单个 Worker
   *
   * @param typeId - Agent 类型 ID（如 'researcher', 'coder'）
   * @param taskDescription - 任务描述
   * @param options - 可选配置
   * @returns Worker 执行结果
   */
  async spawnWorker(
    typeId: string,
    taskDescription: string,
    options?: SpawnWorkerOptions
  ): Promise<WorkerResult> {
    const startTime = Date.now();
    const registry = getAgentTypeRegistry();
    const definition = registry.get(typeId);

    if (!definition) {
      return {
        instanceId: '',
        typeId,
        taskDescription,
        status: 'failure',
        output: null,
        artifacts: [],
        error: { code: 'UNKNOWN_TYPE', message: `Agent 类型 '${typeId}' 未找到`, retryable: false },
        duration: 0,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
        },
      };
    }

    const instanceManager = getAgentInstanceManager();
    const parentInstanceId = options?.parentInstanceId ?? '';
    const parentDepth =
      parentInstanceId && instanceManager.get(parentInstanceId)
        ? (instanceManager.get(parentInstanceId)?.depth ?? 0)
        : 0;
    const depth = parentDepth + 1;

    // 递归防护：检查全局深度限制
    if (depth > this.teamConfig.maxGlobalDepth) {
      log.warn('Worker 创建被拒绝：超过全局最大深度', {
        typeId,
        depth,
        maxGlobalDepth: this.teamConfig.maxGlobalDepth,
      });
      return {
        instanceId: '',
        typeId,
        taskDescription,
        status: 'failure',
        output: null,
        artifacts: [],
        error: {
          code: 'MAX_DEPTH_EXCEEDED',
          message: `深度 ${depth} 超过全局最大深度 ${this.teamConfig.maxGlobalDepth}`,
          retryable: false,
        },
        duration: 0,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
        },
      };
    }

    const taskId = options?.taskId ?? `worker-${typeId}-${Date.now()}`;
    const instanceId = `agent-${typeId}-${Date.now()}`;
    const timeoutMs = options?.timeoutMs ?? this.flatConfig.taskTimeoutMs;
    let worktreeInfo: WorktreeInfo | undefined;

    let stopRelay: (() => void) | undefined;
    try {
      // 1. 创建 Agent 实例
      const agent = createAgentFromType(
        definition,
        {
          instanceId,
          depth,
          task: {
            taskId,
            description: taskDescription,
            mode: 'sync',
            timeoutMs,
            inheritContext: options?.inheritContext ?? false,
          },
        },
        this.parentAgent,
        this.availableTools,
        this.teamConfig
      );

      // 2. 注册到 InstanceManager（含父子关联）
      instanceManager.register(
        definition,
        agent,
        {
          taskId,
          description: taskDescription,
          mode: 'sync',
          timeoutMs,
          inheritContext: options?.inheritContext ?? false,
        },
        parentInstanceId || null,
        depth
      );

      // 3. 监听子 Agent 进度事件，中继到 InstanceManager 驱动 UI 状态栏
      stopRelay = this.#relayAgentProgress(agent, instanceId);
      // 3. 构建系统提示词（注入父 Agent 信息）
      const promptCtx: Parameters<typeof definition.getSystemPrompt>[0] = {
        taskDescription,
        workdir: process.cwd(),
      };
      if (options?.context) {
        promptCtx.context = options.context;
      }
      const systemPrompt = definition.getSystemPrompt(promptCtx);

      // 注入 A2A 通信所需信息
      const enrichedPrompt = this.enrichSystemPrompt(
        systemPrompt,
        instanceId,
        parentInstanceId || null
      );
      agent.systemPromptOverride = enrichedPrompt;

      // 4. Worktree 隔离
      let effectiveOptions = options;

      if (options?.isolation === 'worktree' && getWorktreeManager()) {
        const wm = getWorktreeManager()!;
        worktreeInfo = await wm.create({
          slug: `${typeId}-${instanceId}`,
          createdBy: instanceId,
        });

        // 用包装器注入 worktree 上下文（与已有的 wrapExecute 链式组合）
        const innerWrapExecute = options.wrapExecute;
        effectiveOptions = { ...options };
        effectiveOptions.wrapExecute = (execute) => {
          const inner = innerWrapExecute ? () => innerWrapExecute(execute) : execute;
          return runInWorktree(
            {
              worktreeId: worktreeInfo!.id,
              worktreePath: worktreeInfo!.worktreePath,
              originalPath: worktreeInfo!.originalPath,
            },
            inner
          );
        };
      }

      // 5. 执行（支持 wrapExecute 注入运行时上下文）
      instanceManager.transition(instanceId, 'running');
      const workdir = worktreeInfo?.worktreePath ?? process.cwd();
      const executeFn = () =>
        agent.execute({
          taskId,
          taskDescription,
          workdir,
          options: {
            timeout: timeoutMs,
            verbose: false,
          },
        });

      const executePromise = effectiveOptions?.wrapExecute
        ? effectiveOptions.wrapExecute(executeFn)
        : executeFn();

      const result = await Promise.race([
        executePromise,
        this.createTimeoutPromise(taskId, timeoutMs),
      ]);

      const duration = Date.now() - startTime;

      // 6. 构建 WorkerResult
      const taskResult = result as unknown as {
        status: string;
        output: unknown;
        artifacts: unknown[];
        tokenUsage: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
          estimatedCostUsd: number;
        };
        error?: { code: string; message: string; retryable: boolean };
      };

      const outputText = this.extractOutputText(result);
      const isSuccess = taskResult.status === 'success';
      const isPartial = taskResult.status === 'partial';

      instanceManager.transition(
        instanceId,
        isSuccess ? 'completed' : isPartial ? 'completed' : 'failed'
      );

      const workerResult: WorkerResult = {
        instanceId,
        typeId,
        taskDescription,
        status: isSuccess ? 'success' : isPartial ? 'partial' : 'failure',
        output: outputText,
        artifacts: (taskResult.artifacts as WorkerResult['artifacts']) ?? [],
        duration,
        tokenUsage: taskResult.tokenUsage ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
        },
      };
      if (taskResult.error) {
        workerResult.error = {
          code: taskResult.error.code,
          message: taskResult.error.message,
          retryable: taskResult.error.retryable,
        };
      }
      return workerResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      log.warn('Worker 执行失败', { typeId, instanceId, error: message, duration });

      try {
        instanceManager.transition(instanceId, 'failed');
      } catch {
        // 忽略
      }

      return {
        instanceId,
        typeId,
        taskDescription,
        status: 'failure',
        output: null,
        artifacts: [],
        error: { code: 'EXECUTION_ERROR', message, retryable: false },
        duration,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
        },
      };
    } finally {
      // 停止进度中继
      try {
        stopRelay?.();
      } catch {
        /* ignore */
      }
      // 清理 systemPromptOverride
      try {
        const instance = instanceManager.get(instanceId);
        if (instance) {
          instance.agent.systemPromptOverride = null;
        }
      } catch {
        // 忽略
      }

      // Worktree 自动清理
      if (worktreeInfo) {
        const wm = getWorktreeManager();
        if (wm) {
          try {
            const cleanResult = await wm.autoCleanIfNoChanges(worktreeInfo.id);
            if (!cleanResult.cleaned) {
              log.info('Worktree 有变更，保留', {
                id: worktreeInfo.id,
                path: cleanResult.worktreePath,
              });
            }
          } catch (err) {
            log.warn('Worktree 清理失败', {
              id: worktreeInfo.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }
  }

  // ============ spawnTeam: Coordinator + Workers 模式 ============

  /**
   * 程序化执行 Team 任务（Coordinator + Workers）
   *
   * 创建一个 Coordinator 和多个 Worker，并行执行 Worker 后聚合结果。
   * 适用于代码直接调用（非 LLM 自主编排）场景。
   *
   * @param taskDescription - 团队任务描述
   * @param workerSpecs - Worker 规格列表
   * @returns Team 执行结果
   */
  async spawnTeam(taskDescription: string, workerSpecs: WorkerSpec[]): Promise<TeamResult> {
    const teamId = `team-${Date.now()}-${++this.teamCounter}`;
    log.info('创建 Team', { teamId, workerCount: workerSpecs.length, taskDescription });

    const workerResults: WorkerResult[] = [];

    // 并行启动所有 Worker
    const batchSize = this.flatConfig.maxConcurrent;
    for (let i = 0; i < workerSpecs.length; i += batchSize) {
      const batch = workerSpecs.slice(i, i + batchSize);
      const batchPromises = batch.map((spec) =>
        this.spawnWorker(spec.typeId, spec.taskDescription, {
          ...spec.options,
          context: taskDescription,
          parentInstanceId: '', // root coordinator 的 ID 为空
        })
      );
      const batchResults = await Promise.all(batchPromises);
      workerResults.push(...batchResults);
    }

    return aggregateResults(teamId, workerResults);
  }

  // ============ 辅助方法 ============

  /**
   * 监听子 Agent 进度事件并中继到 InstanceManager
   *
   * 在子 Agent 执行工具调用时，更新其 AgentInstance 的 currentActivity，
   * 驱动 UI 状态栏实时展示子 Agent 当前操作。
   *
   * @param agent - 子 Agent 实例
   * @param instanceId - 对应的 InstanceManager 实例 ID
   * @returns 清理函数，调用后移除事件监听
   */
  #relayAgentProgress(agent: LlmBasedAgent, instanceId: string): () => void {
    const progressHandler = (event: { taskId: string; percent: number; message: string }) => {
      const instanceManager = getAgentInstanceManager();
      const instance = instanceManager.get(instanceId);
      if (!instance) return;

      if (event.percent === 0) {
        // 工具开始：更新当前活动信息
        const prevUses = instance.currentActivity?.toolUses ?? 0;

        // 解析工具名称和参数
        // Exec 工具使用 $ <command> 格式，其他工具使用 ToolName(args) 格式
        let namePart: string;
        let argsPart: string | undefined;
        if (event.message.startsWith('$ ')) {
          namePart = 'Exec';
          argsPart = event.message.slice(2);
        } else {
          const parenIdx = event.message.indexOf('(');
          namePart = parenIdx > 0 ? event.message.slice(0, parenIdx) : event.message;
          argsPart = parenIdx > 0 ? event.message.slice(parenIdx + 1, -1) : undefined;
        }

        const activity: AgentCurrentActivity = {
          toolName: namePart,
          toolUses: prevUses + 1,
          ...(argsPart !== undefined ? { args: argsPart } : {}),
          startedAt: Date.now(),
        };

        instanceManager.setActivity(instanceId, activity);
      } else if (event.percent === 100 || event.percent === -1) {
        // 工具结束或取消：不清除 activity，保留最后状态供 UI 查看
        // 后续新工具开始时 toolUses 会继续累加
      }
    };

    agent.on(agent.EVENT_PROGRESS, progressHandler);

    // 返回清理函数
    return () => {
      agent.off(agent.EVENT_PROGRESS, progressHandler);
    };
  }

  /**
   * 为扁平子 Agent 构建系统提示词
   */
  private buildFlatSystemPrompt(spec: SubAgentSpec, context?: string): string {
    const parts: string[] = [
      '你是一个子 Agent，负责执行一项独立任务。',
      '',
      `## 任务`,
      spec.description,
    ];

    if (context) {
      parts.push('');
      parts.push('## 背景');
      parts.push(context);
    }

    parts.push('');
    parts.push('## 规则');
    parts.push('- 专注于你的任务，不要尝试处理不相关的事情');
    parts.push('- 完成后直接返回结果，不需要向用户汇报');
    parts.push('- 使用你拥有的工具完成任务');

    return parts.join('\n');
  }

  /**
   * 在系统提示词中注入 A2A 通信所需信息
   */
  private enrichSystemPrompt(
    prompt: string,
    instanceId: string,
    parentInstanceId: string | null | undefined
  ): string {
    const parts = [prompt];

    parts.push('');
    parts.push('## Agent 元信息');
    parts.push(`- 你的实例 ID: \`${instanceId}\``);
    if (parentInstanceId) {
      parts.push(`- 父 Agent 实例 ID: \`${parentInstanceId}\``);
      parts.push(
        '- 如需向父 Agent 提问或报告进度，使用 SendMessage 工具（toAgentId 设为父 Agent 的实例 ID）'
      );
    }

    return parts.join('\n');
  }

  /**
   * 从执行结果中提取输出文本
   */
  private extractOutputText(result: unknown): string | null {
    if (typeof result === 'object' && result !== null && 'output' in result) {
      const output = (result as { output: unknown }).output;
      if (typeof output === 'string') {
        return this.truncateOutput(output);
      }
      if (output != null) {
        return this.truncateOutput(JSON.stringify(output));
      }
    }
    return null;
  }

  /**
   * 截断输出文本
   */
  private truncateOutput(text: string): string {
    const maxChars = this.teamConfig.maxAggregateOutputChars || this.flatConfig.maxOutputChars;
    if (text.length <= maxChars) {
      return text;
    }
    const truncated = text.slice(0, maxChars);
    const remaining = text.length - maxChars;
    return `${truncated}\n\n[... 输出已截断，剩余 ${remaining} 字符 ...]`;
  }

  /**
   * 创建超时 Promise
   */
  private createTimeoutPromise(id: string, timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`任务 "${id}" 执行超时（${timeoutMs / 1000}秒）`));
      }, timeoutMs);
    });
  }

  /**
   * 构建扁平执行结果汇总（Markdown 格式）
   */
  private buildFlatSummary(results: SubAgentResultEntry[]): string {
    const lines: string[] = [
      '## 子任务执行汇总',
      '',
      '| 状态 | 任务 ID | 耗时 | 输出摘要 |',
      '|------|---------|------|----------|',
    ];

    for (const r of results) {
      const statusIcon = r.status === 'success' ? '✅' : '❌';
      const durationSec = r.duration != null ? (r.duration / 1000).toFixed(1) : 'N/A';
      const outputPreview = r.output
        ? r.output.slice(0, 80).replace(/\\/g, '\\\\').replace(/\n/g, ' ').replace(/\|/g, '\\|')
        : r.error
          ? `错误: ${r.error.slice(0, 60)}`
          : '（无输出）';

      lines.push(`| ${statusIcon} | ${r.specId} | ${durationSec}s | ${outputPreview} |`);
    }

    const succeeded = results.filter((r) => r.status === 'success').length;
    lines.push('');
    lines.push(
      `**总计**: ${results.length} 个任务, ${succeeded} 成功, ${results.length - succeeded} 失败`
    );

    // 附加每个成功任务的详细输出
    const successResults = results.filter((r) => r.status === 'success' && r.output);
    if (successResults.length > 0) {
      lines.push('');
      lines.push('---');
      lines.push('');
      for (const r of successResults) {
        lines.push(`### ${r.specId}`);
        lines.push('');
        if (r.output) lines.push(r.output);
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}
