/**
 * REPL 会话核心
 *
 * 实现完整的 TUI 交互式 REPL：
 * - Editor 组件自带上下边框
 * - 差量渲染，无闪烁
 * - 组件化布局，可扩展
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import { CommandRegistry } from '@/cli/repl/command-registry';
import { createAgentsCommand } from '@/cli/repl/commands/agents-cmd';
import { createClearCommand } from '@/cli/repl/commands/clear';
import { createConfigCommand } from '@/cli/repl/commands/config-cmd';
// 导入内置命令
import { createHelpCommand } from '@/cli/repl/commands/help';
import { createHistoryCommand } from '@/cli/repl/commands/history';
import { createQuitCommand } from '@/cli/repl/commands/quit';
import { createSecurityCommand } from '@/cli/repl/commands/security-cmd';
import { createSettingsCommand } from '@/cli/repl/commands/settings-cmd';
import { createStatusCommand } from '@/cli/repl/commands/status';
import { AgentStatusBar } from '@/cli/repl/components/agent-status-bar';
import type { ApprovalOption } from '@/cli/repl/components/custom-editor';
import { LOADING_FRAMES, ZapmycoEditor } from '@/cli/repl/components/custom-editor';
import { showSelectList, showTextInput } from '@/cli/repl/components/dialogs';
import { TaskStatusBar } from '@/cli/repl/components/task-status-bar';
import { _setByDotPath, readSettings, writeSettings } from '@/cli/repl/config-utils';
import { CronScheduler } from '@/cli/repl/cron/cron-scheduler';
import { getCronStore } from '@/cli/repl/cron/cron-store';
import { HistoryStore as HistoryStoreClass } from '@/cli/repl/history-store';
import { InputParser } from '@/cli/repl/input-parser';
import { createTuiQuestionProvider } from '@/cli/repl/question-provider';
import { Renderer as RendererClass } from '@/cli/repl/renderer';
import { createReplBuiltinTools } from '@/cli/repl/repl-agent-tools';
import { SkillWatcher } from '@/cli/repl/skill-watcher';
import { createTheme } from '@/cli/repl/theme';
import { createLspTool } from '@/cli/repl/tools/lsp-tool';
import { getMemoryStore } from '@/cli/repl/tools/memory-tool';
import { createSendMessageTool } from '@/cli/repl/tools/send-message';
import {
  formatSkillContent,
  getSkillCommandSpecs,
  getSkillEntries,
  sanitizeSkillCommandName,
  setSkillEntries,
} from '@/cli/repl/tools/skill-tool';
import { createTaskStopTool } from '@/cli/repl/tools/task-stop';
import type {
  HistoryStore,
  ParsedInput,
  ReplOptions,
  SessionState,
  SessionStats,
} from '@/cli/repl/types';
import { AnimationManager } from '@/cli/repl/utils/animation-manager';
import { formatMarkdown } from '@/cli/repl/utils/markdown-formatter';
import {
  CombinedAutocompleteProvider,
  Container,
  getKeybindings,
  ProcessTerminal,
  type SlashCommand,
  TUI,
  wrapTextWithAnsi,
} from '@/cli/tui';
import { normalizeMcpConfig, type ZapmycoConfig } from '@/config/types';
import { createLlmBasedAgent, type LlmBasedAgent } from '@/core/agent-runtime';
import { COORDINATOR_TOOLS, getMainCoordinatorSystemPrompt } from '@/core/agent-team';
import { getAgentInstanceManager } from '@/core/agent-team/agent-instance-manager';
import { getAgentMessageBus } from '@/core/agent-team/agent-message-bus';
import { categorizeTool } from '@/core/agent-team/agent-tool-categorizer';
import type { AgentTypeDefinition } from '@/core/agent-team/types';
import { type CompactionConfig, DEFAULT_COMPACTION_CONFIG } from '@/core/context';
import { createDiagnosticCollector, type DiagnosticCollector } from '@/core/lsp/diagnostics';
import { resolveLspConfig } from '@/core/lsp/lsp-config';
import { createLspServerManager, type LspServerManager } from '@/core/lsp/lsp-server-manager';
import { initializeMcpTools, type McpManager } from '@/core/mcp';
import { getQuestionManager, type QuestionManager } from '@/core/question';
import { loadSkills, type SkillEntry } from '@/core/skill';
import { TaskStore } from '@/core/task/task-store';
import type { WorktreeConfig } from '@/core/worktree/types';
import { setWorktreeManager, WorktreeManager } from '@/core/worktree/worktree-manager';
import { setLocale, t } from '@/i18n';
import { eventBus } from '@/infra/event-bus';
import { logger } from '@/infra/logger';
import { AgentLlmFacade } from '@/llm/agent-llm-facade';
import type { ResolvedModel } from '@/llm/provider-types';
import type { ChatMessage } from '@/llm/types';
import {
  ApprovalManager,
  createToolInfoResolver,
  PermissionEngine,
  PermissionStore,
  resolveConfig,
  ToolGuard,
} from '@/security';
import { AuditLogger } from '@/security/audit-logger';
import { SecretRedactor } from '@/security/secret-redaction';
import { SkillGuard } from '@/security/skill-guard';

const log = logger.child('repl:session');

/**
 * 检查错误消息是否匹配 "No API key for provider"，返回解决指引行
 */
function getApiKeyErrorHelp(errorMessage: string): string[] {
  const match = errorMessage.match(/No API key for provider: (\w+)/);
  if (!match) return [];

  const providerName = match[1]!;
  const envVarName = `${providerName.toUpperCase().replace(/-/g, '_')}_API_KEY`;

  return [
    '',
    chalk.yellow(`  ${t('session.setEnvVarHint', { envVar: envVarName })}`),
    chalk.yellow(`  ${t('session.useConfigHint', { provider: providerName })}`),
  ];
}

/**
 * 输出区域组件
 *
 * 管理所有输出内容的行缓冲，实现 render 接口。
 */
class OutputArea extends Container {
  private lines: string[] = [];
  /** 逐行缓存的渲染结果（避免每帧对所有历史行重新调用 wrapTextWithAnsi） */
  private lineCache: Map<number, string[]> = new Map();
  /** 缓存生成时使用的终端宽度，变化时重建 */
  private cacheWidth = 0;

  override render(width: number): string[] {
    // 终端宽度变化 → 所有缓存行失效
    if (width !== this.cacheWidth) {
      this.cacheWidth = width;
      this.lineCache.clear();
    }

    const result: string[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      let cached = this.lineCache.get(i);
      if (!cached) {
        cached = wrapTextWithAnsi(this.lines[i] ?? '', width);
        this.lineCache.set(i, cached);
      }
      result.push(...cached);
    }
    return result;
  }

  /** 追加多行内容，返回新追加行中第一行的索引 */
  append(lines: string[]): number {
    const index = this.lines.length;
    this.lines.push(...lines);
    this.invalidate();
    return index;
  }

  /** 追加文本到当前行末尾（用于流式输出） */
  appendText(text: string): void {
    if (this.lines.length === 0) {
      this.lines.push(text);
    } else {
      this.lines[this.lines.length - 1] += text;
      // 追加文本后，最后一行缓存失效
      this.lineCache.delete(this.lines.length - 1);
    }
    this.invalidate();
  }

  /** 替换最后一行的完整内容（用于 spinner 动画和首 chunk 替换），返回行索引 */
  replaceLastLine(text: string): number {
    if (this.lines.length > 0) {
      this.lines[this.lines.length - 1] = text;
      // 最后一行变化，失效其缓存
      this.lineCache.delete(this.lines.length - 1);
    } else {
      this.lines.push(text);
    }
    this.invalidate();
    return this.lines.length - 1;
  }

  /** 在指定位置插入/删除/替换行（原子操作） */
  spliceLines(startIndex: number, deleteCount: number, insertLines: string[]): void {
    this.lines.splice(startIndex, deleteCount, ...insertLines);
    // 行索引发生变化，从 startIndex 起的所有缓存失效
    this.invalidateCacheFrom(startIndex);
    this.invalidate();
  }

  /** 更新指定索引行的内容 */
  updateLine(index: number, text: string): void {
    if (index >= 0 && index < this.lines.length) {
      this.lines[index] = text;
      this.lineCache.delete(index);
      this.invalidate();
    }
  }

  /** 清空所有内容 */
  clear(): void {
    this.lines = [];
    this.lineCache.clear();
    this.invalidate();
  }

  /** 使从指定索引开始的所有缓存行失效 */
  private invalidateCacheFrom(startIndex: number): void {
    // Map 的 keys() 按插入顺序返回，但 index 不保证连续
    // 遍历 keys 删除 >= startIndex 的条目
    for (const key of this.lineCache.keys()) {
      if (key >= startIndex) {
        this.lineCache.delete(key);
      }
    }
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
  private readonly taskStatusBar: TaskStatusBar;
  private readonly agentStatusBar: AgentStatusBar;
  private readonly options: ReplOptions;
  private _state: SessionState = 'idle';
  private readonly parser: InputParser;
  private readonly registry: CommandRegistry;
  private readonly renderer: RendererClass;
  private readonly history: HistoryStoreClass;
  private currentTaskAbort: AbortController | null = null;

  /** 动画管理器（渲染周期驱动的 spinner/计时器，替代 setInterval） */
  private readonly animationManager = new AnimationManager();

  /** 欢迎语逐字输出定时器引用（用于 shutdown 时清理） */
  private welcomeTypewriterInterval: ReturnType<typeof setInterval> | undefined;

  /** Agent 实例（会话级复用，替代直接 LLM 调用） */
  private agent: LlmBasedAgent;

  /** MCP 连接管理器（在 registerBuiltinTools 中异步初始化） */
  private mcpManager: McpManager | null = null;

  /** LSP 服务器管理器（在 registerBuiltinTools 中异步初始化） */
  private lspManager: LspServerManager | null = null;

  /** LSP 诊断收集器 */
  private diagnosticCollector: DiagnosticCollector | null = null;

  /** 当前正在执行的 taskId（用于取消操作） */
  private currentTaskId: string | null = null;

  /** 多轮对话上下文（兼容保留，Agent 内部也维护历史） */
  private conversationHistory: ChatMessage[] = [];

  /** 定时任务调度器 */
  private cronScheduler: CronScheduler | null = null;

  /** 任务管理器（会话级持久化） */
  private taskStore: TaskStore;

  /** Worktree 隔离管理器 */
  private worktreeManager!: WorktreeManager;

  /** 安全框架组件 */
  private permissionStore!: PermissionStore;
  private permissionEngine!: PermissionEngine;
  private approvalManager!: ApprovalManager;
  private toolGuard!: ToolGuard;
  private auditLogger!: AuditLogger;
  private secretRedactor!: SecretRedactor;
  private skillGuard!: SkillGuard;
  private skillWatcher!: SkillWatcher;

  /** 交互式提问管理器 */
  private questionManager!: QuestionManager;

  // 会话统计
  private stats: SessionStats = {
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    state: 'idle',
  };

  constructor(
    readonly config: ZapmycoConfig,
    private readonly conversationLogger?: import('@/infra/conversation-logger').ConversationLogger
  ) {
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
    this.animationManager.bind(this.tui);

    // 注：仅保留方向键用于自动补全列表导航。此前使用了 'j'/'k'/'h'/'l'
    // 作为导航键，但它们与命令名称字符（如 /clear 中的 'l'）冲突，
    // 导致输入 /cl 时 'l' 被拦截为确认键而非文本输入。
    getKeybindings().setUserBindings({
      'tui.select.up': ['up'],
      'tui.select.down': ['down'],
      'tui.select.cancel': ['escape'],
      'tui.select.confirm': ['enter'],
    });

    // 初始化 TaskStore（会话级内存任务列表，用于 Agent 任务跟踪）
    // 注意：不调用 load() 从文件恢复，每次新会话从空白开始。
    // 文件持久化仅用于会话内上下文压缩后的任务恢复（formatForInjection）。
    this.taskStore = new TaskStore();

    // 创建组件
    this.outputArea = new OutputArea();
    this.agentStatusBar = new AgentStatusBar(this.animationManager);
    this.taskStatusBar = new TaskStatusBar(this.taskStore, this.animationManager);

    // TaskStore 变化时自动刷新 TaskStatusBar
    this.taskStore.onChange(() => {
      this.taskStatusBar.onTasksChanged();
      this.tui.requestRender();
    });

    this.editor = new ZapmycoEditor(this.tui, theme.editorTheme, this.animationManager);

    // 组装组件树：outputArea → taskStatusBar → agentStatusBar → editor(无边框，带提示符)
    const root = new Container();
    root.addChild(this.outputArea);
    root.addChild(this.taskStatusBar);
    root.addChild(this.agentStatusBar);
    root.addChild(this.editor);

    this.tui.addChild(root);
    this.tui.setFocus(this.editor);

    this.parser = new InputParser();
    this.registry = new CommandRegistry(this);
    this.renderer = new RendererClass(this.options);
    this.history = new HistoryStoreClass(this.options.maxHistorySize);

    // 将持久化的历史注入编辑器，支持上下方向键跨会话导航
    for (const entry of this.history.getAll()) {
      this.editor.addToHistory(entry.input);
    }

    // 初始化 Agent 实例（替代直接 LLM 调用）
    this.agent = this.createReplAgent();

    // 初始化 CronScheduler（定时任务调度器）
    this.cronScheduler = new CronScheduler(getCronStore(), {
      isIdle: () => this._state === 'idle',
    });
    void this.cronScheduler.start();

    // 初始化 WorktreeManager（Agent 隔离环境）
    this.initWorktreeManager();

    // 初始化 MemoryStore 并冻结记忆快照（用于系统提示注入）
    const memoryStore = getMemoryStore();
    memoryStore
      .freezeSnapshot()
      .then(() => {
        this.agent.memorySnapshot = memoryStore.getSnapshot();
      })
      .catch((err: unknown) => {
        log.warn('记忆快照冻结失败，将使用空快照', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.agent.memorySnapshot = '';
      });

    // 初始化 Skill 系统（异步加载，完成后更新 Agent）
    this.skillWatcher = new SkillWatcher();
    if (this.config.skill?.enabled !== false) {
      this.initSkills();
    }

    // 初始化安全框架
    this.initSecurity();

    // 初始化交互式提问管理器（注入 TUI provider）
    this.questionManager = getQuestionManager();
    this.questionManager.setProvider(createTuiQuestionProvider(this.tui));

    // 注册所有内置命令
    this.registerBuiltinCommands();

    // 注册 Agent 工具（Skill 工具在 initSkills 完成后再注册，此处先注册其他工具）
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

    // 初始化 i18n 语言设置
    setLocale(this.config.locale ?? 'zh-CN');

    // 先启动 TUI，再逐字输出欢迎信息
    this.tui.start();
    this.tui.requestRender();

    // 逐字输出欢迎语（类似 LLM 流式效果）
    this.typewriteWelcome();
  }

  /** 逐字输出欢迎语（类似 LLM 流式打字效果） */
  private typewriteWelcome(): void {
    const text = t('session.welcome');
    this.outputArea.append(['']); // 预留一行

    let index = 0;
    this.welcomeTypewriterInterval = setInterval(() => {
      index++;
      if (index <= text.length) {
        this.outputArea.replaceLastLine(text.slice(0, index));
        this.tui.requestRender();
      } else {
        clearInterval(this.welcomeTypewriterInterval);
        this.welcomeTypewriterInterval = undefined;
        this.outputArea.append(['']); // 打字结束追加空行
        this.tui.requestRender();
      }
    }, 40);
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

    // 取消所有待处理的交互式提问
    if (this.questionManager) {
      this.questionManager.rejectAll(new Error('会话已关闭'));
    }

    // 停止欢迎语打字动画（确保 setInterval 被立即清除）
    if (this.welcomeTypewriterInterval) {
      clearInterval(this.welcomeTypewriterInterval);
      this.welcomeTypewriterInterval = undefined;
    }

    // 停止编辑器 loading 动画（确保 setInterval 被立即清除）
    this.editor.setExecuting(false);

    // 发布关闭事件
    eventBus.emit('system:shutdown', { reason });

    // 停止定时任务调度器
    if (this.cronScheduler) {
      this.cronScheduler.stop();
      this.cronScheduler = null;
    }

    // 停止技能文件监视
    this.skillWatcher.stop();

    // 关闭审计日志（flush 缓冲并清理监听器）
    if (this.auditLogger) {
      this.auditLogger.destroy();
    }

    // 关闭 MCP 连接
    if (this.mcpManager) {
      await this.mcpManager.shutdown();
      this.mcpManager = null;
    }

    // 关闭 LSP 服务器连接
    if (this.lspManager) {
      await this.lspManager.shutdown();
      this.lspManager = null;
    }
    if (this.diagnosticCollector) {
      this.diagnosticCollector.clear();
      this.diagnosticCollector = null;
    }

    // 停止 TUI
    this.tui.stop();

    // 强制退出进程，确保不因残留 timer/handle 而延迟退出
    process.exit(0);
  }

  /** 获取渲染器引用 */
  getRenderer(): import('@/cli/repl/types').Renderer {
    return this.renderer;
  }

  /** 获取 TUI 实例（用于显示 overlay 菜单） */
  getTui(): TUI {
    return this.tui;
  }

  /** 获取历史存储引用 */
  getHistoryStore(): HistoryStore {
    return this.history;
  }

  /**
   * 彻底清空 Agent 会话上下文。
   *
   * - 清空消息历史、Token 统计、缓存、授权
   * - 保留配置、记忆、定时任务
   * - 效果等价于"新开一个会话"
   *
   * 由 /clear 命令调用。
   */
  clearAgentContext(): void {
    // 1. 中止当前正在执行的任务
    this.cancelCurrentTask();
    this.currentTaskId = null;
    this._state = 'idle';

    // 2. 重置 Agent 运行时（消息、队列、追踪器、缓存、压缩器等）
    this.agent.resetContext();

    // 3. 清空旧版兼容消息存储
    this.conversationHistory = [];

    // 4. 重置会话统计
    this.stats = {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      state: 'idle',
    };

    // 5. 清理授权缓存（session + persistent）
    this.permissionStore.clear();

    // 6. 取消所有待处理的交互式提问
    this.questionManager.rejectAll(new Error('会话已重置'));

    // 7. 停止编辑器 loading 状态
    this.editor.setExecuting(false);

    // 8. 清空 TUI 输出
    this.outputArea.clear();

    // ★ 新增：清空任务列表，防止历史任务残留
    this.taskStore.clear();

    // 9. 清除 Agent 状态栏的 Token 显示
    this.agentStatusBar.clearTokenStats();

    // 10. 重新渲染 TUI
    this.tui.requestRender();
  }

  /** 获取会话统计 */
  getStats(): SessionStats {
    return { ...this.stats };
  }

  /**
   * 获取安全健康报告（供 /audit 命令使用）
   *
   * 综合审计日志、权限配置、守卫状态等信息，生成安全评分和改进建议。
   */
  getSecurityHealthReport(): import('@/security/types').SecurityHealthReport {
    const securityConfig = this.config.security ?? {};
    const auditStats = this.auditLogger?.getStats() ?? {
      totalDecisions: 0,
      blockedCount: 0,
      approvedCount: 0,
      deniedCount: 0,
    };

    // 计算分类评分
    const scores = {
      permissions: this.calcPermissionsScore(),
      shell: this.calcShellScore(),
      filesystem: this.calcFilesystemScore(),
      ssrf: this.calcSsrfScore(),
      secrets: this.calcSecretsScore(),
      sandbox: this.calcSandboxScore(),
    };

    const overallScore = Math.round(
      scores.permissions * 0.3 +
        scores.shell * 0.2 +
        scores.filesystem * 0.15 +
        scores.ssrf * 0.1 +
        scores.secrets * 0.1 +
        scores.sandbox * 0.15
    );

    // 近期阻止记录
    const recentBlocks = this.auditLogger?.getRecentBlocks(5) ?? [];

    // 生成改进建议
    const recommendations: string[] = [];
    if (securityConfig.mode === 'permissive') {
      recommendations.push('当前权限模式为 permissive，建议切换到 normal 或 strict');
    }
    if (!securityConfig.denyRules?.length) {
      recommendations.push('未配置自定义拒绝规则，建议添加针对特定工具的限制');
    }
    if (securityConfig.audit?.enabled === false) {
      recommendations.push('审计日志已禁用，建议启用以跟踪安全事件');
    }
    if (securityConfig.secretRedaction?.enabled === false) {
      recommendations.push('密钥脱敏已禁用，建议启用以防止密钥泄露');
    }
    if (scores.sandbox < 50) {
      recommendations.push('沙箱执行未启用或配置不安全，建议启用沙箱保护');
    }

    return {
      overallScore,
      scores,
      recentBlocks,
      stats: {
        ...auditStats,
        doomLoopTriggers: this.agent.doomLoop.getStats().totalTriggers,
      },
      recommendations,
    };
  }

  private calcPermissionsScore(): number {
    const securityConfig = this.config.security ?? {};
    if (!securityConfig.enabled && securityConfig.enabled !== undefined) return 30;
    switch (securityConfig.mode) {
      case 'strict':
        return 90;
      case 'normal':
        return 70;
      case 'permissive':
        return 40;
      default:
        return 70; // 默认 normal
    }
  }

  private calcShellScore(): number {
    // 基于 hard-block 规则的存在性评分
    // Phase 0 已激活 12 条 hard-block 规则
    return 80;
  }

  private calcFilesystemScore(): number {
    // Phase 0 已实现 symlink + TOCTOU 保护
    return 75;
  }

  private calcSsrfScore(): number {
    // Phase 0 已实现云元数据阻止 + 重定向检查
    return 75;
  }

  private calcSecretsScore(): number {
    const config = this.config.security?.secretRedaction;
    if (config?.enabled === false) return 20;
    return 70;
  }

  private calcSandboxScore(): number {
    // Phase 2 仅做策略验证，Docker 延后到 Phase 3
    return 30;
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
  async executeGoal(
    rawInput: string,
    displayLabel?: string
  ): Promise<import('@/core/result/types').FinalResult> {
    const startTime = Date.now();
    let historyEntry: import('@/cli/repl/types').HistoryEntry | undefined;
    const taskId = `task-${Date.now()}`;

    // 输出区 spinner 相关变量（需要跨 try/catch 访问）
    const colorEnabled = this.options.color;
    const userStyle = (s: string) => (colorEnabled ? chalk.bold.cyan(s) : s);
    const markdownFormattingEnabled = this.config.cli.markdownFormatting !== false;
    const responseStyle = (s: string) => s;
    const toolStyle = (s: string) => (colorEnabled ? chalk.yellow(s) : s);
    const execStyle = (s: string) => (colorEnabled ? chalk.cyan(s) : s);
    const execSuccessStyle = (s: string) => (colorEnabled ? chalk.green(s) : s);
    const execFailStyle = (s: string) => (colorEnabled ? chalk.red(s) : s);
    const dimStyle = (s: string) => (colorEnabled ? chalk.gray(s) : s);
    let spinnerActive = true;
    /** 动画管理器帧推进计时（spinner，100ms间隔） */
    let lastSpinnerTick = 0;
    /** thinking 计时动画活跃标志（替代 thinkingElapsedInterval setInterval） */
    let thinkingTimerActive = false;
    let thinkingFrame = 0;
    let lastThinkingTick = 0;
    /** AnimationManager 回调注销函数集合（finally 中统一清理） */
    const animCleanup: (() => void)[] = [];

    /**
     * 合并渲染请求——在同一个微任务内的多次调用合并为一次 requestRender。
     * 流式事件（OUTPUT/THINKING/PROGRESS）短时间密集到达时，避免为每个事件
     * 都调用 requestRender（即使 TUI 内部有 16ms 去抖，仍可减少调度开销）。
     */
    let coalesceRenderPending = false;
    const requestCoalescedRender = () => {
      if (coalesceRenderPending) return;
      coalesceRenderPending = true;
      queueMicrotask(() => {
        coalesceRenderPending = false;
        this.tui.requestRender();
      });
    };

    // 注册主 Agent 为 AgentInstance（depth=0），使 AgentStatusBar 能跟踪其进度
    // Coordinator 模式下使用协调者身份，便于 UI 展示和子 Agent 识别
    const mainAgentDef: AgentTypeDefinition = this.isCoordinatorMode()
      ? {
          typeId: 'repl-coordinator',
          displayName: '协调者',
          whenToUse: 'Main REPL coordinator',
          role: 'coordinator',
          capabilities: [
            {
              id: 'agent-orchestration',
              name: 'Agent 编排',
              description: '编排多个子 Agent 协同完成复杂任务',
              category: 'planning',
            },
          ],
          toolPolicy: { mode: 'inherit' },
          permissionMode: 'inherit',
          source: 'builtin',
          maxTurns: 100,
          maxSpawnDepth: 2,
          getSystemPrompt: () => '',
          color: '#e67e22',
        }
      : {
          typeId: 'Explore',
          displayName: 'Explore Agent',
          whenToUse: 'Main REPL agent',
          role: 'universal',
          capabilities: [],
          toolPolicy: { mode: 'inherit' },
          permissionMode: 'inherit',
          source: 'builtin',
          maxTurns: 100,
          maxSpawnDepth: 0,
          getSystemPrompt: () => '',
          color: '#3498db',
        };
    const mainAgent = this.agent as unknown as LlmBasedAgent;
    const instanceManager = getAgentInstanceManager();
    const mainInstance = instanceManager.register(
      mainAgentDef,
      mainAgent,
      {
        taskId,
        description: rawInput.slice(0, 200),
        mode: 'sync',
        timeoutMs: this.config.scheduler.taskTimeoutMs,
        inheritContext: false,
      },
      null,
      0
    );
    instanceManager.transition(mainInstance.instanceId, 'running');
    // thinking 计时动画已由 animationManager 驱动，无需 setInterval
    /** Token 信息推送定时器 */
    let tokenPushInterval: ReturnType<typeof setInterval> | undefined;

    try {
      // 更新状态（禁用编辑器输入，但不显示编辑器 spinner）
      this._state = 'executing';
      this.updateStatsState();
      this.editor.setExecuting(true, false);

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

      // 显示用户输入 + spinner
      this.outputArea.append([userStyle(displayLabel ?? rawInput), LOADING_FRAMES[0] ?? '']);

      // 输出区 spinner 动画（由 animationManager 在每次 render 前驱动，替代 setInterval）
      let spinnerFrame = 0;
      spinnerActive = true;
      animCleanup.push(
        this.animationManager.register((now) => {
          if (!spinnerActive) return;
          if (now - lastSpinnerTick < 100) return;
          lastSpinnerTick = now;
          spinnerFrame = (spinnerFrame + 1) % LOADING_FRAMES.length;
          this.outputArea.replaceLastLine(LOADING_FRAMES[spinnerFrame] ?? '');
        })
      );

      // 流式输出桥接：Agent EVENT_OUTPUT / EVENT_THINKING -> outputArea
      let spinnerStopped = false;
      let outputAccumulator = '';
      let thinkingAccumulator = '';
      let streamMode: 'none' | 'response' | 'thinking' = 'response';
      // 记录响应文本在 OutputArea 中的行索引（用于最后格式化）
      let responseLineIndex: number | null = null;

      // Thinking 折叠/展开状态
      const thinkingDisplayMode = this.config.cli.thinkingDisplay ?? 'collapse';
      let thinkingHeaderLineIndex: number | null = null;
      let thinkingContentLineCount = 0;
      let thinkingStartTimeMs = 0;

      // 参考 claude-code 样式的 thinking 展示常量
      const THINKING_LABEL = '  \u2234 Thinking...';
      const THINKING_CONTINUE_PREFIX = '  \u23BF  ';

      /** 将 thinking 累积文本按换行符拆分为展示行 */
      const splitThinkingContent = (text: string): string[] => {
        if (!text) return [''];
        const MAX_THINKING_LINES = 200;
        const lines = text.split('\n');
        // 移除末尾空行
        while (lines.length > 0 && lines[lines.length - 1] === '') {
          lines.pop();
        }
        if (lines.length === 0) lines.push('');
        if (lines.length > MAX_THINKING_LINES) {
          lines.splice(MAX_THINKING_LINES);
          lines.push(`  ... [thinking truncated, ${text.split('\n').length} lines total]`);
        }
        return lines;
      };

      /** 展开/折叠 thinking 内容 */
      const toggleThinking = () => {
        if (thinkingHeaderLineIndex === null) return;
        if (thinkingDisplayMode !== 'collapse') return;

        if (thinkingContentLineCount === 0) {
          // 折叠 → 展开：在 header 行后插入内容行
          const contentLines = splitThinkingContent(thinkingAccumulator);
          const styledLines = contentLines.map((line) => dimStyle(THINKING_CONTINUE_PREFIX + line));
          this.outputArea.spliceLines(thinkingHeaderLineIndex + 1, 0, styledLines);
          thinkingContentLineCount = styledLines.length;
          // 展开时 header 不显示耗时
          this.outputArea.updateLine(thinkingHeaderLineIndex, dimStyle(THINKING_LABEL));
        } else {
          // 展开 → 折叠：删除内容行
          this.outputArea.spliceLines(thinkingHeaderLineIndex + 1, thinkingContentLineCount, []);
          thinkingContentLineCount = 0;
          // 折叠时恢复显示耗时
          const elapsed = ((Date.now() - thinkingStartTimeMs) / 1000).toFixed(1);
          const elapsedSuffix = streamMode === 'thinking' ? `... (${elapsed}s)` : ` (${elapsed}s)`;
          this.outputArea.updateLine(
            thinkingHeaderLineIndex,
            dimStyle(`${THINKING_LABEL}${elapsedSuffix}`)
          );
        }
        this.tui.requestRender();
      };

      const outputHandler = (event: { taskId: string; text: string }) => {
        if (event.taskId !== taskId || !event.text) return;

        // 首次输出文本时，如果之前执行过工具，说明 LLM 已进入结论生成阶段，
        // 将主 Agent 标记为 completed，停止底部 spinner（工具执行已完成）
        if (hasExecutedTool) {
          hasExecutedTool = false; // 只执行一次
          instanceManager.transition(mainInstance.instanceId, 'completed');
        }

        if (!spinnerStopped) {
          spinnerStopped = true;
          spinnerActive = false;
          streamMode = 'response';
          thinkingAccumulator = '';
          outputAccumulator = event.text;
          responseLineIndex = this.outputArea.replaceLastLine(responseStyle(outputAccumulator));
        } else if (streamMode !== 'response') {
          // 从 thinking 模式切换到 response：移除 thinking 行，换为响应文本
          streamMode = 'response';
          // 停止 thinking 耗时计时器
          thinkingTimerActive = false;
          thinkingAccumulator = '';
          outputAccumulator = event.text;
          // 移除 thinking header 行，在同一位置替换为响应文本
          if (thinkingHeaderLineIndex !== null) {
            this.outputArea.spliceLines(thinkingHeaderLineIndex, 1, [
              responseStyle(outputAccumulator),
            ]);
            responseLineIndex = thinkingHeaderLineIndex;
            thinkingHeaderLineIndex = null;
          } else {
            responseLineIndex = this.outputArea.append([responseStyle(outputAccumulator)]);
          }
        } else {
          outputAccumulator += event.text;
          this.outputArea.replaceLastLine(responseStyle(outputAccumulator));
        }
        requestCoalescedRender();
      };

      const thinkingHandler = (event: { taskId: string; text: string }) => {
        if (event.taskId !== taskId || !event.text) return;

        // off 模式：完全忽略 thinking
        if (thinkingDisplayMode === 'off') return;

        if (streamMode !== 'thinking') {
          streamMode = 'thinking';
          thinkingStartTimeMs = Date.now();

          if (!spinnerStopped) {
            // thinking 先到达：替换 spinner 行为带 spinner 帧的 thinking header
            spinnerStopped = true;
            spinnerActive = false;
            thinkingHeaderLineIndex = this.outputArea.replaceLastLine(
              dimStyle(`  ${LOADING_FRAMES[0] ?? ''} Thinking...`)
            );
          } else {
            // 已在输出 response，thinking 也到达
            thinkingHeaderLineIndex = this.outputArea.append([
              dimStyle(`  ${LOADING_FRAMES[0] ?? ''} Thinking...`),
            ]);
          }

          thinkingAccumulator = event.text;
          thinkingContentLineCount = 0;

          if (thinkingDisplayMode === 'expand') {
            // expand 模式：显示内容行（旧行为）
            this.outputArea.append([dimStyle(THINKING_CONTINUE_PREFIX + thinkingAccumulator)]);
            thinkingContentLineCount = 1;
          } else if (thinkingDisplayMode === 'collapse') {
            // collapse 模式：由 animationManager 驱动 spinner 动画和计时器（替代 setInterval）
            thinkingTimerActive = true;
            thinkingFrame = 0;
            // 注册 thinking 动画回调（会在 executeGoal cleanup 时自动注销）
            animCleanup.push(
              this.animationManager.register((now) => {
                if (!thinkingTimerActive) return;
                if (thinkingHeaderLineIndex === null) return;
                if (thinkingContentLineCount > 0) return;
                if (now - lastThinkingTick < 200) return;
                lastThinkingTick = now;
                const elapsed = ((Date.now() - thinkingStartTimeMs) / 1000).toFixed(1);
                const frame = LOADING_FRAMES[thinkingFrame % LOADING_FRAMES.length];
                thinkingFrame++;
                this.outputArea.updateLine(
                  thinkingHeaderLineIndex,
                  dimStyle(`  ${frame} Thinking... (${elapsed}s)`)
                );
              })
            );
          }
        } else {
          thinkingAccumulator += event.text;

          if (thinkingDisplayMode === 'expand') {
            // expand 模式：更新内容行
            this.outputArea.replaceLastLine(
              dimStyle(THINKING_CONTINUE_PREFIX + thinkingAccumulator)
            );
          }
          // collapse 模式：仅累积，不更新 UI（除非已展开）
          if (thinkingDisplayMode === 'collapse' && thinkingContentLineCount > 0) {
            // 已展开时更新最后一行
            const contentLines = splitThinkingContent(thinkingAccumulator);
            const lastLine = contentLines[contentLines.length - 1] ?? '';
            this.outputArea.replaceLastLine(dimStyle(THINKING_CONTINUE_PREFIX + lastLine));
          }
        }
        requestCoalescedRender();
      };

      // 监听 Agent 错误事件
      const errorHandler = (event: { taskId: string; error: Error }) => {
        if (event.taskId === taskId) {
          log.error('Agent 执行中收到 error 事件', {
            error: event.error.message,
          });
        }
      };

      // 工具调用展示：Agent EVENT_PROGRESS -> outputArea.append()
      // 参考 claude-code 风格：Exec 使用 ⏺ 图标 + 状态颜色，其他工具使用 ⎿ 图标
      let execLineIndex: number | undefined;
      let execMessage: string | undefined;
      /** 是否执行过工具调用（用于判断输出阶段时是否结束 agent 状态） */
      let hasExecutedTool = false;
      /** 连续同类型工具调用的分组跟踪（用于 OutputArea 展示 ⎿ 分组） */
      let lastToolCategory = '';
      let lastToolLabel = '';
      let toolGroupCount = 0;
      let toolGroupLineIndex: number | null = null;
      let toolGroupSampleArg = '';

      const progressHandler = (event: {
        taskId: string;
        percent: number;
        message: string;
        detail?: {
          toolName: string;
          toolCallId?: string;
          argsDisplay?: string;
          isStart?: boolean;
          isEnd?: boolean;
          isError?: boolean;
        };
      }) => {
        if (event.taskId !== taskId) return;

        // 通过 InstanceManager 记录工具调用（驱动 AgentStatusBar 更新）
        if (event.detail?.isStart) {
          instanceManager.recordToolCall(mainInstance.instanceId, {
            toolName: event.detail.toolName,
            toolCallId: event.detail.toolCallId,
            argsDisplay: event.detail.argsDisplay,
            status: 'running',
            startedAt: Date.now(),
          });
        } else if (event.detail?.isEnd) {
          const mainInst = instanceManager.get(mainInstance.instanceId);
          if (mainInst) {
            const lastRunning = [...mainInst.toolCallHistory]
              .reverse()
              .find((t) => t.status === 'running' && t.toolName === event.detail?.toolName);
            if (lastRunning) {
              lastRunning.status = event.detail.isError ? 'failed' : 'completed';
              lastRunning.endedAt = Date.now();
            }
          }
        }

        if (event.percent === 0) {
          // 工具开始 → thinking 阶段结束，移除 thinking 行
          if (thinkingTimerActive && streamMode === 'thinking') {
            thinkingTimerActive = false;
            if (thinkingHeaderLineIndex !== null) {
              this.outputArea.spliceLines(thinkingHeaderLineIndex, 1, []);
              thinkingHeaderLineIndex = null;
              requestCoalescedRender();
            }
          }
          // 工具开始
          hasExecutedTool = true;
          if (event.message.startsWith('Exec(')) {
            // Exec 工具：使用 ⏺ 图标和青色（不参与分组）
            execMessage = event.message;
            execLineIndex = this.outputArea.append([execStyle(`  ⏺ ${event.message}`)]);
            // 重置分组状态
            lastToolCategory = '';
            toolGroupCount = 0;
            toolGroupLineIndex = null;
          } else if (event.message.startsWith('TaskManage(')) {
            // TaskManage 信息已由底部 TaskStatusBar 展示，不在 OutputArea 重复显示
            log.debug('TaskManage 工具调用已记录，跳过 TUI 展示');
            // 重置分组状态
            lastToolCategory = '';
            toolGroupCount = 0;
            toolGroupLineIndex = null;
          } else if (event.detail?.toolName) {
            // 分类当前工具，判断是否与上一个连续同类型
            const { category, label } = categorizeTool(event.detail.toolName);
            const argsPart = event.detail.argsDisplay ?? '';

            if (category === lastToolCategory && toolGroupLineIndex !== null) {
              // 连续同类型：计数器 +1，更新行内容
              toolGroupCount++;
              // 保留第一个参数作为示例
              const sampleDisplay = toolGroupSampleArg
                ? ` (e.g. ${toolGroupSampleArg.slice(0, 50)})`
                : '';
              const groupedText = toolStyle(
                `  ⎿  ${lastToolLabel} ${toolGroupCount} items${sampleDisplay}`
              );
              this.outputArea.updateLine(toolGroupLineIndex, groupedText);
            } else {
              // 不同类型或新开始：重置分组，开始新行
              // 刷新上一个分组（如果有）
              lastToolCategory = category;
              lastToolLabel = label;
              toolGroupCount = 1;
              toolGroupSampleArg = argsPart;
              const sampleDisplay = argsPart ? ` (e.g. ${argsPart.slice(0, 50)})` : '';
              const lineText = toolStyle(`  ⎿  ${label} ${toolGroupCount} item${sampleDisplay}`);
              toolGroupLineIndex = this.outputArea.append([lineText]);
            }
          } else {
            // 无 detail（旧格式）：保持原有 → 风格
            this.outputArea.append([toolStyle(`  → ${event.message}`)]);
          }
          requestCoalescedRender();
        } else if (event.percent === 100 && execLineIndex !== undefined && execMessage) {
          // 工具结束 — 仅处理 Exec 状态颜色更新
          if (event.message.startsWith('工具 Exec')) {
            const isSuccess = event.message.includes('完成');
            const style = isSuccess ? execSuccessStyle : execFailStyle;
            this.outputArea.updateLine(execLineIndex, style(`  ⏺ ${execMessage}`));
            execLineIndex = undefined;
            execMessage = undefined;
            requestCoalescedRender();
          }
        }
      };

      this.agent.on(this.agent.EVENT_OUTPUT, outputHandler);
      this.agent.on(this.agent.EVENT_THINKING, thinkingHandler);
      this.agent.on(this.agent.EVENT_ERROR, errorHandler);
      this.agent.on(this.agent.EVENT_PROGRESS, progressHandler);
      this.currentTaskId = taskId;

      // 绑定 thinking 展开/折叠快捷键
      const originalOnToggleThinking = this.editor.onToggleThinking;
      if (thinkingDisplayMode === 'collapse') {
        this.editor.onToggleThinking = toggleThinking;
      }

      // 重置状态栏 Token 信息，然后设置当前模型名称
      this.agentStatusBar.clearTokenStats();
      const agentModel = (this.agent as LlmBasedAgent).innerAgent.state.model;
      const modelName = typeof agentModel?.id === 'string' ? agentModel.id : 'unknown';
      this.agentStatusBar.setModelName(modelName);

      // 定时推送 Token 统计数据到状态栏（每 2 秒）
      tokenPushInterval = setInterval(() => {
        const usage = (this.agent as LlmBasedAgent).tokenTracker.getUsage();
        this.agentStatusBar.updateTokenStats(
          usage.inputTokens,
          usage.outputTokens,
          Date.now() - startTime
        );
        this.tui.requestRender();
      }, 2000);

      log.debug('开始通过 Agent 执行目标', {
        taskId,
        taskDescription: rawInput.slice(0, 100),
      });

      // Coordinator 模式：在 execute 之前 drain inbox 获取后台任务完成通知
      let effectiveTaskDescription = rawInput;
      if (this.isCoordinatorMode()) {
        const messageBus = getAgentMessageBus();
        const pendingMessages = messageBus.drainInbox('repl-chat-agent');
        if (pendingMessages.length > 0) {
          const notificationBlocks = pendingMessages.map((msg) => {
            try {
              const parsed = JSON.parse(msg.payload);
              if (parsed.type === 'task_result') {
                return [
                  `[任务完成通知]`,
                  `任务 ID: ${parsed.taskId}`,
                  `类型: ${parsed.typeId}`,
                  `状态: ${parsed.status}`,
                  parsed.summary ? `\n结果:\n${parsed.summary}` : '',
                  parsed.error ? `错误: ${parsed.error}` : '',
                ].join('\n');
              }
            } catch {
              // payload 非 JSON，原样展示
            }
            return `[消息 - ${msg.fromAgentId}]\n${msg.payload}`;
          });

          effectiveTaskDescription = [
            '## 以下后台任务已完成',
            ...notificationBlocks,
            '---',
            rawInput,
          ].join('\n\n');
        }
      }

      // 通过 Agent 执行（替代原来的 chatStream）
      const taskResult = await this.agent.execute({
        taskId,
        taskDescription: effectiveTaskDescription,
        workdir: process.cwd(),
        options: {
          timeout: this.config.scheduler.taskTimeoutMs,
          verbose: this.options.debug,
        },
      });

      // 移除监听器（防止重复绑定）
      this.agent.off(this.agent.EVENT_OUTPUT, outputHandler);
      this.agent.off(this.agent.EVENT_THINKING, thinkingHandler);
      this.agent.off(this.agent.EVENT_ERROR, errorHandler);
      this.agent.off(this.agent.EVENT_PROGRESS, progressHandler);
      // 恢复 editor 快捷键回调
      this.editor.onToggleThinking = originalOnToggleThinking;

      // 更新主 Agent 实例状态（如果 outputHandler 已经 transition 为 completed，跳过重复调用）
      const mainInst = instanceManager.get(mainInstance.instanceId);
      if (mainInst && mainInst.status === 'running') {
        const mainAgentStatus = taskResult.status === 'success' ? 'completed' : 'failed';
        instanceManager.transition(mainInstance.instanceId, mainAgentStatus);
      }
      this.tui.requestRender();

      log.debug('Agent 执行完成', {
        taskId,
        status: taskResult.status,
        hasOutput: taskResult.output != null,
        duration: Date.now() - startTime,
      });

      // 上下文溢出错误恢复：自动压缩后重试
      if (taskResult.status === 'failure' && taskResult.error?.code === 'CONTEXT_OVERFLOW') {
        log.info('上下文溢出错误，尝试紧急压缩后重试', { taskId });
        this.outputArea.append([
          '',
          chalk.yellow('  ⚠ 上下文超出窗口限制，正在自动整理并重试...'),
          '',
        ]);

        // 暂停 spinner（animationManager 会根据 spinnerActive 标志自动停止推进）
        spinnerActive = false;

        try {
          // 执行紧急压缩
          const compactionResult = await this.agent.compact();
          if (compactionResult.success) {
            this.outputArea.append([
              chalk.green(
                `  上下文已整理 (${compactionResult.beforeEstimatedTokens} → ${compactionResult.afterEstimatedTokens} tokens)，正在重试...`
              ),
              '',
            ]);
            // 递归重试
            return await this.executeGoal(rawInput);
          } else {
            this.outputArea.append([
              chalk.red(`  上下文整理失败: ${compactionResult.error ?? '未知错误'}`),
              '',
            ]);
          }
        } catch (compactionErr) {
          log.error('紧急压缩异常', {
            error: compactionErr instanceof Error ? compactionErr.message : String(compactionErr),
          });
          this.outputArea.append([chalk.red('  上下文整理异常，请手动执行 /compact 后重试'), '']);
        }

        // 恢复 spinner（animationManager 的回调仍在注册中，只需重新激活标志）
        spinnerActive = true;
      }

      // 根据执行结果渲染到 TUI
      const outputText =
        typeof taskResult.output === 'string'
          ? taskResult.output
          : taskResult.output != null
            ? JSON.stringify(taskResult.output)
            : null;

      // 如果 spinner 还在运行（Agent 未发射流式输出），停止并处理
      if (spinnerActive) {
        spinnerActive = false;
        if (outputText) {
          this.outputArea.replaceLastLine(responseStyle(outputText));
        } else if (taskResult.status !== 'success') {
          // 无输出 + 失败状态 → 显示错误
          const errorMsg = taskResult.error?.message ?? t('session.agentErrorMessage');
          this.outputArea.replaceLastLine(chalk.red(`${t('session.errorPrefix')} ${errorMsg}`));
          const helpLines = getApiKeyErrorHelp(errorMsg);
          if (helpLines.length > 0) {
            this.outputArea.append(helpLines);

            // 检测 "No API key for provider" 错误，提供交互式修复
            const providerMatch = errorMsg.match(/No API key for provider: (\w+)/);
            if (providerMatch) {
              const providerName = providerMatch[1]!;

              this.outputArea.append(['']);
              const choice = await showSelectList(
                this.tui,
                [
                  {
                    value: 'yes',
                    label: '好的，我来输入 API Key',
                    description: `直接输入 ${providerName} 的 API Key，立即配置并重试`,
                  },
                  {
                    value: 'no',
                    label: '稍后再说',
                    description: '回到对话',
                  },
                ],
                { title: `需要配置 ${providerName} 的 API Key` }
              );

              if (choice?.value === 'yes') {
                const apiKey = await showTextInput(
                  this.tui,
                  `请输入 ${providerName} 的 API Key:`,
                  '',
                  'sk-...'
                );

                if (apiKey && apiKey.length > 0) {
                  // 保存 API Key 到配置文件并热加载
                  const dotPath = `llm.providers.${providerName}.apiKey`;
                  const settings = readSettings();
                  _setByDotPath(settings, dotPath, apiKey);
                  writeSettings(settings);
                  _setByDotPath(this.config as unknown as Record<string, unknown>, dotPath, apiKey);
                  this.applyConfigUpdate(dotPath);

                  this.outputArea.append([
                    '',
                    chalk.green(`已配置 ${providerName} 的 API Key，正在重试...`),
                    '',
                  ]);

                  // 递归重试
                  return await this.executeGoal(rawInput);
                }
              }

              this.outputArea.append(['']);
            }
          }
        } else {
          // 无输出但状态为成功 → 可能是 API Key 等配置问题
          this.outputArea.replaceLastLine(
            chalk.red(`${t('session.errorPrefix')} ${t('session.noContentError')}`)
          );
        }
      }

      if (taskResult.status !== 'success') {
        // Agent 返回 failure：渲染详细错误信息（如果 spinner 已处理则只追加详情）
        const errorMsg = taskResult.error?.message ?? t('session.agentErrorMessage');
        if (!spinnerActive || outputText) {
          // spinner 未处理此错误（已收到输出后才失败的情况）
          this.outputArea.appendText(`${t('session.errorPrefix')} ${errorMsg}`);
        }
        log.error('Agent 执行返回 failure', {
          taskId,
          error: taskResult.error,
          status: taskResult.status,
        });
      }
      // 注意：成功时不再追加 outputText，流式事件（EVENT_OUTPUT）已经实时输出了全部内容

      // Markdown 格式化：对 Agent 输出应用 ANSI 样式（标题加粗、表格对齐、代码块着色等）
      if (markdownFormattingEnabled && taskResult.status === 'success') {
        if (outputAccumulator && responseLineIndex !== null) {
          // 流式输出场景：替换响应行为格式化后的多行内容
          const formatted = formatMarkdown(outputAccumulator, colorEnabled);
          if (formatted) {
            const formattedLines = formatted.split('\n');
            this.outputArea.spliceLines(responseLineIndex, 1, formattedLines);
            this.tui.requestRender();
          }
        } else if (spinnerStopped === false && outputText) {
          // 非流式输出场景（spinner 从未被替换）：替换 spinner 行并追加后续行
          const formatted = formatMarkdown(outputText, colorEnabled);
          if (formatted) {
            const lines = formatted.split('\n');
            this.outputArea.replaceLastLine(lines[0] ?? '');
            if (lines.length > 1) {
              this.outputArea.append(lines.slice(1));
            }
            this.tui.requestRender();
          }
        }
      }

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

      // 自动压缩检测（成功时在后台检查，不影响响应）
      if (taskResult.status === 'success') {
        void this.checkAndAutoCompact();
      }

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('目标执行失败', { input: rawInput }, err);

      // 停止 spinner（如果还在运行）
      spinnerActive = false;
      // 清理 thinking 耗时计时器
      thinkingTimerActive = false;

      this.stats.totalRequests++;
      this.stats.failureCount++;

      eventBus.emit('goal:failed', {
        goalId: `goal-${startTime}`,
        error: err,
      });

      // 渲染错误到输出区域（替换 spinner 行 + 追加错误详情）
      this.outputArea.replaceLastLine(responseStyle(`${t('session.errorPrefix')} ${err.message}`));
      const helpLines = getApiKeyErrorHelp(err.message);
      if (helpLines.length > 0) {
        this.outputArea.append(helpLines);

        // 检测 "No API key for provider" 错误，提供交互式修复
        const providerMatch = err.message.match(/No API key for provider: (\w+)/);
        if (providerMatch) {
          const providerName = providerMatch[1]!;

          this.outputArea.append(['']);
          const choice = await showSelectList(
            this.tui,
            [
              {
                value: 'yes',
                label: '好的，我来输入 API Key',
                description: `直接输入 ${providerName} 的 API Key，立即配置并重试`,
              },
              {
                value: 'no',
                label: '稍后再说',
                description: '回到对话',
              },
            ],
            { title: `需要配置 ${providerName} 的 API Key` }
          );

          if (choice?.value === 'yes') {
            const apiKey = await showTextInput(
              this.tui,
              `请输入 ${providerName} 的 API Key:`,
              '',
              'sk-...'
            );

            if (apiKey && apiKey.length > 0) {
              // 保存 API Key 到配置文件并热加载
              const dotPath = `llm.providers.${providerName}.apiKey`;
              const settings = readSettings();
              _setByDotPath(settings, dotPath, apiKey);
              writeSettings(settings);
              _setByDotPath(this.config as unknown as Record<string, unknown>, dotPath, apiKey);
              this.applyConfigUpdate(dotPath);

              this.outputArea.append([
                '',
                chalk.green(`已配置 ${providerName} 的 API Key，正在重试...`),
                '',
              ]);

              // 递归重试（新的 taskId，干净的 listener 状态）
              return await this.executeGoal(rawInput);
            }
          }

          this.outputArea.append(['']);
        }
      }
      const errorLines = this.renderer.renderError(err).slice(1); // 跳过第一行（已替换 spinner）
      if (errorLines.length > 0) {
        this.outputArea.append(errorLines);
      }

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
      spinnerActive = false;
      thinkingTimerActive = false;
      // 注销 AnimationManager 回调（spinner + thinking 动画）
      for (const unregister of animCleanup) {
        unregister();
      }
      animCleanup.length = 0;
      // 清理 Token 推送定时器
      if (tokenPushInterval) {
        clearInterval(tokenPushInterval);
        tokenPushInterval = undefined;
      }
      // 执行结束后更新最终 Token 统计（含总耗时），保持展示
      const finalUsage = (this.agent as LlmBasedAgent).tokenTracker.getUsage();
      this.agentStatusBar.updateTokenStats(
        finalUsage.inputTokens,
        finalUsage.outputTokens,
        Date.now() - startTime
      );
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
        this.editor.addToHistory(line);
        break;
      }

      case 'goal': {
        // 自然语言目标执行
        await this.executeGoal(parsed.rawInput);
        this.editor.addToHistory(line);
        break;
      }
    }
  }

  // ============ 私有方法 ============

  /**
   * 初始化安全框架
   *
  /**
   * 初始化 WorktreeManager
   *
   * 创建 git worktree 隔离管理器，注册为全局实例，
   * 并启动过期 worktree 清理。
   */
  private initWorktreeManager(): void {
    const rawConfig = this.config.worktree ?? {};
    const worktreeConfig: WorktreeConfig = {
      enabled: true,
      autoCleanNoChanges: true,
      expireAfterMs: 24 * 60 * 60 * 1000,
      baseDir: join(homedir(), '.zapmyco', 'worktrees'),
      ...rawConfig,
    };
    // 防止空字符串覆盖默认值（DEFAULT_CONFIG 中 baseDir 可能为空）
    if (!worktreeConfig.baseDir) {
      worktreeConfig.baseDir = join(homedir(), '.zapmyco', 'worktrees');
    }

    this.worktreeManager = new WorktreeManager(worktreeConfig);
    setWorktreeManager(this.worktreeManager);

    // fire-and-forget 清理过期 worktree
    this.worktreeManager.cleanExpired().catch((err: unknown) => {
      log.warn('过期 worktree 清理失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * 创建 PermissionEngine → ApprovalManager → ToolGuard 管道。
   * 必须在 registerBuiltinTools() 之前调用。
   */
  private initSecurity(): void {
    const securityConfig = this.config.security ?? {};
    const resolvedConfig = resolveConfig(securityConfig);

    this.permissionStore = new PermissionStore(resolvedConfig.persistence);

    // 先创建空的 ToolInfoResolver，在 registerBuiltinTools 后更新
    const toolInfoResolver = createToolInfoResolver([]);
    this.permissionEngine = new PermissionEngine(
      resolvedConfig,
      this.permissionStore,
      toolInfoResolver
    );

    this.approvalManager = new ApprovalManager();

    // 注入编辑器审批提供者（替代 overlay 方案，审批面板融入编辑器区域）
    this.approvalManager.setProvider({
      requestApproval: async (request) => {
        try {
          // 在编辑器区域显示审批选项（无需额外输出，审批面板已包含工具信息）
          return await new Promise<{ approved: boolean; scope?: 'once' | 'session' }>((resolve) => {
            const options: ApprovalOption[] = [
              {
                key: '1',
                label: '允许本次',
                action: () => resolve({ approved: true, scope: 'once' }),
              },
              {
                key: '2',
                label: '本次会话始终允许',
                action: () => resolve({ approved: true, scope: 'session' }),
              },
              {
                key: '3',
                label: '拒绝',
                action: () => resolve({ approved: false }),
              },
            ];

            this.editor.enterApprovalMode(`是否允许工具 "${request.toolId}" 的调用？`, options);
            this.tui.requestRender();
          });
        } catch {
          log.warn('审批过程异常，自动拒绝', { toolId: request.toolId });
          return { approved: false };
        } finally {
          // 清理审批状态
          this.editor.exitApprovalMode();

          // 如果 Agent 仍在执行，恢复 spinner
          if (this._state === 'executing') {
            this.editor.setExecuting(true, true);
          }

          this.tui.requestRender();
        }
      },
    });

    // Phase 2: 创建审计日志和密钥脱敏
    this.auditLogger = new AuditLogger(securityConfig.audit ?? { enabled: true, level: 'normal' });
    this.secretRedactor = new SecretRedactor(securityConfig.secretRedaction);
    this.auditLogger.setRedactor(this.secretRedactor);

    this.toolGuard = new ToolGuard(
      this.permissionEngine,
      this.approvalManager,
      this.permissionStore,
      undefined,
      this.auditLogger,
      'repl-chat-agent'
    );

    // Phase 2: 创建 Skill 守卫
    this.skillGuard = new SkillGuard();

    log.debug('安全框架初始化完成', {
      mode: resolvedConfig.mode,
      enabled: resolvedConfig.enabled,
    });
  }

  /** 注册所有内置命令 */
  private registerBuiltinCommands(): void {
    this.registry.register(createHelpCommand());
    this.registry.register(createQuitCommand());
    this.registry.register(createClearCommand());
    this.registry.register(createHistoryCommand());
    this.registry.register(createConfigCommand());
    this.registry.register(createAgentsCommand());
    this.registry.register(createStatusCommand());
    this.registry.register(createSettingsCommand());
    this.registry.register(createSecurityCommand());

    // 注册 /compact 命令
    this.registry.register(this.createCompactCommand());

    // 设置 autocomplete provider
    this.buildAutocompleteProvider();
  }

  /** 构建并设置 autocomplete provider，将命令注册表中的命令接入补全系统 */
  private buildAutocompleteProvider(): void {
    const slashCommands: SlashCommand[] = [];

    for (const cmd of this.registry.listCommands()) {
      const base: { name: string; description: string; argumentHint?: string } = {
        name: cmd.name,
        description: cmd.description,
      };
      if (cmd.usage !== `/${cmd.name}`) {
        base.argumentHint = cmd.usage;
      }
      slashCommands.push(base);

      // 同时注册别名
      for (const alias of cmd.aliases) {
        slashCommands.push({
          name: alias,
          description: `${cmd.description}（别名: /${cmd.name}）`,
        });
      }
    }

    const provider = new CombinedAutocompleteProvider(slashCommands, process.cwd(), null);
    this.editor.setAutocompleteProvider(provider);
    this.editor.setAutocompleteMaxVisible(12);
  }

  /**
   * 创建 REPL 专用的 Agent 实例
   *
   * Agent 复用本地 Model 对象进行 LLM 调用，
   * 因此需要从 config.llm 解析 model 并注入到 Agent state。
   */
  private createReplAgent(): LlmBasedAgent {
    const agent = createLlmBasedAgent({
      agentId: 'repl-chat-agent',
      displayName: t('session.displayName'),
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

    // 创建 AgentLlmFacade（统一管理 Model 解析 + Key 获取 + 故障转移）
    const facade = new AgentLlmFacade(this.config.llm);

    // 将 ResolvedModel 注入到 Agent state
    agent.innerAgent.state.model = facade.resolveResolvedModel() as unknown as ResolvedModel;

    // 注入 getApiKey 函数（支持凭据池轮转）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agent.innerAgent as any).getApiKey = facade.createGetApiKeyFn();

    // 存储 facade 引用，供子 Agent 共享
    agent.llmFacade = facade;

    // 应用压缩配置
    const compactionConfig: CompactionConfig = {
      ...(this.config.compaction ?? DEFAULT_COMPACTION_CONFIG),
    };
    agent.compactor.updateConfig(compactionConfig);
    agent.compactor.setLlmFacade(facade);
    agent.toolPruner.updateConfig({
      enabled: compactionConfig.enabled,
      protectLastMessages: 10,
    });

    // 验证默认 provider 的 API Key
    const defaultModelInfo = facade.getModelInfo();
    if (defaultModelInfo) {
      const key = facade.getApiKey(defaultModelInfo.provider);
      if (!key) {
        const providerName = defaultModelInfo.provider;
        const envVar = `${providerName.toUpperCase()}_API_KEY`;
        this.outputArea.append([
          chalk.red(`[!] 提供商 "${providerName}" 没有配置 API Key`),
          chalk.yellow(`    请设置环境变量: export ${envVar}=<your-key>`),
          chalk.yellow(
            `    或在 REPL 中使用: /config set llm.providers.${providerName}.apiKey <your-key>`
          ),
          '',
        ]);
        log.warn('默认提供商缺少 API Key', { provider: providerName });
      }
    }

    // 注入对话日志记录器（如已启用）
    if (this.conversationLogger?.isEnabled) {
      agent.conversationLogger = this.conversationLogger;
    }

    return agent;
  }

  /**
   * 判断是否处于 Coordinator 模式
   *
   * 当 agentTeam.defaultMode === 'coordinator' 时，
   * 主 Agent 切换为编排模式：工具受限、系统提示词替换。
   */
  private isCoordinatorMode(): boolean {
    return this.config.agentTeam?.defaultMode === 'coordinator';
  }

  /**
   * 注册 REPL 场景下的基础工具
   *
   * 在注册内置工具后，异步初始化 MCP 工具。
   * MCP 连接不阻塞内置工具注册——Agent 立即可用内置工具，
   * MCP 工具在连接完成后自动追加。
   *
   * 在 Coordinator 模式下，主 Agent 仅注册编排工具
   *（AgentTool + SendMessage + TaskStop），完整工具集
   * 仍传递给 AgentOrchestrator 供子 Agent 使用。
   */
  private registerBuiltinTools(): void {
    // 1. 注册内置工具（同步，立即可用）
    const rawTools = createReplBuiltinTools(
      this.config.web,
      this.taskStore,
      this.config.skill,
      this.agent,
      this.config.subAgent,
      this.cronScheduler ?? undefined,
      this.config.agentTeam,
      this.worktreeManager,
      this.toolGuard
    );

    // 更新 PermissionEngine 的工具信息解析器（使用完整工具列表）
    this.permissionEngine.setToolInfoResolver(createToolInfoResolver(rawTools));

    // Coordinator 模式：主 Agent 仅保留编排工具
    // 完整工具集仍通过 AgentOrchestrator 传递给子 Agent
    const mainTools = this.isCoordinatorMode()
      ? [
          ...rawTools.filter((t) => (COORDINATOR_TOOLS as readonly string[]).includes(t.id)),
          createSendMessageTool('repl-chat-agent'),
          createTaskStopTool(),
        ]
      : rawTools;

    // 用 ToolGuard 包装工具（代理模式，添加安全管道）
    const guardedTools = this.toolGuard.wrapAll(mainTools);

    this.agent.registerTools(guardedTools);

    // 设置 Coordinator 模式系统提示词
    if (this.isCoordinatorMode()) {
      this.agent.systemPromptOverride = getMainCoordinatorSystemPrompt(process.cwd());
    }

    // 2. 异步初始化 MCP 工具（fire-and-forget，完成后自动注册）
    //    normalizeMcpConfig 兼容 key-value 和 servers 数组两种格式
    const mcpServers = this.config.mcp ? normalizeMcpConfig(this.config.mcp) : [];
    if (mcpServers.length > 0) {
      initializeMcpTools(mcpServers, this.agent)
        .then((manager) => {
          this.mcpManager = manager;
        })
        .catch((err: unknown) => {
          log.error('MCP 初始化失败', { error: err instanceof Error ? err.message : String(err) });
        });
    }

    // 3. LSP 代码智能（fire-and-forget，不阻塞 Agent 使用）
    if (this.config.lsp?.enabled !== false) {
      const lspServers = resolveLspConfig(this.config.lsp);
      if (lspServers.length > 0) {
        this.lspManager = createLspServerManager();
        this.lspManager.init(lspServers, process.cwd()).catch((err: unknown) => {
          log.error('LSP 初始化失败', { error: err instanceof Error ? err.message : String(err) });
        });

        // 注册 LSP 工具
        rawTools.push(createLspTool(this.lspManager));

        // 初始化诊断收集器
        this.diagnosticCollector = createDiagnosticCollector();
        this.diagnosticCollector.init(this.lspManager);

        // 4. ReadFile 文档同步钩子：文件读取成功后通知 LSP server
        const readFileTool = rawTools.find((t) => t.id === 'ReadFile');
        if (readFileTool && this.lspManager) {
          const lspManagerRef = this.lspManager;
          const originalExecute = readFileTool.execute;
          readFileTool.execute = async (toolCallId, params, signal, onUpdate) => {
            const result = await originalExecute(toolCallId, params, signal, onUpdate);
            // fire-and-forget 文档同步
            const filePath = (params as Record<string, unknown>)?.file_path;
            if (
              filePath &&
              typeof filePath === 'string' &&
              !(result.details as Record<string, unknown>)?.error
            ) {
              lspManagerRef.onFileOpened(filePath, '').catch(() => {});
            }
            return result;
          };
        }
      }
    }
  }

  /**
   * 初始化 Skill 系统
   *
   * 从 bundled/user/project/workspace 四个来源加载技能，
   * 构建快照注入到 Agent 系统提示。
   */
  private initSkills(): void {
    const skillConfig = this.config.skill;
    if (!skillConfig?.enabled) return;

    loadSkills(
      {
        enabled: true,
        extraDirs: skillConfig.loadDirs,
        maxSkillsInPrompt: skillConfig.maxSkillsInPrompt,
        maxSkillFileBytes: skillConfig.maxSkillFileBytes,
      },
      process.cwd()
    )
      .then((entries) => {
        // 更新 SkillTool 的条目（供工具查找）
        setSkillEntries(entries);

        // 更新 Agent 的 skill 条目（用于 allowed-tools 自动授权）
        this.agent.skillEntries = entries;
        this.agent.resetSentSkills();

        // 注册 Skill 斜杠命令（如 /commit, /review-pr）
        this._registerSkillCommands(entries);

        // 更新 autocomplete provider（包含新注册的 skill 命令）
        this.buildAutocompleteProvider();

        // 扫描 Skill 安全威胁
        this.scanSkillSecurity(entries);
        log.info('Skill 系统初始化完成', {
          count: entries.length,
          names: entries.map((e) => e.skill.name),
        });

        // 初始加载完成后启动文件监视（避免初始扫描事件触发 reload）
        this.startSkillWatcher();
      })
      .catch((err: unknown) => {
        log.error('Skill 加载失败', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  /**
   * 启动技能文件变更监视
   *
   * 监视项目级（.agents/skills/、.zapmyco/skills/）和用户级
   *（~/.zapmyco/skills/）技能目录，文件变更时自动重新加载。
   */
  private startSkillWatcher(): void {
    const watchDirs: string[] = [];

    for (const dir of [
      join(process.cwd(), '.agents', 'skills'),
      join(process.cwd(), '.zapmyco', 'skills'),
      join(homedir(), '.zapmyco', 'skills'),
    ]) {
      try {
        if (statSync(dir).isDirectory()) watchDirs.push(dir);
      } catch {
        // 目录不存在，跳过
      }
    }

    if (watchDirs.length === 0) return;

    this.skillWatcher.start({
      watchDirs,
      onChanged: () => this.reloadSkills(),
    });
  }

  /**
   * 重新加载所有技能（文件变更时调用）
   *
   * 幂等操作：重新扫描磁盘、更新全局状态、刷新命令注册和自动补全。
   */
  private reloadSkills(): void {
    const skillConfig = this.config.skill;
    if (!skillConfig?.enabled) return;

    log.info('技能文件变更，重新加载技能...');

    loadSkills(
      {
        enabled: true,
        extraDirs: skillConfig.loadDirs,
        maxSkillsInPrompt: skillConfig.maxSkillsInPrompt,
        maxSkillFileBytes: skillConfig.maxSkillFileBytes,
      },
      process.cwd()
    )
      .then((entries) => {
        // 更新全局技能条目
        setSkillEntries(entries);
        this.agent.skillEntries = entries;
        this.agent.resetSentSkills();

        // 重新注册斜杠命令（先清除旧的 skill 命令）
        this.registry.unregisterBySource('skill');
        this._registerSkillCommands(entries);

        // 刷新自动补全
        this.buildAutocompleteProvider();

        // 安全扫描
        this.scanSkillSecurity(entries);

        log.info('技能重新加载完成', {
          count: entries.length,
          names: entries.map((e) => e.skill.name),
        });
      })
      .catch((err: unknown) => {
        log.error('技能重新加载失败', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  /**
   * 扫描 Skill 安全威胁
   */
  private scanSkillSecurity(entries: SkillEntry[]): void {
    const results = this.skillGuard.scanAll(entries);
    const summary = this.skillGuard.getThreatSummary(results);
    if (summary.danger > 0 || summary.warning > 0) {
      log.warn('Skill 威胁扫描完成', summary);
      for (const result of results) {
        if (!result.passed) {
          for (const v of result.violations) {
            eventBus.emit('security:violation', {
              toolId: 'Skill',
              type: 'skill-threat',
              message: `[${result.skillName}] ${v.reason}`,
              params: { skillPath: result.skillPath, ruleId: v.ruleId },
            });
          }
        }
      }
    }
  }

  /**
   * 为 user-invocable 技能注册斜杠命令
   *
   * 将每个用户可调用的技能注册为 /skill-name 格式的 CLI 命令。
   * 命令执行时，将技能名称和用户参数作为 goal 发送给 Agent 处理。
   */
  private _registerSkillCommands(entries: SkillEntry[]): void {
    const specs = getSkillCommandSpecs(entries);

    for (const spec of specs) {
      // 检查是否已存在同名命令（内置命令优先）
      if (this.registry.getCommand(spec.name)) {
        log.debug(`跳过 skill 命令 "${spec.name}"：与内置命令冲突`);
        continue;
      }

      this.registry.register({
        name: spec.name,
        description: spec.description,
        aliases: [],
        usage: spec.name,
        source: 'skill',
        handler: async (args: string[]) => {
          const argsStr = args.join(' ');

          // 直接解析技能内容，绕过 LLM 的 Skill 工具调用步骤
          const currentEntries = getSkillEntries();
          const entry = currentEntries.find(
            (e) => sanitizeSkillCommandName(e.skill.name) === spec.name
          );

          if (entry) {
            // 将格式化后的技能指令作为 goal 发送给 Agent（内容已展开，无需 LLM 再调用 Skill 工具）
            const skillContent = await formatSkillContent(entry.skill, argsStr);
            await this.executeGoal(skillContent, `/${spec.name}`);
          } else {
            // Fallback：技能条目不存在（罕见情况），回退到通用描述
            const goalInput = argsStr
              ? `请使用 /${spec.name} 技能，参数: ${argsStr}`
              : `请使用 /${spec.name} 技能`;
            await this.executeGoal(goalInput);
          }
        },
      });
    }
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
        clearTimeout(ctrlCTimer);
        ctrlCTimer = undefined;
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

    // Ctrl+G: 打开外部编辑器
    this.editor.onOpenEditor = () => this.openInEditor();

    // Ctrl+B: 将当前任务转入后台执行
    this.editor.onRunInBackground = () => {
      if (this.currentTaskId) {
        const bgTaskId = this.currentTaskId;
        this.cancelCurrentTask();
        this.outputArea.append([chalk.gray(`  (任务 ${bgTaskId} 已转入后台运行)`), '']);
        this.tui.requestRender();
      }
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

    // 监听 Agent 实例状态变更，驱动 UI 状态栏更新
    const instanceManager = getAgentInstanceManager();
    const refreshStatusBar = () => {
      this.agentStatusBar.invalidate();
      this.tui.requestRender();
    };

    instanceManager.on('instance:registered', refreshStatusBar);
    instanceManager.on('instance:transitioned', refreshStatusBar);
    instanceManager.on('instance:activity', refreshStatusBar);
    instanceManager.on('instance:toolcall', refreshStatusBar);

    // 关闭时清理监听器
    eventBus.on('system:shutdown', () => {
      instanceManager.off('instance:registered', refreshStatusBar);
      instanceManager.off('instance:transitioned', refreshStatusBar);
      instanceManager.off('instance:activity', refreshStatusBar);
      instanceManager.off('instance:toolcall', refreshStatusBar);
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

  /**
   * 打开外部编辑器（vim / $EDITOR）编辑当前输入内容
   *
   * 流程：
   * 1. 将编辑器当前文本写入临时文件
   * 2. 暂停 TUI（恢复终端 cooked 模式）
   * 3. 启动外部编辑器，用户编辑并保存退出
   * 4. 读取编辑后的内容并更新编辑器
   * 5. 恢复 TUI 并重绘
   */
  private openInEditor(): void {
    const tmpFile = join(tmpdir(), 'zapmyco-editor-input.txt');
    let tuiStopped = false;

    try {
      const currentText = this.editor.getExpandedText();
      writeFileSync(tmpFile, currentText, 'utf-8');

      this.tui.stop();
      tuiStopped = true;

      const editorCmd = process.env.VISUAL || process.env.EDITOR || 'vim';
      const result = spawnSync(editorCmd, [tmpFile], { stdio: 'inherit' });

      const newText = readFileSync(tmpFile, 'utf-8');

      if (newText !== currentText) {
        this.editor.setText(newText);
      }

      if (result.error) {
        const err = result.error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          this.outputArea.append(['', t('session.editorNotFound', { cmd: editorCmd }), '']);
        } else {
          this.outputArea.append(['', `编辑器启动失败: ${err.message}`, '']);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.outputArea.append(['', t('session.editorFailed', { message }), '']);
    } finally {
      if (tuiStopped) {
        this.tui.start();
        this.tui.requestRender(true);
      }
      try {
        unlinkSync(tmpFile);
      } catch (err) {
        log.warn('临时文件清理失败', {
          path: tmpFile,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * 应用配置更新到运行中的 Agent（无需重启）
   *
   * 当前处理以 "llm." 开头的配置变更，重新创建 AgentLlmFacade
   * 并注入到运行中的 Agent 实例，使新 Key/模型立即生效。
   */
  applyConfigUpdate(key: string): void {
    // security 配置热更新
    if (key.startsWith('security.')) {
      const securityConfig = this.config.security ?? {};
      const resolvedConfig = resolveConfig(securityConfig);
      this.permissionEngine.updateConfig(resolvedConfig);
      log.debug('安全配置已热更新', { key });
      return;
    }

    if (!key.startsWith('llm.')) return;

    // 从更新后的 config 重新创建 LLM facade
    const newFacade = new AgentLlmFacade(this.config.llm);

    // 重新注入 Model 对象到 Agent state
    this.agent.innerAgent.state.model = newFacade.resolvePiModel();

    // 重新注入 getApiKey 函数（供 pi-agent-core 每次 LLM 调用时使用）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.agent.innerAgent as any).getApiKey = newFacade.createGetApiKeyFn();

    // 更新 facade 引用（供子 Agent 共享）
    this.agent.llmFacade = newFacade;
  }

  /** 更新统计中的状态字段 */
  private updateStatsState(): void {
    this.stats.state = this._state;
  }

  /**
   * 检查并触发自动压缩（异步，不阻塞用户交互）
   */
  private async checkAndAutoCompact(): Promise<void> {
    try {
      if (!this.agent.shouldCompact()) return;

      const compactionConfig = this.config.compaction ?? DEFAULT_COMPACTION_CONFIG;

      if (compactionConfig.notifyUser) {
        this.outputArea.append(['', chalk.gray('  正在整理上下文...')]);
        this.tui.requestRender();
      }

      const result = await this.agent.compact();

      if (compactionConfig.notifyUser && result.success) {
        const pct = (result.savingsRatio * 100).toFixed(0);
        this.outputArea.append([
          chalk.gray(
            `  上下文已整理: ${result.beforeEstimatedTokens} → ${result.afterEstimatedTokens} tokens (节省 ${pct}%)`
          ),
          '',
        ]);
        this.tui.requestRender();
      }
    } catch (err) {
      log.warn('自动压缩失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 创建 /compact 手动压缩命令
   */
  private createCompactCommand(): import('@/cli/repl/types').CommandDefinition {
    return {
      name: 'compact',
      aliases: [],
      description: '手动压缩对话上下文',
      usage: '/compact [聚焦主题]',
      handler: async (args: string[], _session: import('@/cli/repl/types').ReplSession) => {
        const focusTopic = args.join(' ') || undefined;

        this.outputArea.append(['', chalk.gray('  正在整理对话上下文...')]);

        if (focusTopic) {
          this.outputArea.append([chalk.gray(`  聚焦主题: ${focusTopic}`)]);
        }

        this.tui.requestRender();

        try {
          const result = await this.agent.compact();

          if (result.success) {
            const pct = (result.savingsRatio * 100).toFixed(0);
            // 清空工具 schema 缓存，避免压缩后的会话使用旧 schema
            this.agent.toolSchemaCache.clear();
            this.outputArea.append([
              chalk.green(
                `  整理完成! ${result.beforeMessageCount} → ${result.afterMessageCount} 条消息`
              ),
              chalk.green(
                `  Token: ${result.beforeEstimatedTokens} → ${result.afterEstimatedTokens} (节省 ${pct}%)`
              ),
              '',
            ]);
          } else {
            this.outputArea.append([chalk.red(`  整理失败: ${result.error ?? '未知错误'}`), '']);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.outputArea.append([chalk.red(`  整理异常: ${message}`), '']);
        }

        this.tui.requestRender();
      },
    };
  }
}
