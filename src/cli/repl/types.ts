/**
 * REPL 核心类型定义
 */

import type { ZapmycoConfig } from '@/config/types';
import type { FinalResult } from '@/core/result/types';
import type { TaskGraph } from '@/core/task/types';

// ============ 输入解析类型 ============

/** 用户输入的解析结果 */
export type ParsedInput =
  | { kind: 'command'; name: string; args: string[] }
  | { kind: 'goal'; rawInput: string }
  | { kind: 'empty' }
  | { kind: 'incomplete'; buffer: string };

// ============ 命令系统类型 ============

/** 内置命令处理器签名 */
export type CommandHandler = (args: string[], session: ReplSession) => Promise<void> | void;

/** 内置命令描述 */
export interface CommandDefinition {
  /** 命令名称（不含 / 前缀） */
  name: string;
  /** 别名列表（不含 / 前缀） */
  aliases: string[];
  /** 命令描述 */
  description: string;
  /** 用法说明 */
  usage: string;
  /** 命令处理器 */
  handler: CommandHandler;
}

// ============ 历史记录类型 ============

/** 会话历史条目 */
export interface HistoryEntry {
  /** 条目序号 */
  id: number;
  /** 时间戳 */
  timestamp: number;
  /** 用户原始输入 */
  input: string;
  /** 关联的目标 ID（目标执行时填充） */
  goalId?: string;
  /** 执行耗时（毫秒，目标执行时填充） */
  durationMs?: number;
}

// ============ 会话状态类型 ============

/** 会话状态 */
export type SessionState = 'idle' | 'executing' | 'shutting-down';

// ============ REPL 配置类型 ============

/** REPL 配置选项 */
export interface ReplOptions {
  /** 是否启用颜色输出 */
  color: boolean;
  /** 是否调试模式 */
  debug: boolean;
  /** 历史记录最大条数 */
  maxHistorySize: number;
  /** 主提示符（保留用于格式化显示） */
  prompt: string;
  /** 续行提示符（多行输入时） */
  continuationPrompt: string;
}

// ============ 会话状态信息（用于 /status 展示） ============

/** 会话统计信息 */
export interface SessionStats {
  /** 总请求数 */
  totalRequests: number;
  /** 成功数 */
  successCount: number;
  /** 失败数 */
  failureCount: number;
  /** 总 Token 消耗 */
  totalTokens: number;
  /** 总成本估算（美元） */
  totalCostUsd: number;
  /** 当前状态 */
  state: SessionState;
}

// ============ ReplSession 接口（用于命令 handler 引用） ============

/**
 * REPL 会话接口
 *
 * 命令处理器通过此接口与 REPL 会话交互。
 * 定义为接口以避免循环依赖。
 */
export interface ReplSession {
  /** 当前会话状态 */
  readonly currentState: SessionState;
  /** REPL 配置选项（只读） */
  readonly replOptions: Readonly<ReplOptions>;
  /** 当前加载的配置（只读） */
  readonly config: Readonly<ZapmycoConfig>;

  /** 优雅关闭会话 */
  shutdown(reason?: string): Promise<void>;

  /** 获取渲染器引用 */
  getRenderer(): Renderer;

  /** 获取历史存储引用 */
  getHistoryStore(): HistoryStore;

  /** 获取会话统计 */
  getStats(): SessionStats;

  /** 执行用户目标（预留接口） */
  executeGoal(rawInput: string): Promise<FinalResult>;

  /** 将内容追加到输出区域 */
  appendOutput(lines: string[]): void;

  /** 清空输出区域 */
  clearOutput(): void;

  /** 请求 TUI 重绘 */
  requestRender(): void;

  /** 内部：获取命令注册表（供 help 命令使用） */
  getCommandRegistry(): unknown;

  /** 内部：获取输入解析器（供 clear 命令使用） */
  getInputParser(): unknown;
}

// ============ 渲染器接口 ============

/**
 * 终端输出渲染器接口
 *
 * TUI 模式下所有方法返回格式化字符串数组，由 OutputArea 渲染。
 */
export interface Renderer {
  /** 渲染欢迎信息 → 返回格式化行 */
  renderWelcome(version: string): string[];

  /** 渲染错误信息 → 返回格式化行 */
  renderError(error: Error): string[];

  /** 渲染最终执行结果 → 返回格式化行 */
  renderResult(result: FinalResult): string[];

  /** 渲染任务拆分概览 → 返回格式化行 */
  renderTaskGraph(graph: TaskGraph): string[];

  /** 渲染 Agent 列表 → 返回格式化行 */
  renderAgents(agents: import('@/protocol/capability').AgentRegistration[]): string[];

  /** 渲染配置信息 → 返回格式化行 */
  renderConfig(config: ZapmycoConfig): string[];

  /** 渲染历史记录 → 返回格式化行 */
  renderHistory(entries: HistoryEntry[]): string[];

  /** 渲染会话状态 → 返回格式化行 */
  renderStatus(stats: SessionStats): string[];
}

// ============ 历史存储接口 ============

/**
 * 会话历史存储接口
 */
export interface HistoryStore {
  /** 添加条目 */
  push(entry: Omit<HistoryEntry, 'id'>): HistoryEntry;

  /** 获取所有条目 */
  getAll(): HistoryEntry[];

  /** 获取最近 n 条 */
  getLast(n: number): HistoryEntry[];

  /** 清空所有条目 */
  clear(): void;

  /** 搜索条目 */
  search(query: string): HistoryEntry[];
}
