/**
 * 多行编辑器组件
 *
 * 多行编辑器组件。
 * 支持多行文本编辑、光标导航、历史记录和自动补全。
 *
 * 注意：
 * - handleInput() 和 render() 必须为原型方法（非实例字段），
 *   因为 ZapmycoEditor 通过 prototype override 扩展它们。
 * - tui 使用 protected 访问修饰符，使子类可通过 this.tui 访问。
 */

import { Key, matchesKey } from './key';
import { truncateToWidth } from './text-utils';
import type { Component, EditorOptions, EditorTheme } from './types';

/** APC (Application Program Command) 零宽光标标记 */
const CURSOR_MARKER = '\u001B_pi:c\u0007';

/** 判断 data 是否为 Ctrl 组合键（如 Ctrl+C = \x03） */
function isCtrlKey(data: string): boolean {
  if (data.length !== 1) return false;
  const code = data.charCodeAt(0);
  return code >= 0x01 && code <= 0x1a;
}

export class Editor implements Component {
  /** TUI 实例引用（供子类调用 requestRender） */
  protected tui: { requestRender: () => void };

  /** Focusable 接口：TUI 通过此属性管理焦点 */
  focused = false;

  /** 提交回调（Enter 触发） */
  onSubmit?: (value: string) => void;

  /** 当前光标所在行（0-based buffer 行索引） */
  cursorRow = 0;
  /** 当前光标所在列（0-based，字节偏移） */
  cursorCol = 0;
  /** 历史导航索引（-1 表示不在历史导航中） */
  historyIndex = -1;

  /** 文本行缓冲 */
  #buffer: string[] = [''];
  /** 滚动偏移（从第几行开始渲染） */
  #scrollOffset = 0;
  /** 历史记录列表 */
  #history: string[] = [];
  /** Editor 主题（用于 borderColor） */
  #theme: EditorTheme;

  /** 自动补全提供者 */
  #acProvider: any = null;
  /** 补全候选项列表（当前活跃时） */
  #acItems: any[] = [];
  /** 补全匹配前缀 */
  #acPrefix = '';
  /** 当前选中的补全项索引 */
  #acSelected = -1;
  /** 补全是否活跃 */
  #acActive = false;

  constructor(tui: { requestRender: () => void }, theme: EditorTheme, _options?: EditorOptions) {
    this.tui = tui;
    this.#theme = theme;
    // 启用硬件光标，使 TUI 引擎在找到 CURSOR_MARKER 后显示光标
    const tuiExt = tui as {
      requestRender: () => void;
      setShowHardwareCursor?: (v: boolean) => void;
    };
    if (tuiExt.setShowHardwareCursor) {
      tuiExt.setShowHardwareCursor(true);
    }
  }

  // ==================== 文本操作 ====================

  /** 获取当前文本（实际换行符分隔） */
  getText(): string {
    return this.#buffer.join('\n');
  }

  /** 设置文本（替换全部内容） */
  setText(text: string): void {
    this.#buffer = text === '' ? [''] : text.split('\n');
    this.cursorRow = this.#buffer.length - 1;
    this.cursorCol = this.#buffer[this.cursorRow]?.length ?? 0;
    this.#scrollOffset = 0;
    this.historyIndex = -1;
  }

  /**
   * 获取展开后的文本（用于外部编辑器或提交）。
   *
   * 由于我们不在 buffer 中存储软换行（仅在 render() 时做视觉折行），
   * 此方法直接返回 buffer 的实际内容。
   */
  getExpandedText(): string {
    return this.getText();
  }

  // ==================== 历史管理 ====================

  /** 将条目添加到历史记录 */
  addToHistory(entry: string): void {
    this.#history.push(entry);
    this.historyIndex = -1;
  }

  // ==================== 自动补全 ====================

  /** 设置自动补全提供者 */
  setAutocompleteProvider(provider: unknown): void {
    this.#acProvider = provider;
  }

  /** 设置补全列表最大可见项数 */
  setAutocompleteMaxVisible(_n: number): void {
    // 暂不使用
  }

  // ==================== Component 接口 ====================

  invalidate(): void {
    // 无内部缓存，无需操作
  }

  /**
   * 处理输入数据。
   *
   * 原型方法（重要）：ZapmycoEditor 在其 prototype 上 override 此方法，
   * 并通过 super.handleInput(data) 调用此实现。
   */
  handleInput(data: string): void {
    // === Autocomplete 活跃时的特殊处理 ===
    if (this.#acActive && this.#acItems.length > 0) {
      // Escape → 关闭补全
      if (matchesKey(data, Key.escape)) {
        this.#clearAutocomplete();
        return;
      }
      // ↑/↓ → 导航补全列表
      if (matchesKey(data, Key.up)) {
        this.#acSelected = Math.max(0, this.#acSelected - 1);
        this.tui?.requestRender();
        return;
      }
      if (matchesKey(data, Key.down)) {
        this.#acSelected = Math.min(this.#acItems.length - 1, this.#acSelected + 1);
        this.tui?.requestRender();
        return;
      }
      // Tab → 应用补全（选中项或第一项）
      if (matchesKey(data, Key.tab)) {
        const idx = this.#acSelected >= 0 ? this.#acSelected : 0;
        if (idx < this.#acItems.length && this.#acProvider) {
          this.#applyCompletion(this.#acItems[idx]);
          this.#clearAutocomplete();
          this.tui?.requestRender();
        }
        return;
      }
      // Enter → 应用补全（同 Tab）
      if (matchesKey(data, Key.enter)) {
        const idx = this.#acSelected >= 0 ? this.#acSelected : 0;
        if (idx < this.#acItems.length && this.#acProvider) {
          this.#applyCompletion(this.#acItems[idx]);
          this.#clearAutocomplete();
          this.tui?.requestRender();
        }
        return;
      }
    }

    // Enter → 提交
    if (matchesKey(data, Key.enter)) {
      if (this.onSubmit) {
        const text = this.getText();
        this.#buffer = [''];
        this.cursorRow = 0;
        this.cursorCol = 0;
        this.#scrollOffset = 0;
        this.tui?.requestRender();
        this.onSubmit(text);
      }
      return;
    }

    // Escape → 关闭补全（如果有）
    if (matchesKey(data, Key.escape)) {
      if (this.#acActive) {
        this.#clearAutocomplete();
        return;
      }
      return;
    }

    // Backspace
    if (matchesKey(data, Key.backspace)) {
      this.#handleBackspace();
      // 退格后重新触发 autocomplete（若在 slash context 中）
      if (this.#acProvider) {
        const line = this.#buffer[this.cursorRow]!;
        const before = line.slice(0, this.cursorCol);
        if (/(?:^|\s)[/@#][^\s]*$/.test(before)) {
          void this.#requestAutocomplete(false);
        } else {
          this.#clearAutocomplete();
        }
      }
      return;
    }

    // 方向键（非 autocomplete 模式）
    if (matchesKey(data, Key.up)) {
      this.#moveCursorUp();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.#moveCursorDown();
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.#moveCursorLeft();
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.#moveCursorRight();
      return;
    }

    // Home / End
    if (matchesKey(data, 'home')) {
      this.cursorCol = 0;
      return;
    }
    if (matchesKey(data, 'end')) {
      this.cursorCol = this.#buffer[this.cursorRow]?.length ?? 0;
      return;
    }

    // Tab（非 autocomplete 模式）→ 触发补全
    if (matchesKey(data, Key.tab)) {
      if (this.#acProvider) {
        void this.#requestAutocomplete(true);
      } else {
        this.#insertAtCursor('  ');
        this.cursorCol += 2;
      }
      return;
    }

    // Ctrl 组合键
    if (isCtrlKey(data)) {
      return;
    }

    // 可见字符输入
    if (data.length === 1 && data >= ' ') {
      this.#insertAtCursor(data);
      this.cursorCol++;
      this.tui?.requestRender();
      // 输入后检查是否触发 autocomplete
      if (this.#acProvider) {
        const ch = data;
        const line = this.#buffer[this.cursorRow]!;
        const before = line.slice(0, this.cursorCol);
        // 在行首输入 /、@、# 或在这些符号后继续输入字母时触发
        if ((ch === '/' || ch === '@' || ch === '#') && /(?:^|\s)$/.test(before.slice(0, -1))) {
          void this.#requestAutocomplete(false);
        } else if (/[a-zA-Z0-9_-]/.test(ch) && /(?:^|\s)[/@#][^\s]*$/.test(before)) {
          void this.#requestAutocomplete(false);
        }
      }
    }
  }

  /**
   * 渲染编辑器内容。
   *
   * 原型方法（重要）：ZapmycoEditor 在其 prototype 上 override 此方法，
   * 并通过 super.render(width) 调用此实现。
   *
   * 输出格式（与 pi-tui 兼容）：
   *   [border-top]  ┌───┐
   *   [content...]  行内容
   *   [border-bottom] └───┘
   *
   * ZapmycoEditor 的 render() 依赖于 border 行来：
   *   1. 保证 rawLines.length >= 3（border + 内容 + border）
   *   2. 通过 isBorderLine() 识别并移除首尾 border 行
   */
  render(width: number): string[] {
    const borderWidth = Math.max(4, width);
    const contentWidth = borderWidth - 2;
    const contentLines: string[] = [];

    // 记录光标所在的可视行/列（用于嵌入 CURSOR_MARKER）
    let cursorVisualLine = -1;
    let cursorVisualCol = -1;

    for (let i = this.#scrollOffset; i < this.#buffer.length; i++) {
      const line = this.#buffer[i]!;

      if (line.length <= contentWidth) {
        contentLines.push(line);
        // 记录光标位置（非软换行）
        if (i === this.cursorRow) {
          cursorVisualLine = contentLines.length - 1;
          cursorVisualCol = this.cursorCol;
        }
      } else {
        // 软换行：每 contentWidth 个字符折为一行
        for (let j = 0; j < line.length; j += contentWidth) {
          const segment = line.slice(j, j + contentWidth);
          contentLines.push(segment);
          // 检查光标是否在当前 segment 中
          if (i === this.cursorRow && cursorVisualLine < 0) {
            if (this.cursorCol >= j && this.cursorCol < j + contentWidth) {
              cursorVisualLine = contentLines.length - 1;
              cursorVisualCol = this.cursorCol - j;
            }
          }
        }
      }
    }

    // 至少返回一行内容（empty buffer 时）
    if (contentLines.length === 0) {
      contentLines.push('');
      cursorVisualLine = 0;
      cursorVisualCol = 0;
    }

    // 追加 autocomplete 补全列表（在内容末尾，边框内部）
    // 注意：每行必须截断到 contentWidth 以内，否则 TUI 引擎会抛出
    // "Rendered line exceeds terminal width" 异常
    if (this.#acActive && this.#acItems.length > 0) {
      const maxVisible = Math.min(this.#acItems.length, 10);
      for (let i = 0; i < maxVisible; i++) {
        const item = this.#acItems[i];
        if (!item) continue;
        const selected = i === this.#acSelected ? '❯' : ' ';
        const label = item.label ?? item.value ?? '';
        const desc = item.description ? `  ${item.description}` : '';
        // 用 truncateToWidth 截断（其 visibleWidth 会高估 CURSOR_MARKER 的宽度，
        // 但对纯文本 autocomplete 行是准确的，且比终端宽度更窄，保证安全）
        contentLines.push(truncateToWidth(`${selected} ${label}${desc}`, contentWidth));
      }
    }

    // 嵌入光标标记（TUI 引擎在 doRender 中提取此标记来定位硬件光标）
    if (this.focused && cursorVisualLine >= 0) {
      const line = contentLines[cursorVisualLine]!;
      const col = Math.min(cursorVisualCol, line.length);
      contentLines[cursorVisualLine] = line.slice(0, col) + CURSOR_MARKER + line.slice(col);
    }

    // 构建边框（与 pi-tui 格式兼容，使 ZapmycoEditor 的 isBorderLine 能识别）
    const borderText = '─'.repeat(borderWidth - 2);
    const topBorder = this.#theme.borderColor(`┌${borderText}┐`);
    const bottomBorder = this.#theme.borderColor(`└${borderText}┘`);

    return [topBorder, ...contentLines, bottomBorder];
  }

  // ==================== 自动补全私有方法 ====================

  /** 清除 autocomplete 状态 */
  #clearAutocomplete(): void {
    this.#acActive = false;
    this.#acItems = [];
    this.#acPrefix = '';
    this.#acSelected = -1;
    this.tui?.requestRender();
  }

  /** 异步请求自动补全 */
  async #requestAutocomplete(force: boolean): Promise<void> {
    const provider = this.#acProvider;
    if (!provider || typeof provider.getSuggestions !== 'function') return;

    // 保存快照用于后续判断是否仍有效
    const snapshotText = this.getText();
    const snapshotRow = this.cursorRow;
    const snapshotCol = this.cursorCol;

    try {
      const controller = new AbortController();
      const result = await provider.getSuggestions(this.#buffer, this.cursorRow, this.cursorCol, {
        signal: controller.signal,
        force,
      });

      // 检查是否仍有效（文本未变）
      if (
        this.getText() !== snapshotText ||
        this.cursorRow !== snapshotRow ||
        this.cursorCol !== snapshotCol
      ) {
        return;
      }

      if (result && Array.isArray(result.items) && result.items.length > 0) {
        this.#acItems = result.items;
        this.#acPrefix = result.prefix ?? '';
        this.#acSelected = 0;
        this.#acActive = true;
      } else {
        this.#clearAutocomplete();
      }
      this.tui?.requestRender();
    } catch {
      // 请求失败，静默忽略
    }
  }

  /** 应用选中的补全项 */
  #applyCompletion(item: any): void {
    const provider = this.#acProvider;
    if (!provider || typeof provider.applyCompletion !== 'function') return;

    try {
      const result = provider.applyCompletion(
        this.#buffer,
        this.cursorRow,
        this.cursorCol,
        item,
        this.#acPrefix
      );
      if (result) {
        this.#buffer = result.lines;
        this.cursorRow = result.cursorLine;
        this.cursorCol = result.cursorCol;
      }
    } catch {
      // 应用失败，静默忽略
    }
  }

  // ==================== 私有方法 ====================

  /** 在当前光标位置插入文本 */
  #insertAtCursor(text: string): void {
    const line = this.#buffer[this.cursorRow]!;
    this.#buffer[this.cursorRow] =
      line.slice(0, this.cursorCol) + text + line.slice(this.cursorCol);
  }

  /** 处理退格键 */
  #handleBackspace(): void {
    if (this.cursorCol > 0) {
      // 行内删除光标前一字符
      const line = this.#buffer[this.cursorRow]!;
      this.#buffer[this.cursorRow] = line.slice(0, this.cursorCol - 1) + line.slice(this.cursorCol);
      this.cursorCol--;
    } else if (this.cursorRow > 0) {
      // 行首退格：合并到上一行
      const currentLine = this.#buffer[this.cursorRow]!;
      const prevRow = this.cursorRow - 1;
      this.cursorCol = this.#buffer[prevRow]?.length ?? 0;
      this.#buffer[prevRow] = this.#buffer[prevRow]! + currentLine;
      this.#buffer.splice(this.cursorRow, 1);
      this.cursorRow = prevRow;
    }
  }

  /** 光标上移 */
  #moveCursorUp(): void {
    if (this.cursorRow <= 0) return;
    this.cursorRow--;
    this.cursorCol = Math.min(this.cursorCol, this.#buffer[this.cursorRow]?.length ?? 0);
    // 滚动调整：若光标行移出可视区上边界
    if (this.cursorRow < this.#scrollOffset) {
      this.#scrollOffset = this.cursorRow;
    }
  }

  /** 光标下移 */
  #moveCursorDown(): void {
    if (this.cursorRow >= this.#buffer.length - 1) return;
    this.cursorRow++;
    this.cursorCol = Math.min(this.cursorCol, this.#buffer[this.cursorRow]?.length ?? 0);
    // 滚动调整：若光标行移出可视区下边界（由 render 时的 soft wrap 决定）
  }

  /** 光标左移 */
  #moveCursorLeft(): void {
    if (this.cursorCol <= 0) {
      // 行首左移 → 跳到上一行行尾
      if (this.cursorRow > 0) {
        this.cursorRow--;
        this.cursorCol = this.#buffer[this.cursorRow]?.length ?? 0;
      }
    } else {
      this.cursorCol--;
    }
  }

  /** 光标右移 */
  #moveCursorRight(): void {
    const maxCol = this.#buffer[this.cursorRow]?.length ?? 0;
    if (this.cursorCol >= maxCol) {
      // 行尾右移 → 跳到下一行行首
      if (this.cursorRow < this.#buffer.length - 1) {
        this.cursorRow++;
        this.cursorCol = 0;
      }
    } else {
      this.cursorCol++;
    }
  }
}
