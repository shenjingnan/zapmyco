/**
 * REPL 会话核心（pi-tui 版）
 *
 * 使用 @mariozechner/pi-tui 框架替代 readline，
 * 实现完整的 TUI 交互式 REPL：
 * - Editor 组件自带上下边框
 * - 差量渲染，无闪烁
 * - 组件化布局，可扩展
 */

import type { KnownProvider } from '@mariozechner/pi-ai';
import { getModel } from '@mariozechner/pi-ai';
import { Container, ProcessTerminal, TUI, wrapTextWithAnsi } from '@mariozechner/pi-tui';
import { CommandRegistry } from '@/cli/repl/command-registry';
import { createAgentsCommand } from '@/cli/repl/commands/agents-cmd';
import { createClearCommand } from '@/cli/repl/commands/clear';
import { createConfigCommand } from '@/cli/repl/commands/config-cmd';
// 导入内置命令
import { createHelpCommand } from '@/cli/repl/commands/help';
import { createHistoryCommand } from '@/cli/repl/commands/history';
import { createQuitCommand } from '@/cli/repl/commands/quit';
import { createStatusCommand } from '@/cli/repl/commands/status';
import { ZapmycoEditor } from '@/cli/repl/components/custom-editor';
import { HistoryStore as HistoryStoreClass } from '@/cli/repl/history-store';
import { InputParser } from '@/cli/repl/input-parser';
import { Renderer as RendererClass } from '@/cli/repl/renderer';
import { createReplBuiltinTools } from '@/cli/repl/repl-agent-tools';
import { createTheme } from '@/cli/repl/theme';
import type {
  HistoryStore,
  ParsedInput,
  ReplOptions,
  SessionState,
  SessionStats,
} from '@/cli/repl/types';
import type { ZapmycoConfig } from '@/config/types';
import { createLlmBasedAgent, type LlmBasedAgent } from '@/core/agent-runtime';
import { eventBus } from '@/infra/event-bus';
import { logger } from '@/infra/logger';
import { parseModelKey } from '@/llm/pi-ai-provider';
import type { ChatMessage } from '@/llm/types';

const log = logger.child('repl:session');

/**
 * 输出区域组件
 *
 * 管理所有输出内容的行缓冲，实现 pi-tui 的 render 接口。
 */
class OutputArea extends Container {
  private lines: string[] = [];

  override render(width: number): string[] {
    // 对每行做自动换行，确保不超过终端宽度
    const result: string[] = [];
    for (const line of this.lines) {
      result.push(...wrapTextWithAnsi(line, width));
    }
    return result;
  }

  /** 追加多行内容 */
  append(lines: string[]): void {
    this.lines.push(...lines);
    this.invalidate();
  }

  /** 追加文本到当前行末尾（用于流式输出） */
  appendText(text: string): void {
    if (this.lines.length === 0) {
      this.lines.push(text);
    } else {
      this.lines[this.lines.length - 1] += text;
    }
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
  private readonly options: ReplOptions;
  private _state: SessionState = 'idle';
  private readonly parser: InputParser;
  private readonly registry: CommandRegistry;
  private readonly renderer: RendererClass;
  private readonly history: HistoryStoreClass;
  private currentTaskAbort: AbortController | null = null;

  /** Agent 实例（会话级复用，替代直接 LLM 调用） */
  private agent: LlmBasedAgent;

  /** 当前正在执行的 taskId（用于取消操作） */
  private currentTaskId: string | null = null;

  /** 多轮对话上下文（兼容保留，Agent 内部也维护历史） */
  private conversationHistory: ChatMessage[] = [];

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
    this.outputArea = new OutputArea();
    this.editor = new ZapmycoEditor(this.tui, theme.editorTheme);

    // 组装组件树：outputArea → editor(无边框，带提示符)
    const root = new Container();
    root.addChild(this.outputArea);
    root.addChild(this.editor);

    this.tui.addChild(root);
    this.tui.setFocus(this.editor);

    this.parser = new InputParser();
    this.registry = new CommandRegistry(this);
    this.renderer = new RendererClass(this.options);
    this.history = new HistoryStoreClass(this.options.maxHistorySize);

    // 初始化 Agent 实例（替代直接 LLM 调用）
    this.agent = this.createReplAgent();

    // 注册所有内置命令
    this.registerBuiltinCommands();

    // 注册 Agent 工具
    this.registerBuiltinTools();

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

    // 渲染简化的欢迎信息
    this.outputArea.append(['ZapMyco: 欢迎回来!', '']);

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
  getRenderer(): import('@/cli/repl/types').Renderer {
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
   * 执行用户目标 — 通过 Agent 执行并流式输出回复
   */
  async executeGoal(rawInput: string): Promise<import('@/core/result/types').FinalResult> {
    const startTime = Date.now();
    let historyEntry: import('@/cli/repl/types').HistoryEntry | undefined;
    const taskId = `task-${Date.now()}`;

    try {
      // 更新状态
      this._state = 'executing';
      this.updateStatsState();
      this.editor.setExecuting(true);

      // 创建 AbortController 用于取消（兼容保留）
      this.currentTaskAbort = new AbortController();

      // 记录到历史
      historyEntry = this.history.push({
        timestamp: Date.now(),
        input: rawInput,
      });

      // 发布目标提交事件
      eventBus.emit('goal:submitted', {
        goalId: `goal-${startTime}`,
        rawInput,
      });

      // 显示用户输入
      const goalLines: string[] = [`Me: ${rawInput}`, 'ZapMyco: '];
      this.outputArea.append(goalLines);

      // 设置流式输出桥接：Agent EVENT_OUTPUT -> outputArea.appendText()
      const outputHandler = (event: { taskId: string; text: string }) => {
        if (event.taskId === taskId) {
          this.outputArea.appendText(event.text);
          this.tui.requestRender();
        }
      };

      // 监听 Agent 错误事件
      const errorHandler = (event: { taskId: string; error: Error }) => {
        if (event.taskId === taskId) {
          log.error('Agent 执行中收到 error 事件', {
            error: event.error.message,
          });
        }
      };

      this.agent.on(this.agent.EVENT_OUTPUT, outputHandler);
      this.agent.on(this.agent.EVENT_ERROR, errorHandler);
      this.currentTaskId = taskId;

      log.debug('开始通过 Agent 执行目标', {
        taskId,
        taskDescription: rawInput.slice(0, 100),
      });

      // 通过 Agent 执行（替代原来的 chatStream）
      const taskResult = await this.agent.execute({
        taskId,
        taskDescription: rawInput,
        workdir: process.cwd(),
        options: {
          timeout: this.config.scheduler.taskTimeoutMs,
          verbose: this.options.debug,
        },
      });

      // 移除监听器（防止重复绑定）
      this.agent.off(this.agent.EVENT_OUTPUT, outputHandler);
      this.agent.off(this.agent.EVENT_ERROR, errorHandler);

      log.debug('Agent 执行完成', {
        taskId,
        status: taskResult.status,
        hasOutput: taskResult.output != null,
        duration: Date.now() - startTime,
      });

      // 根据执行结果渲染到 TUI
      const outputText =
        typeof taskResult.output === 'string'
          ? taskResult.output
          : taskResult.output != null
            ? JSON.stringify(taskResult.output)
            : null;

      if (taskResult.status !== 'success') {
        // Agent 返回 failure：渲染错误信息
        const errorMsg = taskResult.error?.message ?? 'Agent 执行失败（无详细错误信息）';
        this.outputArea.appendText(`[错误] ${errorMsg}`);
        log.error('Agent 执行返回 failure', {
          taskId,
          error: taskResult.error,
          status: taskResult.status,
        });
      }
      // 注意：成功时不再追加 outputText，流式事件（EVENT_OUTPUT）已经实时输出了全部内容

      // 追加换行分隔
      this.outputArea.append(['']);
      const duration = Date.now() - startTime;

      // 构建 FinalResult
      const result: import('@/core/result/types').FinalResult = {
        goalId: `goal-${startTime}`,
        overallStatus: taskResult.status === 'success' ? 'success' : 'failure',
        summary: outputText?.slice(0, 200) ?? '（无输出）',
        taskResults: [taskResult],
        allArtifacts: taskResult.artifacts ?? [],
        totalDuration: duration,
        totalTokenUsage: taskResult.tokenUsage ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        },
      };

      // 更新统计
      this.stats.totalRequests++;
      if (taskResult.status === 'success') {
        this.stats.successCount++;
      } else {
        this.stats.failureCount++;
      }

      // 兼容维护 conversationHistory
      this.conversationHistory.push({ role: 'user', content: rawInput });
      if (outputText) {
        this.conversationHistory.push({
          role: 'assistant',
          content: outputText,
        });
      }

      // 发布完成事件
      eventBus.emit('goal:completed', {
        goalId: result.goalId,
        result,
      });

      // 更新历史条目
      if (historyEntry) {
        historyEntry.goalId = result.goalId;
        historyEntry.durationMs = duration;
      }

      return result;
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
      this.editor.setExecuting(false);
      this.currentTaskAbort = null;
      this.currentTaskId = null;
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

  /**
   * 创建 REPL 专用的 Agent 实例
   *
   * Agent 复用 pi-ai 的 Model 对象进行 LLM 调用，
   * 因此需要从 config.llm 解析 model 并注入到 Agent state。
   */
  private createReplAgent(): LlmBasedAgent {
    const agent = createLlmBasedAgent({
      agentId: 'repl-chat-agent',
      displayName: 'Zapmyco AI 助手',
      capabilities: [
        {
          id: 'chat',
          name: '对话',
          description: '自然语言对话、问答、任务编排',
          category: 'chat',
        },
      ],
      runtimeConfig: this.config.agentRuntime ?? {},
    });

    // 将 pi-ai Model 注入到 Agent state（关键：没有这个 Agent 不知道用哪个模型）
    agent.innerAgent.state.model = this.resolveModelForAgent();

    // 注入 getApiKey 函数（关键：Agent 内部调用 LLM 时需要解析 API Key）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agent.innerAgent as any).getApiKey = (_provider: string): string | undefined => {
      const modelKey = this.config.llm.defaultModel;
      const modelConfig = this.config.llm.models[modelKey] as { provider?: string } | undefined;
      const providerName = modelConfig?.provider;
      if (providerName) {
        const auth = this.config.llm.providers[providerName];
        return auth?.apiKey;
      }
      return undefined;
    };

    return agent;
  }

  /**
   * 为 Agent 解析 pi-ai Model 对象
   *
   * 复用 PiAiProvider 的模型解析逻辑（parseModelKey + getModel），
   * 但不依赖 chat/chatStream 方法。
   */
  private resolveModelForAgent() {
    const modelKey = this.config.llm.defaultModel;
    const parsed = parseModelKey(modelKey);
    if (!parsed) {
      throw new Error(`无效的模型标识符: ${modelKey}`);
    }

    const modelConfig = this.config.llm.models[modelKey] as
      | { provider?: string; modelId?: string; baseUrl?: string }
      | undefined;

    const provider = (modelConfig?.provider ?? parsed.provider) as KnownProvider;
    const modelId = modelConfig?.modelId ?? parsed.modelId;

    // 始终用同 provider 的已知模型作为基础模板（保证返回有效 Model 对象）
    const baseModelId = provider === 'anthropic' ? 'claude-sonnet-4-20250514' : modelId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let model: any;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束需要运行时动态类型
      model = getModel(provider as any, baseModelId as any);
    } catch {
      // 最终兜底
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai 泛型约束需要运行时动态类型
      model = getModel('anthropic' as any, 'claude-sonnet-4-20250514' as any);
    }

    if (!model) {
      throw new Error(`无法初始化模型 ${modelKey}：pi-ai 返回了无效的模型对象`);
    }

    // 无条件覆盖自定义属性
    model.name = modelKey;
    model.id = modelId;

    if (modelConfig?.baseUrl) {
      model.baseUrl = modelConfig.baseUrl;
    }

    return model;
  }

  /**
   * 注册 REPL 场景下的基础工具
   */
  private registerBuiltinTools(): void {
    this.agent.registerTools(createReplBuiltinTools());
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
        this.outputArea.append(['', '任务已取消', '']);
        return;
      }

      // 空闲中：累计按键次数
      ctrlCPressCount++;
      if (ctrlCPressCount >= 2) {
        void this.shutdown('用户连续按下 Ctrl+C');
        return;
      }

      this.outputArea.append(['', '(再次按下 Ctrl+C 可强制退出)', '']);

      clearTimeout(ctrlCTimer);
      ctrlCTimer = setTimeout(() => {
        ctrlCPressCount = 0;
      }, 3000);
    };

    // Ctrl+D
    this.editor.onCtrlD = () => {
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
    // 通过 Agent 取消（优先）
    if (this.currentTaskId !== null) {
      void this.agent.cancel(this.currentTaskId);
      this.currentTaskId = null;
    }
    // 兼容旧的 AbortController 方式
    if (this.currentTaskAbort !== null) {
      this.currentTaskAbort.abort();
      this.currentTaskAbort = null;
    }
  }

  /** 更新统计中的状态字段 */
  private updateStatsState(): void {
    this.stats.state = this._state;
  }
}
