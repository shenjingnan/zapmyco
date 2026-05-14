/**
 * 对话日志记录器
 *
 * 将 LLM 请求和响应写入 ~/.zapmyco/logs/conversations/<sessionId>.jsonl，
 * 每行一个 turn，JSONL 格式。
 *
 * 默认关闭，通过 config.logging.recordConversation = true
 * 或环境变量 ZAPMYCO_LOG_CONVERSATION=1 开启。
 *
 * @module infra/conversation-logger
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@/infra/logger';

// ============ 工具函数 ============

/**
 * 从消息 content 中提取文本内容
 *
 * pi-ai 的消息 content 可能是 string（UserMessage）或 content blocks 数组（AssistantMessage），
 * 此函数统一处理两种格式，提取所有文本块并拼接。
 */
function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (block): block is { type: string; text?: string } =>
          typeof block === 'object' && block !== null && block.type === 'text'
      )
      .map((block) => block.text ?? '');
    return texts.length > 0 ? texts.join('') : null;
  }
  return null;
}

// ============ 类型定义 ============

/** 单次 LLM 交互消息 */
export interface ConversationMessage {
  role: string;
  content: string | null;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  toolCallId?: string;
  toolResult?: string;
}

/** 单次 LLM 交互轮次 */
export interface ConversationTurn {
  turn: number;
  model: string;
  timestamp: string;
  durationMs: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    estimatedCostUsd?: number;
  };
  messages: ConversationMessage[];
}

// ============ 默认值 ============

const DEFAULT_BASE_DIR = join(homedir(), '.zapmyco', 'logs', 'conversations');
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_ROTATIONS = 3;

// ============ ConversationLogger ============

export class ConversationLogger {
  private baseDir: string;
  private sessionId: string;
  private filePath: string;
  private enabled: boolean;
  private turnCount: number = 0;
  /** 上次已记录的消息数（用于增量记录） */
  private lastLoggedMessageCount: number = 0;

  constructor(options?: {
    baseDir?: string;
    sessionId?: string;
    enabled?: boolean;
  }) {
    this.baseDir = options?.baseDir ?? DEFAULT_BASE_DIR;
    this.sessionId = options?.sessionId ?? `session-${Date.now()}`;
    this.enabled = options?.enabled ?? false;
    this.filePath = join(this.baseDir, `${this.sessionId}.jsonl`);

    if (this.enabled) {
      this.ensureDir();
    }
  }

  /** 确保目录存在 */
  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /** 是否启用 */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 启用/禁用 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.ensureDir();
    }
  }

  /** 记录一次 LLM 交互轮次 */
  logTurn(turn: ConversationTurn): void {
    if (!this.enabled) return;

    this.turnCount++;
    try {
      this.rotateIfNeeded();
      const line = JSON.stringify({ ...turn, turn: this.turnCount }) + '\n';
      appendFileSync(this.filePath, line, 'utf-8');
    } catch (err) {
      logger.warn('对话日志写入失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 记录一轮完整的 Agent 执行结果
   *
   * 从 agent-loop 的消息列表中提取所有新消息，按 turn 组织后写入。
   * 支持增量记录：多次调用会自动跳过已记录的消息。
   *
   * @param model - 模型名称
   * @param messages - 完整消息列表（来自 Agent.state.messages）
   * @param tokenUsage - Token 使用量
   * @param durationMs - 执行耗时
   */
  logExecution(
    model: string,
    messages: Array<{ role: string; content?: unknown; toolCalls?: unknown }>,
    tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      estimatedCostUsd?: number;
    },
    durationMs?: number
  ): void {
    if (!this.enabled || messages.length <= this.lastLoggedMessageCount) return;

    // 提取新消息
    const newMessages = messages.slice(this.lastLoggedMessageCount);
    this.lastLoggedMessageCount = messages.length;

    // 将新消息序列化为 ConversationMessage[]
    const convMessages: ConversationMessage[] = [];
    for (const msg of newMessages) {
      const entry: ConversationMessage = {
        role: msg.role,
        content: extractTextContent(msg.content),
      };

      // 提取 toolCalls（assistant 消息）
      if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
        entry.toolCalls = msg.toolCalls.map(
          (tc: { name?: string; function?: { name?: string }; args?: unknown }) => ({
            name: tc.name ?? tc.function?.name ?? 'unknown',
            args:
              typeof tc.args === 'object' && tc.args !== null
                ? (tc.args as Record<string, unknown>)
                : {},
          })
        );
      }

      // 提取 toolCallId / toolResult（toolResult 消息）
      if (msg.role === 'toolResult' || msg.role === 'tool') {
        const m = msg as { toolCallId?: string; content?: string };
        if (m.toolCallId) {
          entry.toolCallId = m.toolCallId;
        }
        // toolResult 内容截断
        const toolResultContent =
          typeof m.content === 'string'
            ? m.content.slice(0, 1000)
            : m.content != null
              ? String(m.content).slice(0, 1000)
              : '';
        if (toolResultContent) {
          entry.toolResult = toolResultContent;
        }
      }

      convMessages.push(entry);
    }

    this.logTurn({
      turn: this.turnCount + 1,
      model,
      timestamp: new Date().toISOString(),
      durationMs: durationMs ?? 0,
      ...(tokenUsage ? { tokenUsage } : {}),
      messages: convMessages,
    });
  }

  /** 重置消息计数器（用于新的 execute() 调用） */
  resetMessageCount(): void {
    this.lastLoggedMessageCount = 0;
  }

  /** 获取当前会话文件路径 */
  get logFilePath(): string {
    return this.filePath;
  }

  // ============ 文件轮转 ============

  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const stats = statSync(this.filePath);
      if (stats.size < MAX_FILE_SIZE_BYTES) return;

      // 轮转：删除最旧的，其余重命名
      for (let i = MAX_ROTATIONS - 1; i >= 0; i--) {
        const oldPath = `${this.filePath}.${i}`;
        const newPath = `${this.filePath}.${i + 1}`;
        if (existsSync(oldPath)) {
          if (i === MAX_ROTATIONS - 1) {
            unlinkSync(oldPath);
          } else if (existsSync(newPath)) {
            renameSync(oldPath, newPath);
          }
        }
      }

      // 轮转当前文件
      renameSync(this.filePath, `${this.filePath}.0`);
    } catch (err) {
      logger.warn('对话日志文件轮转失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** 全局默认 ConversationLogger 实例 */
let _defaultLogger: ConversationLogger | null = null;

/**
 * 获取默认 ConversationLogger
 *
 * 在 startRepl() 中首次调用时初始化。
 */
export function getConversationLogger(): ConversationLogger {
  if (!_defaultLogger) {
    _defaultLogger = new ConversationLogger();
  }
  return _defaultLogger;
}

/**
 * 设置默认 ConversationLogger（仅用于测试）
 */
export function setConversationLogger(logger: ConversationLogger): void {
  _defaultLogger = logger;
}
