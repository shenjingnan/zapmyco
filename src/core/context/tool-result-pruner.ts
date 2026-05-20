/**
 * 工具输出剪枝器
 *
 * 通过 transformContext hook 在每次 LLM 调用前自动剪枝旧工具输出，
 * 将完整输出替换为简短摘要，减少上下文占用。
 *
 * @module core/context
 */

import type { AgentMessage } from '@/core/agent-runtime/agent-types';
import type { ToolPruningConfig } from './types';
import { DEFAULT_TOOL_PRUNING_CONFIG } from './types';

// ============ 工具摘要生成 ============

/** 工具摘要格式映射 */
interface ToolSummaryRule {
  /** 工具名模式（支持前缀匹配） */
  pattern: string;
  /** 摘要生成器 */
  summarize: (msg: Record<string, unknown>) => string;
}

/**
 * 从 ToolResult 消息生成简短摘要
 *
 * 参考 Hermes-Agent 的工具输出剪枝策略
 */
const TOOL_SUMMARY_RULES: ToolSummaryRule[] = [
  {
    pattern: 'Read',
    summarize: (msg) => {
      const content = extractResultText(msg);
      const lines = content ? content.split('\n').length : 0;
      return `[已读取文件，${lines}行]`;
    },
  },
  {
    pattern: 'Bash',
    summarize: (msg) => {
      const isError = msg.isError === true;
      const exitInfo = isError ? '执行失败' : '执行完成';
      const content = extractResultText(msg);
      const lines = content ? content.split('\n').length : 0;
      return `[命令: ${exitInfo}, ${lines}行输出]`;
    },
  },
  {
    pattern: 'Grep',
    summarize: (msg) => {
      const content = extractResultText(msg);
      const lines = content ? content.split('\n').filter((l) => l.trim()).length : 0;
      return `[搜索完成, ${lines}处匹配]`;
    },
  },
  {
    pattern: 'Glob',
    summarize: (msg) => {
      const content = extractResultText(msg);
      const files = content ? content.split('\n').filter((l) => l.trim()).length : 0;
      return `[文件匹配完成, ${files}个文件]`;
    },
  },
  {
    pattern: 'WebFetch',
    summarize: (_msg) => `[网页抓取完成]`,
  },
  {
    pattern: 'WebSearch',
    summarize: (_msg) => `[网页搜索完成]`,
  },
  {
    pattern: 'Write',
    summarize: (_msg) => `[文件写入完成]`,
  },
  {
    pattern: 'Edit',
    summarize: (_msg) => `[文件编辑完成]`,
  },
  {
    pattern: 'TaskManage',
    summarize: (_msg) => `[任务管理操作完成]`,
  },
  {
    pattern: 'Memory',
    summarize: (_msg) => `[记忆操作完成]`,
  },
  {
    pattern: 'Skill',
    summarize: (msg) => {
      const content = extractResultText(msg);
      const nameMatch = content?.match(/^# Skill:\s*(\S+)/m);
      const name = nameMatch?.[1] ?? '';
      return name ? `[技能调用完成: ${name}]` : '[技能调用完成]';
    },
  },
  {
    pattern: 'SpawnSubAgents',
    summarize: (_msg) => `[子Agent执行完成]`,
  },
];

/** 默认摘要（未知工具） */
const DEFAULT_SUMMARY = '[工具执行完成]';

/**
 * 为指定工具消息生成摘要
 */
function summarizeToolResult(msg: Record<string, unknown>): string {
  const toolName = typeof msg.toolName === 'string' ? msg.toolName : '';
  const rule = TOOL_SUMMARY_RULES.find((r) => toolName.startsWith(r.pattern));
  return rule ? rule.summarize(msg) : DEFAULT_SUMMARY;
}

/**
 * 从 ToolResult 消息中提取文本内容
 */
function extractResultText(msg: Record<string, unknown>): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as Record<string, unknown>[])
      .filter((block) => block.type === 'text')
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .join('\n');
  }
  return '';
}

// ============ 剪枝器 ============

/**
 * 工具输出剪枝器
 *
 * 实现 transformContext 接口，在每次 LLM 调用前自动执行。
 * 策略：
 * - 保护最近 N 条消息（默认 10）
 * - 将旧工具结果内容替换为简短摘要
 * - 保留 toolCallId 以维持消息结构完整性
 * - 不调用 LLM，纯规则处理
 */
export class ToolResultPruner {
  private config: ToolPruningConfig;

  constructor(config?: Partial<ToolPruningConfig>) {
    this.config = { ...DEFAULT_TOOL_PRUNING_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ToolPruningConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * transformContext 实现
   *
   * @param messages - 当前对话消息列表
   * @returns 剪枝后的消息列表（原地修改 + 返回引用）
   */
  transform(messages: AgentMessage[]): AgentMessage[] {
    if (!this.config.enabled || messages.length === 0) return messages;
    if (messages.length <= this.config.protectLastMessages) return messages;

    const { protectLastMessages, maxSummaryLength } = this.config;
    const pruneEndIndex = messages.length - protectLastMessages;

    for (let i = 0; i < pruneEndIndex; i++) {
      const msg = messages[i] as Record<string, unknown> | undefined;
      if (!msg) continue;

      // 只处理 toolResult 类型的消息
      if (msg.role !== 'toolResult') continue;

      // 检查是否已经是简短的（已剪枝过）
      if (msg._pruned === true) continue;

      const summary = summarizeToolResult(msg);

      // 限制摘要长度
      const truncated =
        summary.length > maxSummaryLength
          ? `${summary.slice(0, maxSummaryLength - 3)}...`
          : summary;

      // 替换 content 为摘要文本
      msg.content = [{ type: 'text', text: truncated }];
      // 标记已剪枝
      msg._pruned = true;

      // 清除 details（减少序列化开销）
      if (msg.details !== undefined) {
        msg.details = undefined;
      }
    }

    return messages;
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<ToolPruningConfig> {
    return { ...this.config };
  }
}
