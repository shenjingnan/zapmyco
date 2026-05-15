/**
 * 自定义编辑器组件
 *
 * 继承自 pi-tui 的 Editor，添加 zapmyco 特有的快捷键处理：
 * - Ctrl+C: 取消任务 / 二次退出
 * - Ctrl+D: 退出
 * - Ctrl+O: 打开外部编辑器编辑输入
 * - Escape: 取消当前输入
 *
 * 同时 override render() 以：
 * - 去掉 Editor 默认的上下边框（───）
 * - 添加简洁的输入提示符（❯ ）
 * - 执行中时显示 loading spinner
 */

import { Editor, Key, matchesKey, truncateToWidth } from '@mariozechner/pi-tui';
import chalk from 'chalk';

/** 输入提示符 */
const PROMPT_PREFIX = '\u276f '; // "❯ "

/** loading 动画帧 */
export const LOADING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** 审批选项定义 */
export interface ApprovalOption {
  key: string;
  label: string;
  action: () => void;
}

/** ANSI 转义码正则（用于从渲染行中剥离颜色标记） */
// biome-ignore lint/complexity/useRegexLiterals: 避免正则字面量中的控制字符
const ANSI_RE = new RegExp(`\\x1b\\[[0-9;]*m`, 'g');

/** 判断一行是否为 Editor 的 border 行（去除 ANSI 转义码后判断） */
function isBorderLine(line: string): boolean {
  const stripped = line.replace(ANSI_RE, '');
  return /^[\s─┌┐├┤└┘↑↓\-0-9a-zA-Z]+$/.test(stripped);
}

export class ZapmycoEditor extends Editor {
  /** Escape 键回调 */
  onEscape?: () => void;

  /** Ctrl+C 回调 */
  onCtrlC?: () => void;

  /** Ctrl+D 回调 */
  onCtrlD?: () => void;

  /** Ctrl+O 回调（打开外部编辑器） */
  onOpenEditor?: () => void;

  /** Ctrl+T / Ctrl+Y 回调（展开/折叠 thinking 内容） */
  onToggleThinking: (() => void) | undefined;

  /** Ctrl+O 回调（展开/折叠 Agent 状态栏）。设置后将覆盖外部编辑器行为。 */
  onToggleAgentBar: (() => void) | undefined;

  /** 是否正在执行（用于显示 loading） */
  #executing = false;

  /** 是否显示 spinner（执行期间禁用输入但不一定显示 spinner） */
  #showSpinner = true;

  /** loading 动画帧索引 */
  #loadingFrame = 0;

  /** loading 动画定时器 */
  #loadingTimer?: ReturnType<typeof setInterval> | undefined;

  /** 审批模式状态 */
  #approvalState: {
    title: string;
    options: ApprovalOption[];
    selectedIndex: number;
  } | null = null;

  /** 进入审批模式，在编辑器区域显示审批选项 */
  enterApprovalMode(title: string, options: ApprovalOption[]): void {
    // 停止 spinner（如果有）
    this.#executing = false;
    if (this.#loadingTimer) {
      clearInterval(this.#loadingTimer);
      this.#loadingTimer = undefined;
    }
    this.#approvalState = { title, options, selectedIndex: 0 };
    this.invalidate();
  }

  /** 退出审批模式，恢复编辑器正常状态 */
  exitApprovalMode(): void {
    this.#approvalState = null;
    this.invalidate();
  }

  /** 是否正处于审批模式 */
  get inApprovalMode(): boolean {
    return this.#approvalState !== null;
  }

  handleInput(data: string): void {
    // 审批模式优先处理
    if (this.#approvalState) {
      this.#handleApprovalInput(data);
      return;
    }
    if (matchesKey(data, Key.escape) && this.onEscape) {
      this.onEscape();
      return;
    }
    if (matchesKey(data, Key.ctrl('c')) && this.onCtrlC) {
      this.onCtrlC();
      return;
    }
    if (matchesKey(data, Key.ctrl('d'))) {
      if (this.getText().length === 0 && this.onCtrlD) {
        this.onCtrlD();
      }
      return;
    }
    if (matchesKey(data, Key.ctrl('o'))) {
      if (this.onToggleAgentBar) {
        this.onToggleAgentBar();
      } else if (this.onOpenEditor) {
        this.onOpenEditor();
      }
      return;
    }
    if (matchesKey(data, Key.ctrl('t')) && this.onToggleThinking) {
      this.onToggleThinking();
      return;
    }
    if (matchesKey(data, Key.ctrl('y')) && this.onToggleThinking) {
      this.onToggleThinking();
      return;
    }
    super.handleInput(data);
  }

  /** 审批模式下的键盘处理 */
  #handleApprovalInput(data: string): void {
    const state = this.#approvalState;
    if (!state) return;

    // Esc / q / Ctrl+C → 取消（调用最后一个选项，通常为"拒绝"）
    if (matchesKey(data, 'escape') || data === 'q' || matchesKey(data, Key.ctrl('c'))) {
      const lastOpt = state.options[state.options.length - 1];
      lastOpt?.action();
      return;
    }

    // ↑ / k → 上移
    if (matchesKey(data, 'up') || data === 'k') {
      state.selectedIndex = Math.max(0, state.selectedIndex - 1);
      this.invalidate();
      return;
    }

    // ↓ / j → 下移
    if (matchesKey(data, 'down') || data === 'j') {
      state.selectedIndex = Math.min(state.options.length - 1, state.selectedIndex + 1);
      this.invalidate();
      return;
    }

    // Tab → 循环切换到下一个选项
    if (matchesKey(data, 'tab')) {
      state.selectedIndex = (state.selectedIndex + 1) % state.options.length;
      this.invalidate();
      return;
    }

    // Enter → 确认当前选项
    if (matchesKey(data, 'enter')) {
      state.options[state.selectedIndex]?.action();
      return;
    }

    // 1-9 → 数字快捷键选择
    if (data >= '1' && data <= '9') {
      const idx = parseInt(data, 10) - 1;
      state.options[idx]?.action();
    }
  }

  /**
   * 设置执行状态（控制 loading spinner 显示）
   * @param executing 是否正在执行
   * @param showSpinner 是否显示 spinner（默认 true）。设为 false 时仅禁用输入，不显示动画
   */
  setExecuting(executing: boolean, showSpinner = true): void {
    if (this.#executing === executing && this.#showSpinner === showSpinner) return;
    this.#executing = executing;
    this.#showSpinner = showSpinner;
    if (executing && showSpinner) {
      this.#loadingFrame = 0;
      this.#loadingTimer = setInterval(() => {
        this.#loadingFrame = (this.#loadingFrame + 1) % LOADING_FRAMES.length;
        this.tui?.requestRender();
      }, 100);
    } else {
      if (this.#loadingTimer) {
        clearInterval(this.#loadingTimer);
        this.#loadingTimer = undefined;
      }
    }
    this.tui?.requestRender();
  }

  get executing(): boolean {
    return this.#executing;
  }

  /**
   * Override render(): 去掉默认的上下边框，添加输入提示符和 loading 状态。
   *
   * 策略：调用 super.render() 获取完整的带边框输出，
   * 然后移除首尾 border 行，再在内容行前添加提示符前缀。
   *
   * 审批模式下渲染审批选项 UI。
   */
  override render(width: number): string[] {
    // 审批模式：渲染审批面板
    if (this.#approvalState) {
      return this.#renderApproval(width);
    }

    const rawLines = super.render(width);

    // Editor 至少有 top-border + content + bottom-border
    if (rawLines.length < 3) {
      return rawLines;
    }

    // 识别并移除 top border 和 bottom border 行
    let startIndex = 0;
    if (isBorderLine(rawLines[0] ?? '')) {
      startIndex = 1;
    }

    let endIndex = rawLines.length;
    if (isBorderLine(rawLines[rawLines.length - 1] ?? '')) {
      endIndex = rawLines.length - 1;
    }

    const contentLines = rawLines.slice(startIndex, endIndex);

    // 计算提示符宽度（grapheme 数量）
    const promptWidth = [...PROMPT_PREFIX].length;

    // 在每行前面添加提示符（续行用空格对齐），并截断到终端宽度
    for (let i = 0; i < contentLines.length; i++) {
      const prefix = i === 0 ? PROMPT_PREFIX : ' '.repeat(promptWidth);

      let line: string;
      // 第一行：如果正在执行且需要显示 spinner，在提示符后追加 loading spinner
      if (i === 0 && this.#executing && this.#showSpinner) {
        const frame = LOADING_FRAMES[this.#loadingFrame];
        line = `${prefix}${frame} ${contentLines[i]}`;
      } else {
        line = prefix + contentLines[i];
      }

      // 截断到终端宽度，避免超宽报错
      contentLines[i] = truncateToWidth(line, width);
    }

    return contentLines;
  }

  /** 渲染审批面板（替换编辑器的常规渲染） */
  #renderApproval(width: number): string[] {
    const state = this.#approvalState;
    if (!state) return [];

    const c = chalk;
    const lines: string[] = [];

    // 灰色分隔线，与输出区域内容分离
    if (width >= 30) {
      lines.push(c.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`));
    } else {
      lines.push('');
    }

    // 标题：是否允许工具 "xxx" 的调用？
    lines.push(c.bold(`  ${state.title}`));
    lines.push('');

    // 选项列表
    for (let i = 0; i < state.options.length; i++) {
      const opt = state.options[i];
      if (!opt) continue;
      const isFocused = state.selectedIndex === i;
      const prefix = isFocused ? c.green('❯') : ' ';
      const keyLabel = c.gray(opt.key);
      const label = isFocused ? c.green.bold(opt.label) : opt.label;
      lines.push(`  ${prefix} ${keyLabel} ${label}`);
    }

    lines.push('');

    // 页脚提示
    if (width >= 50) {
      lines.push(c.gray('  Esc 取消  ·  Tab 切换  ·  1/2/3 快捷选择'));
    } else if (width >= 30) {
      lines.push(c.gray('  Esc 取消  ·  Tab 切换'));
    } else {
      lines.push(c.gray('  Esc 取消'));
    }

    lines.push('');
    return lines;
  }
}
