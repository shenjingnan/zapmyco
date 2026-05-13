/**
 * 自动压缩器
 *
 * 当 token 用量接近上限时，使用 LLM 生成对话摘要，
 * 替换旧的对话历史，保持上下文在窗口限制内。
 *
 * @module core/context
 */

import { complete as piComplete } from '@mariozechner/pi-ai';
import type { Agent } from '@/core/agent-runtime/agent';
import type { AgentMessage } from '@/core/agent-runtime/agent-types';
import { logger } from '@/infra/logger';
import type { AgentLlmFacade } from '@/llm/agent-llm-facade';
import { buildCompactionPrompt, buildSummaryMessage } from './compaction-prompt';
import { estimateMessagesTokens } from './token-tracker';
import type { CompactionConfig, CompactionResult, ContextWindowInfo } from './types';
import { DEFAULT_COMPACTION_CONFIG } from './types';

const log = logger.child('core:compactor');

/** 连续压缩节省比例阈值（低于此值认为压缩无效） */
const ANTI_THRASH_SAVINGS_THRESHOLD = 0.1;
/** 连续追踪的最大压缩次数 */
const ANTI_THRASH_WINDOW = 2;

/**
 * 自动压缩器
 *
 * 负责决策、执行和验证对话压缩。
 */
export class Compactor {
  private config: CompactionConfig;
  private llmFacade: AgentLlmFacade | null = null;

  /** 最近 N 次压缩的节省比例（用于反抖检测） */
  private recentSavings: number[] = [];

  /** 上一次压缩后留下的摘要消息 ID（用于迭代更新） */
  private lastSummaryText: string | undefined;

  constructor(config?: Partial<CompactionConfig>, llmFacade?: AgentLlmFacade) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
    this.llmFacade = llmFacade ?? null;
  }

  /**
   * 设置 LLM Facade
   */
  setLlmFacade(facade: AgentLlmFacade): void {
    this.llmFacade = facade;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CompactionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 判断是否应该触发自动压缩
   *
   * @param agent - pi-agent-core Agent 实例
   * @param contextInfo - 上下文窗口信息
   * @returns 是否应该压缩
   */
  shouldCompact(agent: Agent, contextInfo: ContextWindowInfo): boolean {
    if (!this.config.enabled || !this.config.autoTrigger) return false;

    const messages = agent.state.messages;
    if (messages.length === 0) return false;

    // 估算当前 token 用量
    const estimatedTokens = estimateMessagesTokens(messages);

    // 判断是否达到阈值
    const reachedThreshold =
      estimatedTokens >= contextInfo.effectiveWindow * this.config.thresholdPercent;

    if (!reachedThreshold) return false;

    // 反抖保护
    if (this.config.antiThrashEnabled && this.isThrashing()) {
      log.warn('自动压缩反抖保护：最近压缩效果不佳，跳过自动压缩');
      return false;
    }

    return true;
  }

  /**
   * 执行压缩
   *
   * @param agent - pi-agent-core Agent 实例
   * @param contextInfo - 上下文窗口信息
   * @param emergency - 是否为紧急模式（保护更少消息）
   * @returns 压缩结果
   */
  async compact(
    agent: Agent,
    _contextInfo: ContextWindowInfo,
    emergency = false
  ): Promise<CompactionResult> {
    const startTime = Date.now();
    const messages = agent.state.messages;
    const beforeCount = messages.length;
    const beforeTokens = estimateMessagesTokens(messages);

    try {
      // 1. 确定压缩边界
      const boundary = this.findCompactBoundary(messages, emergency);

      if (boundary.headMessages.length === 0) {
        // 没有需要压缩的消息（头部为空）
        return {
          beforeMessageCount: beforeCount,
          afterMessageCount: beforeCount,
          beforeEstimatedTokens: beforeTokens,
          afterEstimatedTokens: beforeTokens,
          savingsRatio: 0,
          success: true,
          durationMs: Date.now() - startTime,
        };
      }

      // 2. 生成摘要
      const summaryText = await this.summarize(boundary.headMessages, this.lastSummaryText);

      if (!summaryText || summaryText.trim().length === 0) {
        throw new Error('摘要生成为空');
      }

      // 3. 构建摘要消息
      const fullSummaryText = buildSummaryMessage(summaryText);
      const summaryMessage: AgentMessage = {
        role: 'summary',
        text: fullSummaryText,
        timestamp: Date.now(),
      } as AgentMessage;

      // 4. 替换消息列表
      const newMessages = [summaryMessage, ...boundary.tailMessages];
      agent.state.messages = newMessages;

      // 5. 更新状态
      this.lastSummaryText = summaryText;
      const afterTokens = estimateMessagesTokens(newMessages);
      const savingsRatio = beforeTokens > 0 ? (beforeTokens - afterTokens) / beforeTokens : 0;

      // 记录节省比例（用于反抖检测）
      this.recentSavings.push(savingsRatio);
      if (this.recentSavings.length > ANTI_THRASH_WINDOW) {
        this.recentSavings.shift();
      }

      log.info('对话压缩完成', {
        beforeMessages: beforeCount,
        afterMessages: newMessages.length,
        beforeTokens: beforeTokens,
        afterTokens: afterTokens,
        savingsRatio: `${(savingsRatio * 100).toFixed(1)}%`,
        emergency,
        durationMs: Date.now() - startTime,
      });

      return {
        beforeMessageCount: beforeCount,
        afterMessageCount: newMessages.length,
        beforeEstimatedTokens: beforeTokens,
        afterEstimatedTokens: afterTokens,
        savingsRatio,
        success: true,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('对话压缩失败', { error: message, emergency });

      return {
        beforeMessageCount: beforeCount,
        afterMessageCount: beforeCount,
        beforeEstimatedTokens: beforeTokens,
        afterEstimatedTokens: beforeTokens,
        savingsRatio: 0,
        success: false,
        durationMs: Date.now() - startTime,
        error: message,
      };
    }
  }

  /**
   * 确定压缩边界
   *
   * 返回应被压缩的头部消息和应保留的尾部消息。
   * 确保：
   * - 头部系统消息保留
   * - 尾部最近消息保留（按 token 预算或消息数）
   * - 不切割 tool_use/tool_result 配对
   * - 最新 user 消息始终在尾部
   */
  private findCompactBoundary(
    messages: AgentMessage[],
    emergency: boolean
  ): {
    headMessages: AgentMessage[];
    tailMessages: AgentMessage[];
  } {
    const protectCount = emergency
      ? Math.max(5, Math.floor(this.config.protectLastMessages / 2))
      : this.config.protectLastMessages;

    // 头部始终保留前 2 条（通常是系统消息相关）
    const headPreserve = 2;

    // 从尾部向前扫描，找到保护边界
    let tailStartIndex = Math.max(headPreserve, messages.length - protectCount);

    // 按 token 预算进一步调整
    const preserveBudget = emergency
      ? Math.floor(this.config.preserveRecentTokens / 2)
      : this.config.preserveRecentTokens;

    let tailTokens = 0;
    for (let i = messages.length - 1; i >= headPreserve; i--) {
      const msg = messages[i];
      if (!msg) continue;

      const msgTokens = estimateMessagesTokens([msg]);
      if (tailTokens + msgTokens > preserveBudget) {
        tailStartIndex = Math.max(headPreserve, i + 1);
        break;
      }
      tailTokens += msgTokens;
      tailStartIndex = i;
    }

    // 确保最新 user 消息在尾部
    tailStartIndex = this.ensureLastUserInTail(messages, tailStartIndex, headPreserve);

    // 对齐边界，不切割 tool_use/tool_result 配对
    tailStartIndex = this.alignToToolPairs(messages, tailStartIndex);

    return {
      headMessages: messages.slice(0, tailStartIndex),
      tailMessages: messages.slice(tailStartIndex),
    };
  }

  /**
   * 确保最新 user 消息在保留尾部中
   */
  private ensureLastUserInTail(
    messages: AgentMessage[],
    tailStartIndex: number,
    headPreserve: number
  ): number {
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = messages[i] as any as Record<string, unknown> | undefined;
      if (msg?.role === 'user') {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex >= 0 && lastUserIndex < tailStartIndex) {
      return Math.max(headPreserve, lastUserIndex);
    }

    return tailStartIndex;
  }

  /**
   * 对齐边界到 tool_use/tool_result 配对边界
   *
   * 如果 tailStartIndex 落在 toolResult 前面（其 toolCall 在头部），
   * 则将 toolResult 也移到头部。
   * 如果 tailStartIndex 以 orphan toolResult 开头，将其也移到头部。
   */
  private alignToToolPairs(messages: AgentMessage[], tailStartIndex: number): number {
    if (tailStartIndex >= messages.length) return tailStartIndex;

    let adjusted = tailStartIndex;

    // 检查尾部第一行是不是 orphan toolResult
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstTail = messages[adjusted] as any as Record<string, unknown> | undefined;
    if (firstTail?.role === 'toolResult') {
      const callId = firstTail.toolCallId;
      if (typeof callId === 'string') {
        // 检查其 tool_use 是否在头部
        let foundToolCall = false;
        for (let i = adjusted - 1; i >= 0; i--) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg = messages[i] as any as Record<string, unknown> | undefined;
          if (!msg) continue;
          if (msg.role === 'assistant') {
            const content = msg.content;
            if (Array.isArray(content)) {
              if (
                content.some(
                  (b) =>
                    b &&
                    typeof b === 'object' &&
                    (b as Record<string, unknown>).type === 'toolCall' &&
                    (b as Record<string, unknown>).id === callId
                )
              ) {
                foundToolCall = true;
              }
            }
          }
        }
        if (!foundToolCall) {
          // orphan toolResult，将其移到头部
          adjusted++;
        }
      }
    }

    return Math.min(adjusted, messages.length);
  }

  /**
   * 调用 LLM 生成摘要
   */
  private async summarize(messages: AgentMessage[], existingSummary?: string): Promise<string> {
    if (!this.llmFacade) {
      throw new Error('LLM Facade 未设置，无法生成摘要');
    }

    // 构建提示词
    const prompt = buildCompactionPrompt(existingSummary);

    // 解析摘要模型
    // 优先级：summaryModel → lightModel → defaultModel
    const summaryModelKey = this.config.summaryModel;
    const lightModelInfo = this.llmFacade.getLightModel();

    let model: ReturnType<typeof this.llmFacade.resolvePiModel>;
    if (summaryModelKey) {
      model = this.llmFacade.resolvePiModel(summaryModelKey);
    } else if (lightModelInfo && lightModelInfo.key !== this.llmFacade.getModelInfo()?.key) {
      // 使用 lightModel（仅当与默认模型不同时）
      model = this.llmFacade.resolvePiModel(lightModelInfo.key);
    } else {
      model = this.llmFacade.resolvePiModel();
    }

    // 过滤消息，减少无用的内容块
    const simplifiedMessages = messages.map((m) => this.simplifyMessage(m));

    // 过滤掉非标准角色（pi-ai 的 complete 只接受 user/assistant/toolResult）
    const llmMessages = simplifiedMessages.filter((m) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const role = (m as any).role as string | undefined;
      return role === 'user' || role === 'assistant' || role === 'toolResult';
    });

    try {
      const response = await piComplete(
        model,
        {
          systemPrompt: prompt,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: llmMessages as any,
        },
        {
          maxTokens: 4000,
          temperature: 0.3,
        }
      );

      // 提取文本内容
      if (Array.isArray(response.content)) {
        return response.content
          .filter(
            (block): block is { type: 'text'; text: string } =>
              typeof block === 'object' &&
              block !== null &&
              block.type === 'text' &&
              'text' in block
          )
          .map((block) => block.text)
          .join('');
      }

      if (typeof response.content === 'string') {
        return response.content;
      }

      return '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('摘要 LLM 调用失败', { error: message });

      // 如果辅助模型失败，依次尝试 lightModel → defaultModel
      if (summaryModelKey || lightModelInfo) {
        log.info('摘要模型调用失败，尝试回退模型');
        const defaultModel = this.llmFacade.resolvePiModel();
        let fallbackModel = defaultModel;

        // 如果 lightModel 和当前模型/默认模型都不同，优先尝试 lightModel
        if (
          lightModelInfo &&
          lightModelInfo.key !== model.id &&
          lightModelInfo.key !== defaultModel.id
        ) {
          try {
            fallbackModel = this.llmFacade.resolvePiModel(lightModelInfo.key);
          } catch {
            fallbackModel = defaultModel;
          }
        }

        const isSameModel = fallbackModel.id === model.id;
        if (isSameModel) throw error; // 已经是同一模型，不再重试

        const retryResponse = await piComplete(
          fallbackModel,
          {
            systemPrompt: prompt,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: llmMessages as any,
          },
          {
            maxTokens: 4000,
            temperature: 0.3,
          }
        );

        if (Array.isArray(retryResponse.content)) {
          return retryResponse.content
            .filter(
              (block): block is { type: 'text'; text: string } =>
                typeof block === 'object' &&
                block !== null &&
                block.type === 'text' &&
                'text' in block
            )
            .map((block) => block.text)
            .join('');
        }

        if (typeof retryResponse.content === 'string') {
          return retryResponse.content;
        }
      }

      throw error;
    }
  }

  /**
   * 简化消息内容，移除无用的 blocks（如图片、base64 数据等）
   */
  private simplifyMessage(msg: AgentMessage): AgentMessage {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = msg as any as Record<string, unknown>;

    if (!Array.isArray(m.content)) return msg;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const simplified = (m.content as any[]).map((block: unknown) => {
      if (!block || typeof block !== 'object') return block as Record<string, unknown>;
      const b = block as Record<string, unknown>;

      // 保留文本和思考内容
      if (b.type === 'text' || b.type === 'thinking') return b;

      // toolCall: 保留但简化参数
      if (b.type === 'toolCall') {
        return {
          type: 'toolCall',
          id: b.id,
          name: b.name,
          arguments: b.arguments,
        };
      }

      // 图片等：替换为简短占位符
      if (b.type === 'image') {
        return { type: 'text', text: '[图片]' };
      }

      return b;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...msg, content: simplified } as any as AgentMessage;
  }

  /**
   * 反抖检测：最近压缩是否无效
   */
  private isThrashing(): boolean {
    if (this.recentSavings.length < ANTI_THRASH_WINDOW) return false;
    return this.recentSavings.every((ratio) => ratio < ANTI_THRASH_SAVINGS_THRESHOLD);
  }

  /**
   * 重置压缩器状态（新会话时）
   */
  reset(): void {
    this.recentSavings = [];
    this.lastSummaryText = undefined;
  }
}
