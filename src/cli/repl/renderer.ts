/**
 * 终端输出渲染器（TUI 适配版）
 *
 * 在 pi-tui 架构下，Renderer 不再直接 console.log，
 * 而是将格式化后的内容追加到 OutputArea 组件中。
 */

import type { ZapmycoConfig } from '../../config/types.js';
import type { FinalResult } from '../../core/result/types.js';
import type { TaskGraph } from '../../core/task/types.js';
import type { AgentRegistration } from '../../protocol/capability.js';
import type { HistoryEntry, ReplOptions, SessionStats } from './types.js';
import { OutputFormatter } from './components/output-area.js';

/**
 * 渲染器实现
 *
 * 协调 OutputFormatter 和 OutputArea 之间的内容输出。
 */
export class Renderer {
  private readonly formatter: OutputFormatter;

  constructor(opts: ReplOptions) {
    this.formatter = new OutputFormatter(opts.color);
  }

  /** 获取底层格式化器（供 OutputArea 直接使用） */
  getFormatter(): OutputFormatter {
    return this.formatter;
  }

  /** 渲染欢迎信息 → 返回格式化行 */
  renderWelcome(version: string): string[] {
    return this.formatter.formatWelcome(version);
  }

  /** 渲染错误信息 → 返回格式化行 */
  renderError(error: Error): string[] {
    return this.formatter.formatError(error);
  }

  /** 渲染最终执行结果 → 返回格式化行 */
  renderResult(result: FinalResult): string[] {
    return this.formatter.formatResult(result);
  }

  /** 渲染任务拆分概览 → 返回格式化行 */
  renderTaskGraph(graph: TaskGraph): string[] {
    return this.formatter.formatTaskGraph(graph);
  }

  /** 渲染 Agent 列表 → 返回格式化行 */
  renderAgents(agents: AgentRegistration[]): string[] {
    return this.formatter.formatAgents(agents);
  }

  /** 渲染配置信息 → 返回格式化行 */
  renderConfig(config: ZapmycoConfig): string[] {
    return this.formatter.formatConfig(config);
  }

  /** 渲染历史记录 → 返回格式化行 */
  renderHistory(entries: HistoryEntry[]): string[] {
    return this.formatter.formatHistory(entries);
  }

  /** 渲染会话状态 → 返回格式化行 */
  renderStatus(stats: SessionStats): string[] {
    return this.formatter.formatStatus(stats);
  }
}

/** 类型别名（供 session 内部引用） */
export type RendererImpl = Renderer;
