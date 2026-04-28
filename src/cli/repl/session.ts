/**
 * REPL 会话核心（pi-tui 版）
 *
 * 使用 @mariozechner/pi-tui 框架替代 readline，
 * 实现完整的 TUI 交互式 REPL：
 * - Editor 组件自带上下边框
 * - 差量渲染，无闪烁
 * - 组件化布局，可扩展
 */

import { Container, ProcessTerminal, Text, TUI } from '@mariozechner/pi-tui';
import type { ZapmycoConfig } from '@/config/types';
import { __VERSION__ } from '@/infra/constants';
import { eventBus } from '@/infra/event-bus';
import { logger } from '@/infra/logger';
import { CommandRegistry } from './command-registry.js';
import { createAgentsCommand } from './commands/agents-cmd.js';
import { createClearCommand } from './commands/clear.js';
import { createConfigCommand } from './commands/config-cmd.js';
// 导入内置命令
import { createHelpCommand } from './commands/help.js';
import { createHistoryCommand } from './commands/history.js';
import { createQuitCommand } from './commands/quit.js';
import { createStatusCommand } from './commands/status.js';
import { ZapmycoEditor } from './components/custom-editor.js';
import { HistoryStore as HistoryStoreClass } from './history-store.js';
import { InputParser } from './input-parser.js';
import { Renderer as RendererClass } from './renderer.js';
import { createTheme } from './theme.js';
import type {
  HistoryStore,
  ParsedInput,
  ReplOptions,
  SessionState,
  SessionStats,
} from './types.js';

const log = logger.child('repl:session');

/**
 * 输出区域组件
 *
 * 管理所有输出内容的行缓冲，实现 pi-tui 的 render 接口。
 */
class OutputArea extends Container {
  private lines: string[] = [];

  override render(_width: number): string[] {
    return this.lines;
  }

  /** 追加多行内容 */
  append(lines: string[]): void {
    this.lines.push(...lines);
    this.invalidate();
  }

  /** 清空所有内容 */
  clear(): void {
    this.lines = [];
    this.invalidate();
  }
}

/** 默认提示符（用于显示/格式化） */
const DEFAULT_PROMPT = '\u276f ';

/** 默认续行提示符 */
const DEFAULT_CONTINUATION_PROMPT = '... ';

/**
 * REPL 会话实现
 */
export class ReplSession {
  private readonly tui: TUI;
  private readonly editor: ZapmycoEditor;
  private readonly outputArea: OutputArea;
  private readonly header: Text;
  private readonly footer: Text;
  private readonly options: ReplOptions;
  private _state: SessionState = 'idle';
  private readonly parser: InputParser;
  private readonly registry: CommandRegistry;
  private readonly renderer: RendererClass;
  private readonly history: HistoryStoreClass;
  private currentTaskAbort: AbortController | null = null;

  // 会话统计
  private stats: SessionStats = {
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    state: 'idle',
  };

  constructor(readonly config: ZapmycoConfig) {
    this.options = {
      color: config.cli.color,
      debug: config.cli.debug,
      maxHistorySize: 100,
      prompt: DEFAULT_PROMPT,
      continuationPrompt: DEFAULT_CONTINUATION_PROMPT,
    };

    // 创建主题
    const theme = createTheme(this.options.color);

    // 初始化 TUI
    const terminal = new ProcessTerminal();
    this.tui = new TUI(terminal);

    // 创建组件
    this.header = new Text('', 1, 0);
    this.outputArea = new OutputArea();
    this.footer = new Text('', 1, 0);
    this.editor = new ZapmycoEditor(this.tui, theme.editorTheme);

    // 组装组件树：header → outputArea → footer → editor(带边框)
    const root = new Container();
    root.addChild(this.header);
    root.addChild(this.outputArea);
    root.addChild(this.footer);
    root.addChild(this.editor);

    this.tui.addChild(root);
    this.tui.setFocus(this.editor);

    this.parser = new InputParser();
    this.registry = new CommandRegistry(this);
    this.renderer = new RendererClass(this.options);
    this.history = new HistoryStoreClass(this.options.maxHistorySize);

    // 注册所有内置命令
    this.registerBuiltinCommands();

    // 绑定编辑器事件
    this.setupEditorHandlers();

    // 设置信号处理
    this.setupSignalHandlers();

    // 设置事件监听
    this.setupEventListeners();
  }

  // ============ 公共接口（IReplSession）============

  get currentState(): SessionState {
    return this._state;
  }

  get replOptions(): Readonly<ReplOptions> {
    return this.options;
  }

  /** 启动 REPL 循环 */
  async start(): Promise<void> {
    this._state = 'idle';
    this.updateStatsState();

    // 渲染欢迎信息到输出区域
    const welcomeLines = this.renderer.renderWelcome(__VERSION__);
    this.outputArea.append(welcomeLines);

    // 设置 header 和 footer
    this.updateHeader();
    this.updateFooter();

    // 启动 TUI
    this.tui.start();
  }

  /** 优雅关闭会话 */
  async shutdown(reason?: string): Promise<void> {
    if (this._state === 'shutting-down') {
      return;
    }

    this._state = 'shutting-down';
    this.updateStatsState();

    log.info('REPL 关闭', { reason: reason ?? '未知' });

    // 取消正在执行的任务
    this.cancelCurrentTask();

    // 发布关闭事件
    eventBus.emit('system:shutdown', { reason });

    // 停止 TUI
    this.tui.stop();
  }

  /** 获取渲染器引用 */
  getRenderer(): import('./types.js').Renderer {
    return this.renderer;
  }

  /** 获取历史存储引用 */
  getHistoryStore(): HistoryStore {
    return this.history;
  }

  /** 获取会话统计 */
  getStats(): SessionStats {
    return { ...this.stats };
  }

  /** 将内容追加到输出区域 */
  appendOutput(lines: string[]): void {
    this.outputArea.append(lines);
    this.tui.requestRender();
  }

  /** 清空输出区域 */
  clearOutput(): void {
    this.outputArea.clear();
    this.tui.requestRender();
  }

  /** 请求 TUI 重绘 */
  requestRender(): void {
    this.tui.requestRender();
  }

  /**
   * 执行用户目标
   *
   * 当前阶段：引擎尚未完全实现，返回模拟结果。
   * 预留 FinalResult 接口，对接引擎后替换为真实调用。
   */
  async executeGoal(rawInput: string): Promise<import('@/core/result/types').FinalResult> {
    const startTime = Date.now();
    let historyEntry: import('./types.js').HistoryEntry | undefined;

    try {
      // 更新状态
      this._state = 'executing';
      this.updateStatsState();
      this.updateFooter();

      // 记录到历史
      historyEntry = this.history.push({
        timestamp: Date.now(),
        input: rawInput,
      });

      // 发布目标提交事件
      eventBus.emit('goal:submitted', {
        goalId: `goal-${Date.now()}`,
        rawInput,
      });

      // ====== 当前阶段：占位实现 ======
      //
      // 未来对接流程：
      // 1. IntentEngine.parse(rawInput) → Goal
      // 2. TaskDecomposer.decompose(goal) → TaskGraph
      // 3. renderer.renderTaskGraph(graph)
      // 4. Scheduler.execute(graph) → 监听 ProgressEvent → renderer.renderProgress()
      // 5. ResultAggregator.aggregate(results) → FinalResult
      // 6. renderer.renderResult(finalResult)

      const goalLines: string[] = [
        '',
        `  🎯 目标: ${rawInput}`,
        '',
        `  ⏳ 任务执行引擎开发中，当前返回模拟结果...`,
        '',
      ];
      this.outputArea.append(goalLines);

      // 模拟短暂延迟（让用户看到处理过程）
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 返回模拟的 FinalResult
      const duration = Date.now() - startTime;
      const mockResult: import('@/core/result/types').FinalResult = {
        goalId: `goal-${startTime}`,
        overallStatus: 'success',
        summary: `[模拟] 已接收目标: ${rawInput.slice(0, 80)}${rawInput.length > 80 ? '...' : ''}`,
        taskResults: [],
        allArtifacts: [],
        totalDuration: duration,
        totalTokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        },
      };

      // 更新统计
      this.stats.totalRequests++;
      this.stats.successCount++;

      // 发布完成事件
      eventBus.emit('goal:completed', {
        goalId: mockResult.goalId,
        result: mockResult,
      });

      // 渲染结果到输出区域
      const resultLines = this.renderer.renderResult(mockResult);
      this.outputArea.append(resultLines);

      // 更新历史条目
      if (historyEntry) {
        historyEntry.goalId = mockResult.goalId;
        historyEntry.durationMs = duration;
      }

      return mockResult;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('目标执行失败', { input: rawInput }, err);

      this.stats.totalRequests++;
      this.stats.failureCount++;

      eventBus.emit('goal:failed', {
        goalId: `goal-${startTime}`,
        error: err,
      });

      // 渲染错误到输出区域
      const errorLines = this.renderer.renderError(err);
      this.outputArea.append(errorLines);

      // 返回失败结果
      const duration = Date.now() - startTime;
      return {
        goalId: `goal-${startTime}`,
        overallStatus: 'failure',
        summary: `执行失败: ${err.message}`,
        taskResults: [],
        allArtifacts: [],
        totalDuration: duration,
        totalTokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        },
      };
    } finally {
      this._state = 'idle';
      this.updateStatsState();
      this.updateFooter();
      this.currentTaskAbort = null;
    }
  }

  // ============ 内部方法（供命令处理器访问）============

  /** 获取命令注册表（供 help 命令使用） */
  getCommandRegistry(): unknown {
    return this.registry;
  }

  /** 获取输入解析器（供 clear 命令使用） */
  getInputParser(): unknown {
    return this.parser;
  }

  // ============ 输入处理核心 ============

  /**
   * 处理用户提交的输入
   *
   * 由 editor.onSubmit 触发。
   */
  async handleSubmit(line: string): Promise<void> {
    if (this._state === 'shutting-down') {
      return;
    }

    const parsed: ParsedInput = this.parser.parse(line);

    switch (parsed.kind) {
      case 'empty':
        // 空行：不做任何事
        break;

      case 'incomplete':
        // 多行续行：暂不特殊处理，后续可扩展
        break;

      case 'command': {
        // 命令分发
        await this.registry.dispatch(parsed);
        break;
      }

      case 'goal': {
        // 自然语言目标执行
        await this.executeGoal(parsed.rawInput);
        break;
      }
    }
  }

  // ============ 私有方法 ============

  /** 注册所有内置命令 */
  private registerBuiltinCommands(): void {
    this.registry.register(createHelpCommand());
    this.registry.register(createQuitCommand());
    this.registry.register(createClearCommand());
    this.registry.register(createHistoryCommand());
    this.registry.register(createConfigCommand());
    this.registry.register(createAgentsCommand());
    this.registry.register(createStatusCommand());
  }

  /** 设置编辑器事件绑定 */
  private setupEditorHandlers(): void {
    // 提交输入
    this.editor.onSubmit = (text) => void this.handleSubmit(text);

    // Ctrl+C
    let ctrlCPressCount = 0;
    let ctrlCTimer: ReturnType<typeof setTimeout> | undefined;

    this.editor.onCtrlC = () => {
      if (this._state === 'executing') {
        // 执行中：取消任务
        this.cancelCurrentTask();
        this.outputArea.append(['', '  任务已取消', '']);
        return;
      }

      // 空闲中：累计按键次数
      ctrlCPressCount++;
      if (ctrlCPressCount >= 2) {
        this.outputArea.append(['', '  再见！', '']);
        void this.shutdown('用户连续按下 Ctrl+C');
        return;
      }

      this.outputArea.append(['', '  (再次按下 Ctrl+C 可强制退出)', '']);

      clearTimeout(ctrlCTimer);
      ctrlCTimer = setTimeout(() => {
        ctrlCPressCount = 0;
      }, 3000);
    };

    // Ctrl+D
    this.editor.onCtrlD = () => {
      this.outputArea.append(['', '  再见！', '']);
      void this.shutdown('收到 EOF (Ctrl+D)');
    };
  }

  /** 设置信号处理 */
  private setupSignalHandlers(): void {
    process.on('SIGINT', () => {
      // 由 editor.onCtrlC 处理，这里防止进程意外退出
    });
  }

  /** 设置事件监听 */
  private setupEventListeners(): void {
    eventBus.on('system:shutdown', ({ reason }) => {
      log.debug(`收到系统关闭信号: ${reason ?? '未知'}`);
    });
  }

  /** 取消当前正在执行的任务 */
  private cancelCurrentTask(): void {
    if (this.currentTaskAbort !== null) {
      this.currentTaskAbort.abort();
      this.currentTaskAbort = null;
    }
  }

  /** 更新统计中的状态字段 */
  private updateStatsState(): void {
    this.stats.state = this._state;
  }

  /** 更新 header 文本 */
  private updateHeader(): void {
    const theme = createTheme(this.options.color);
    this.header.setText(theme.heading(`  zapmyco@${__VERSION__}`));
  }

  /** 更新 footer 文本 */
  private updateFooter(): void {
    const theme = createTheme(this.options.color);
    const stateLabel =
      this._state === 'idle'
        ? theme.success('空闲')
        : this._state === 'executing'
          ? theme.warning('执行中')
          : theme.dim('关闭中');
    this.footer.setText(`  ${stateLabel}`);
  }
}
