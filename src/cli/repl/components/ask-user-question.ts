/**
 * AskUserQuestion TUI 组件
 *
 * 在 TUI 中以 Overlay 形式展示多选题，支持：
 * - 单选/多选
 * - Tab 导航多问题
 * - "Other" 自定义答案
 * - 预览面板（markdown 文本）
 * - 提交前审查
 *
 * @module cli/repl/components/ask-user-question
 */

import chalk from 'chalk';
import {
  type Component,
  matchesKey,
  type OverlayHandle,
  type OverlayOptions,
  type TUI,
} from '@/cli/tui';
import type {
  AskUserQuestionParams,
  AskUserQuestionResult,
  QuestionAnnotation,
  QuestionAnswer,
  QuestionDefinition,
} from '@/core/question/types';

// ============ 类型 ============

type Phase = 'answering' | 'other_input' | 'reviewing';

interface QuestionState {
  /** 当前选择（单选时为 label，多选时为 labels 数组） */
  selectedLabels: string[];
  /** Other 自定义文本 */
  otherText: string;
}

// ============ 常量 ============

const OVERLAY_OPTIONS: OverlayOptions = {
  width: '100%',
  anchor: 'top-left',
  margin: { top: 1, bottom: 1 },
};

// ============ 工具函数 ============

/** 截断文本到指定宽度 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

// ============ 组件 ============

export class AskUserQuestionComponent implements Component {
  private tui: TUI;
  private questions: QuestionDefinition[];
  private onResolve?: (result: AskUserQuestionResult) => void;
  private onCancel?: () => void;

  // 状态
  private phase: Phase = 'answering';
  private currentQuestionIndex = 0;
  private questionStates: QuestionState[];
  private selectedOptionIndex = 0;
  private otherInputValue = '';
  private showPreview = false;

  constructor(
    tui: TUI,
    params: AskUserQuestionParams,
    onResolve: (result: AskUserQuestionResult) => void,
    onCancel: () => void
  ) {
    this.tui = tui;
    this.questions = params.questions;
    this.onResolve = onResolve;
    this.onCancel = onCancel;

    this.questionStates = this.questions.map(() => ({
      selectedLabels: [],
      otherText: '',
    }));

    // 检测是否有预览内容
    const hasPreview = this.questions.some((q) => q.options.some((o) => o.preview));
    this.showPreview = hasPreview;
  }

  /** 安全获取当前问题 */
  private getCurrentQuestion(): QuestionDefinition {
    return this.questions[this.currentQuestionIndex]!;
  }

  /** 安全获取当前问题的状态 */
  private getCurrentState(): QuestionState {
    return this.questionStates[this.currentQuestionIndex]!;
  }

  // ============ 键盘处理 ============

  handleInput(data: string): void {
    // 全局快捷键
    if (matchesKey(data, 'escape') || data === 'q') {
      if (this.phase === 'other_input') {
        this.phase = 'answering';
        return;
      }
      if (this.phase === 'reviewing') {
        this.phase = 'answering';
        return;
      }
      this.onCancel?.();
      return;
    }

    switch (this.phase) {
      case 'answering':
        this.handleAnsweringInput(data);
        break;
      case 'other_input':
        this.handleOtherInput(data);
        break;
      case 'reviewing':
        this.handleReviewingInput(data);
        break;
    }
  }

  private handleAnsweringInput(data: string): void {
    const q = this.getCurrentQuestion();
    const state = this.getCurrentState();
    const optionCount = q.options.length;

    // 数字快捷键（1-4 对应选项，0 或 5+ 对应 other）
    if (data >= '1' && data <= '9') {
      const idx = Number.parseInt(data, 10) - 1;
      if (idx < optionCount) {
        this.selectOption(idx);
        return;
      }
      if (idx === optionCount) {
        // "Other" 选项
        this.enterOtherInput();
        return;
      }
      return;
    }

    // 方向键 / Vim 风格导航
    if (matchesKey(data, 'up') || data === 'k') {
      if (this.selectedOptionIndex > 0) {
        this.selectedOptionIndex--;
      }
      return;
    }

    if (matchesKey(data, 'down') || data === 'j') {
      if (this.selectedOptionIndex < optionCount) {
        this.selectedOptionIndex++;
      }
      return;
    }

    // Space 切换多选
    if (matchesKey(data, 'space')) {
      if (q.multiSelect && this.selectedOptionIndex < optionCount) {
        this.toggleOption(this.selectedOptionIndex);
      }
      return;
    }

    // Tab / Shift+Tab 问题切换
    if (matchesKey(data, 'tab')) {
      this.advanceQuestion();
      return;
    }

    if (matchesKey(data, 'shift+tab')) {
      if (this.currentQuestionIndex > 0) {
        this.currentQuestionIndex--;
        this.selectedOptionIndex = 0;
      }
      return;
    }

    // Enter 确认
    if (matchesKey(data, 'enter')) {
      if (q.multiSelect) {
        // 多选：确认当前选择集，前进
        if (state.selectedLabels.length > 0) {
          this.advanceQuestion();
        }
      } else {
        // 单选：确认当前选项
        if (this.selectedOptionIndex < optionCount) {
          this.selectOption(this.selectedOptionIndex);
          this.advanceQuestion();
        } else if (this.selectedOptionIndex === optionCount) {
          this.enterOtherInput();
        }
      }
      return;
    }

    // Other 输入
    if (data === 'o') {
      this.enterOtherInput();
      return;
    }

    // 预览切换
    if (data === 'p') {
      this.showPreview = !this.showPreview;
      return;
    }

    // 返回上一题
    if (data === 'h' || matchesKey(data, 'backspace')) {
      if (this.currentQuestionIndex > 0) {
        this.currentQuestionIndex--;
        this.selectedOptionIndex = 0;
      }
      return;
    }
  }

  private handleOtherInput(data: string): void {
    if (matchesKey(data, 'enter')) {
      // 确认自定义输入
      const trimmed = this.otherInputValue.trim();
      if (trimmed) {
        const state = this.getCurrentState();
        state.selectedLabels = [trimmed];
        state.otherText = trimmed;
      }
      this.otherInputValue = '';
      this.phase = 'answering';
      this.advanceQuestion();
      return;
    }

    if (matchesKey(data, 'escape')) {
      this.otherInputValue = '';
      this.phase = 'answering';
      return;
    }

    if (matchesKey(data, 'backspace') || data === '\x7f' || data === '\b') {
      this.otherInputValue = this.otherInputValue.slice(0, -1);
      return;
    }

    // 可见字符
    if (data.length === 1 && data >= ' ' && data <= '~') {
      this.otherInputValue += data;
    }
  }

  private handleReviewingInput(data: string): void {
    if (matchesKey(data, 'enter')) {
      this.submitAnswers();
      return;
    }
    if (matchesKey(data, 'escape')) {
      this.phase = 'answering';
      this.currentQuestionIndex = this.questions.length - 1;
      this.selectedOptionIndex = 0;
      return;
    }
  }

  // ============ 操作 ============

  private selectOption(index: number): void {
    const state = this.getCurrentState();
    const option = this.getCurrentQuestion().options[index]!;

    if (this.getCurrentQuestion().multiSelect) {
      // 多选：切换
      this.toggleOption(index);
    } else {
      // 单选：直接设置
      state.selectedLabels = [option.label];
    }
  }

  private toggleOption(index: number): void {
    const state = this.getCurrentState();
    const option = this.getCurrentQuestion().options[index]!;
    const idx = state.selectedLabels.indexOf(option.label);
    if (idx >= 0) {
      state.selectedLabels.splice(idx, 1);
    } else {
      state.selectedLabels.push(option.label);
    }
  }

  private enterOtherInput(): void {
    this.otherInputValue = this.getCurrentState().otherText;
    this.phase = 'other_input';
  }

  private advanceQuestion(): void {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.currentQuestionIndex++;
      this.selectedOptionIndex = 0;
    } else {
      // 所有问题回答完毕，进入审查
      this.phase = 'reviewing';
    }
  }

  private submitAnswers(): void {
    const answers: Record<string, QuestionAnswer> = {};
    const annotations: Record<string, QuestionAnnotation> = {};

    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i]!;
      const state = this.questionStates[i]!;

      if (q.multiSelect) {
        answers[q.question] = [...state.selectedLabels];
      } else {
        answers[q.question] = state.selectedLabels[0] ?? '';
      }

      if (state.otherText) {
        annotations[q.question] = { notes: `自定义: ${state.otherText}` };
      }
    }

    this.onResolve?.({
      questions: this.questions,
      answers,
      annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
    });
  }

  // ============ 渲染 ============

  invalidate(): void {
    // 无缓存状态需要失效
  }

  render(width: number): string[] {
    switch (this.phase) {
      case 'reviewing':
        return this.renderReview(width);
      case 'other_input':
        return this.renderOtherInput(width);
      default:
        return this.renderQuestion(width);
    }
  }

  private renderQuestion(fullWidth: number): string[] {
    const c = chalk;
    const showPreviewPanel =
      this.showPreview && this.questions.some((q) => q.options.some((o) => o.preview));

    // 分栏：主面板 + 预览面板
    const mainWidth = showPreviewPanel ? Math.floor(fullWidth * 0.58) : fullWidth;
    const previewWidth = showPreviewPanel ? fullWidth - mainWidth - 1 : 0;

    const mainLines = this.renderMainPanel(mainWidth);
    let previewLines: string[] = [];

    if (showPreviewPanel) {
      previewLines = this.renderPreviewPanel(previewWidth);
    }

    // 合并两栏
    const maxLines = Math.max(mainLines.length, previewLines.length);
    const result: string[] = [];

    for (let i = 0; i < maxLines; i++) {
      const left = i < mainLines.length ? mainLines[i] : ' '.repeat(mainWidth);
      const right = i < previewLines.length ? previewLines[i] : '';
      const separator = showPreviewPanel ? c.gray('│') : '';
      result.push(`${left}${separator}${right}`);
    }

    return result;
  }

  private renderMainPanel(width: number): string[] {
    const c = chalk;
    const lines: string[] = [];

    // === 顶部 Tab 栏 ===
    lines.push('');
    lines.push(this.renderTabs(width));
    lines.push(c.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`));
    lines.push('');

    // === 问题文本 ===
    const q = this.getCurrentQuestion();
    const wrappedQuestion = this.wrapText(q.question, width - 4);
    for (const line of wrappedQuestion) {
      lines.push(c.bold(`  ${line}`));
    }
    lines.push('');

    // === 选项列表 ===
    const state = this.getCurrentState();

    for (let i = 0; i < q.options.length; i++) {
      const opt = q.options[i]!;
      const isSelected = q.multiSelect
        ? state.selectedLabels.includes(opt.label)
        : state.selectedLabels[0] === opt.label;
      const isFocused = this.selectedOptionIndex === i;
      const prefix = `${i + 1}`;
      const checkbox = isSelected ? c.green('●') : '○';
      const label = isFocused ? c.cyan.bold(opt.label) : c.bold(opt.label);
      const desc = c.gray(`  ${opt.description}`);

      const line = `  ${c.gray(prefix)} ${checkbox} ${label}`;
      lines.push(line);
      // 焦点选项显示描述
      if (isFocused && opt.description) {
        lines.push(`    ${desc}`);
      }
    }

    // === "Other" 选项 ===
    const otherIdx = q.options.length;
    const isOtherFocused = this.selectedOptionIndex === otherIdx;
    const otherLabel = isOtherFocused ? c.cyan.bold('其他 (自定义)') : c.gray('其他 (自定义)');
    const otherPrefix = `${otherIdx + 1}`;
    lines.push(`  ${c.gray(otherPrefix)} ${otherLabel}`);
    if (isOtherFocused) {
      lines.push(`    ${c.gray('输入自定义答案')}`);
    }

    lines.push('');

    // === Footer ===
    lines.push(c.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`));
    const termHeight = this.tui.terminal.rows;
    const overlayStartRow = 1;
    const footerLines = 3;
    const padding = Math.max(0, termHeight - overlayStartRow - lines.length - footerLines);
    for (let i = 0; i < padding; i++) {
      lines.push('');
    }

    if (q.multiSelect) {
      lines.push(c.gray(`  ${this.buildMultiFooter()}`));
    } else {
      lines.push(c.gray(`  ${this.buildSingleFooter()}`));
    }
    lines.push('');

    return lines;
  }

  private renderTabs(width: number): string {
    const c = chalk;
    const parts: string[] = [];
    void width; // reserved for future adaptive truncation

    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i]!;
      const state = this.questionStates[i]!;
      const isAnswered = state.selectedLabels.length > 0;
      const isCurrent = i === this.currentQuestionIndex;
      const header = truncate(q.header, 10);

      const indicator = isAnswered ? c.green('✓') : c.gray('○');
      let tab: string;
      if (isCurrent) {
        tab = c.bgCyan.black(` ${indicator} ${header} `);
      } else if (isAnswered) {
        tab = c.green(` ${indicator} ${header} `);
      } else {
        tab = c.gray(` ${indicator} ${header} `);
      }
      parts.push(tab);
    }

    // Submit tab
    const submitTab = this.phase === 'reviewing' ? c.bgGreen.black(' 提交 ') : c.gray(' 提交 ');
    parts.push(submitTab);

    return `  ${parts.join(' ')}`;
  }

  private renderPreviewPanel(width: number): string[] {
    const c = chalk;
    const lines: string[] = [];
    const minWidth = 15;

    if (width < minWidth) return lines;

    // 标题
    lines.push(c.bold(' 预览'));
    lines.push(c.gray('─'.repeat(Math.max(0, width - 2))));

    // 获取当前焦点选项的预览
    const q = this.getCurrentQuestion();
    if (this.selectedOptionIndex < q.options.length) {
      const opt = q.options[this.selectedOptionIndex]!;
      if (opt.preview) {
        const previewText = opt.preview;
        const previewLines = previewText.split('\n');
        const maxPreviewLines = 20;
        for (const line of previewLines.slice(0, maxPreviewLines)) {
          lines.push(` ${c.gray(truncate(line, width - 2))}`);
        }
        if (previewLines.length > maxPreviewLines) {
          lines.push(c.gray(` ... 还有 ${previewLines.length - maxPreviewLines} 行`));
        }
      } else {
        lines.push(c.gray(' (无预览)'));
      }
    } else {
      lines.push(c.gray(' (无预览)'));
    }

    // 填充剩余行
    const maxLines = 22;
    while (lines.length < maxLines) {
      lines.push('');
    }

    return lines;
  }

  private renderOtherInput(width: number): string[] {
    const c = chalk;
    const q = this.getCurrentQuestion();
    const lines: string[] = [];

    lines.push('');
    lines.push(this.renderTabs(width));
    lines.push(c.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`));
    lines.push('');
    lines.push(c.bold(`  ${q.question}`));
    lines.push('');
    lines.push(`  输入自定义答案:`);
    lines.push('');
    lines.push(c.yellow(`  > ${this.otherInputValue}█`));
    lines.push('');
    lines.push(c.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`));
    lines.push(c.gray('  Enter 确认  ·  Esc 返回  ·  输入自定义文本'));
    lines.push('');

    return lines;
  }

  private renderReview(width: number): string[] {
    const c = chalk;
    const lines: string[] = [];

    lines.push('');
    lines.push(c.bold('  确认你的答案'));
    lines.push(c.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`));
    lines.push('');

    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i]!;
      const state = this.questionStates[i]!;
      const answer = q.multiSelect
        ? state.selectedLabels.join(', ')
        : (state.selectedLabels[0] ?? c.gray('(未回答)'));
      const header = truncate(q.header, 15);
      lines.push(`  ${c.bold(header)}:  ${answer}`);
    }

    lines.push('');
    lines.push(c.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`));
    lines.push(c.gray('  Enter 提交答案  ·  Esc 返回修改'));
    lines.push('');

    return lines;
  }

  // ============ 辅助 ============

  private buildSingleFooter(): string {
    const parts: string[] = [];
    const q = this.getCurrentQuestion();
    parts.push(`1-${q.options.length} 选择`);
    parts.push('k/j ↑↓ 导航');
    if (q.options.some((o) => o.preview)) parts.push('p 切换预览');
    if (this.questions.length > 1) parts.push('Tab 下一题');
    parts.push('Enter 确认');
    parts.push('o 自定义');
    parts.push('Esc 取消');
    return parts.join('  ·  ');
  }

  private buildMultiFooter(): string {
    const parts: string[] = [];
    const q = this.getCurrentQuestion();
    parts.push(`1-${q.options.length} 切换`);
    parts.push('Space 选择');
    parts.push('k/j ↑↓ 导航');
    if (q.options.some((o) => o.preview)) parts.push('p 切换预览');
    if (this.questions.length > 1) parts.push('Tab 下一题');
    parts.push('Enter 确认选择');
    parts.push('o 自定义');
    parts.push('Esc 取消');
    return parts.join('  ·  ');
  }

  private wrapText(text: string, maxWidth: number): string[] {
    if (text.length <= maxWidth) return [text];
    const lines: string[] = [];
    let remaining = text;
    while (remaining.length > maxWidth) {
      // Try to break at a space
      let breakAt = maxWidth;
      const lastSpace = remaining.lastIndexOf(' ', maxWidth);
      if (lastSpace > maxWidth / 2) {
        breakAt = lastSpace;
      }
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trim();
    }
    if (remaining) lines.push(remaining);
    return lines;
  }
}

// ============ 导出函数 ============

/**
 * 显示 AskUserQuestion 对话框
 *
 * @param tui - TUI 实例
 * @param params - 问题参数
 * @returns 用户回答结果，取消时 reject
 */
export function showAskUserQuestionDialog(
  tui: TUI,
  params: AskUserQuestionParams
): Promise<AskUserQuestionResult> {
  return new Promise((resolve, reject) => {
    let handle: OverlayHandle | null = null;

    const component = new AskUserQuestionComponent(
      tui,
      params,
      (result) => {
        handle?.hide();
        resolve(result);
      },
      () => {
        handle?.hide();
        reject(new Error('用户取消了提问'));
      }
    );

    handle = tui.showOverlay(component, OVERLAY_OPTIONS);
  });
}
