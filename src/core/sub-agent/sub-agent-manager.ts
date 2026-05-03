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
import { logger } from '@/infra/logger';
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

  constructor(
    config: SubAgentConfig,
    parentAgent: LlmBasedAgent,
    availableTools: ToolRegistration[]
  ) {
    this.config = config;
    this.parentAgent = parentAgent;
    this.availableTools = availableTools;
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
    const startTime = Date.now();
    log.info('开始批量执行子 Agent', {
      count: specs.length,
      maxConcurrent: this.config.maxConcurrent,
      hasContext: context != null,
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

    try {
      // 1. 创建隔离的子 Agent
      subAgentInstance = createSubAgent(
        spec,
        this.parentAgent,
        this.availableTools,
        this.config,
        context
      );

      // 2. 设置 isolated 系统提示词
      const systemPrompt = buildSubAgentSystemPrompt(spec, context);
      subAgentInstance.agent.systemPromptOverride = systemPrompt;

      // 3. 带超时的执行
      const result = await Promise.race([
        subAgentInstance.agent.execute({
          taskId: `sub-${spec.id}`,
          taskDescription: spec.description,
          workdir: process.cwd(),
          options: {
            timeout: this.config.taskTimeoutMs,
            verbose: false,
          },
        }),
        this.createTimeoutPromise(spec.id, this.config.taskTimeoutMs),
      ]);

      const duration = Date.now() - startTime;

      // 4. 提取输出文本
      const output =
        typeof result === 'object' && result !== null && 'output' in result
          ? (result as { output: unknown }).output
          : null;
      const outputText =
        typeof output === 'string'
          ? this.truncateOutput(output)
          : output != null
            ? this.truncateOutput(JSON.stringify(output))
            : null;

      const isSuccess =
        typeof result === 'object' &&
        result !== null &&
        'status' in result &&
        (result as { status: string }).status === 'success';

      return {
        specId: spec.id,
        status: isSuccess ? 'success' : 'failure',
        output: outputText,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      log.warn('子 Agent 执行失败', {
        specId: spec.id,
        error: message,
        duration,
      });

      return {
        specId: spec.id,
        status: 'failure',
        output: null,
        error: message,
        duration,
      };
    } finally {
      // 5. 清理：移除系统提示词覆盖（帮助 GC）
      if (subAgentInstance) {
        subAgentInstance.agent.systemPromptOverride = null;
      }
    }
  }

  /**
   * 创建超时 Promise
   */
  private createTimeoutPromise(specId: string, timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`子任务 "${specId}" 执行超时（${timeoutMs / 1000}秒）`));
      }, timeoutMs);
    });
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
        ? r.output.slice(0, 80).replace(/\n/g, ' ').replace(/\|/g, '\\|')
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
