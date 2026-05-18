/**
 * Sub-Agent 管理器
 *
 * 负责子 Agent 的并行编排、生命周期管理和结果汇总。
 *
 * @module core/sub-agent
 */

import type { SubAgentConfig } from '@/config/types';
import type { LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import type { AgentOrchestrator } from '@/core/agent-team/agent-orchestrator';
import { logger } from '@/infra/logger';
import { runWithToolGuardContext, type ToolGuard } from '@/security/tool-guard';
import {
  buildSubAgentSystemPrompt,
  createSubAgent,
  type SubAgentInstance,
} from './sub-agent-factory';
import type { SubAgentResultEntry, SubAgentResults, SubAgentSpec } from './types';

const log = logger.child('sub-agent:manager');

/**
 * Sub-Agent 管理器
 *
 * 管理子 Agent 的完整生命周期：创建 → 并行执行 → 结果汇总 → 清理。
 */
export class SubAgentManager {
  private config: SubAgentConfig;
  private parentAgent: LlmBasedAgent;
  private availableTools: ToolRegistration[];
  private orchestrator: AgentOrchestrator | undefined;
  private toolGuard: ToolGuard | undefined;

  constructor(
    config: SubAgentConfig,
    parentAgent: LlmBasedAgent,
    availableTools: ToolRegistration[],
    orchestrator?: AgentOrchestrator,
    toolGuard?: ToolGuard
  ) {
    this.config = config;
    this.parentAgent = parentAgent;
    this.availableTools = availableTools;
    this.orchestrator = orchestrator;
    this.toolGuard = toolGuard;
  }

  /**
   * 批量并行执行子 Agent
   *
   * 使用固定并发池模式：当 specs 数量超过 maxConcurrent 时分批执行。
   * 每批内使用 Promise.all 并行，批次之间串行。
   *
   * @param specs - 子任务规格列表
   * @param context - 可选的背景摘要（注入到每个子 Agent 的系统提示）
   * @returns 结构化执行结果
   */
  async spawnAndWait(specs: SubAgentSpec[], context?: string): Promise<SubAgentResults> {
    // 如果配置了 AgentOrchestrator，委托给新编排器
    if (this.orchestrator) {
      log.info('委托给 AgentOrchestrator.spawnFlat()', { specCount: specs.length });
      return this.orchestrator.spawnFlat(specs, context);
    }

    // 原有逻辑保持不变
    const startTime = Date.now();
    log.info('开始批量执行子 Agent', {
      count: specs.length,
      maxConcurrent: this.config.maxConcurrent,
      hasContext: context != null,
      specs: specs.map((s) => ({
        id: s.id,
        description: s.description.slice(0, 200),
        allowedTools: s.allowedTools,
      })),
    });

    const allResults: SubAgentResultEntry[] = [];

    // 分批并行执行
    for (let i = 0; i < specs.length; i += this.config.maxConcurrent) {
      const batch = specs.slice(i, i + this.config.maxConcurrent);
      log.debug('执行子 Agent 批次', {
        batchStart: i,
        batchSize: batch.length,
        totalSpecs: specs.length,
      });

      const batchResults = await Promise.all(batch.map((spec) => this.executeOne(spec, context)));
      allResults.push(...batchResults);
    }

    const succeeded = allResults.filter((r) => r.status === 'success').length;
    const totalDuration = Date.now() - startTime;

    log.info('子 Agent 批量执行完成', {
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
      summary: this.buildSummary(allResults),
    };
  }

  /**
   * 执行单个子 Agent
   *
   * 包含超时保护、错误捕获和输出截断。
   */
  private async executeOne(spec: SubAgentSpec, context?: string): Promise<SubAgentResultEntry> {
    const startTime = Date.now();
    let subAgentInstance: SubAgentInstance | null = null;
    let progressTimer: ReturnType<typeof setInterval> | undefined;

    log.info('开始执行子 Agent', {
      specId: spec.id,
      description: spec.description.slice(0, 200),
      allowedTools: spec.allowedTools,
    });

    try {
      // 1. 创建隔离的子 Agent
      subAgentInstance = createSubAgent(
        spec,
        this.parentAgent,
        this.availableTools,
        this.config,
        context,
        this.toolGuard
      );

      // 2. 设置 isolated 系统提示词
      const systemPrompt = buildSubAgentSystemPrompt(spec, context);
      subAgentInstance.agent.systemPromptOverride = systemPrompt;

      // 3. 在后台 Agent 上下文中执行（带超时）
      //    后台上下文确保 ASK 动作自动降级为 DENY（无用户可交互）
      //    timeout 由 agent.execute() 内部通过 AbortController 处理
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const agent = subAgentInstance!.agent;
      const execStartTime = Date.now();

      // 3a. 启动进度监控定时器（每 60 秒报告一次执行状态）
      progressTimer = setInterval(() => {
        const state = agent.innerAgent.state;
        log.info('子 Agent 执行进度', {
          specId: spec.id,
          duration: Date.now() - startTime,
          messageCount: state.messages.length,
          pendingToolCallsCount: state.pendingToolCalls.size,
          isStreaming: state.isStreaming,
          turnCount: agent.tokenTracker.turnCount,
        });
      }, 60_000);

      const result = await runWithToolGuardContext({ isBackgroundAgent: true }, () =>
        agent.execute({
          taskId: `sub-${spec.id}`,
          taskDescription: spec.description,
          workdir: process.cwd(),
          options: {
            timeout: this.config.taskTimeoutMs,
            verbose: false,
          },
        })
      );

      const duration = Date.now() - startTime;
      const execDuration = Date.now() - execStartTime;

      // 4. 提取输出文本
      const output =
        typeof result === 'object' && result !== null && 'output' in result
          ? (result as { output: unknown }).output
          : null;
      const rawOutputLength =
        typeof output === 'string'
          ? output.length
          : output != null
            ? JSON.stringify(output).length
            : 0;

      const outputText =
        typeof output === 'string'
          ? this.truncateOutput(output)
          : output != null
            ? this.truncateOutput(JSON.stringify(output))
            : null;

      const taskResult = result as {
        status: string;
        tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
      };
      const isSuccess = taskResult.status === 'success';

      log.info('子 Agent 执行完成', {
        specId: spec.id,
        status: isSuccess ? 'success' : 'failure',
        duration,
        execDuration,
        rawOutputLength,
        truncatedOutputLength: outputText?.length ?? 0,
      });

      // 记录 token 使用量（如果有）
      const tokenUsage = taskResult.tokenUsage;
      if (tokenUsage) {
        log.debug('子 Agent Token 使用', {
          specId: spec.id,
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens,
        });
      }

      return {
        specId: spec.id,
        status: isSuccess ? 'success' : 'failure',
        output: outputText,
        duration,
        ...(tokenUsage ? { tokenUsage } : {}),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      // 收集 Agent 状态诊断信息（在超时等异常场景下特别有用）
      const agentState = subAgentInstance?.agent?.innerAgent.state;
      log.warn('子 Agent 执行失败', {
        specId: spec.id,
        error: message,
        duration,
        messageCount: agentState?.messages.length,
        pendingToolCallsCount: agentState?.pendingToolCalls.size,
        isStreaming: agentState?.isStreaming,
        hasError: !!agentState?.errorMessage,
      });

      return {
        specId: spec.id,
        status: 'failure',
        output: null,
        error: message,
        duration,
      };
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      // 6. 清理：移除系统提示词覆盖（帮助 GC）
      if (subAgentInstance) {
        subAgentInstance.agent.systemPromptOverride = null;
      }
    }
  }

  /**
   * 截断输出文本到 maxOutputChars
   */
  private truncateOutput(text: string): string {
    if (text.length <= this.config.maxOutputChars) {
      return text;
    }
    const truncated = text.slice(0, this.config.maxOutputChars);
    const remaining = text.length - this.config.maxOutputChars;
    return `${truncated}\n\n[... 输出已截断，剩余 ${remaining} 字符 ...]`;
  }

  /**
   * 构建人类可读的结果汇总
   */
  private buildSummary(results: SubAgentResultEntry[]): string {
    const lines: string[] = [
      `## 子任务执行汇总`,
      '',
      `| 状态 | 任务 ID | 耗时 | 输出摘要 |`,
      `|------|---------|------|----------|`,
    ];

    for (const r of results) {
      const statusIcon = r.status === 'success' ? '✅' : '❌';
      const durationSec = (r.duration / 1000).toFixed(1);
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
        lines.push(r.output!);
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}
