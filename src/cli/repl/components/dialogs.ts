/**
 * Shared dialog components for TUI overlays
 *
 * Extracted from settings-cmd.ts for reuse across the REPL.
 * Provides SelectList and TextInput overlay dialogs.
 */

import chalk from 'chalk';
import type { Renderer } from '@/cli/repl/types';
import {
  type Component,
  Input,
  Key,
  matchesKey,
  type OverlayHandle,
  type OverlayOptions,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  type TUI,
} from '@/cli/tui';
import type { ZapmycoConfig } from '@/config/types';
import { t } from '@/i18n';
import type { ApprovalRequest, ApprovalResponse } from '@/security/types';

// ============ Constants ============

/** Overlay layout options for menus */
const OVERLAY_OPTIONS: OverlayOptions = {
  width: '100%',
  anchor: 'top-left',
  margin: { top: 1, bottom: 1 },
};

const SELECT_THEME: SelectListTheme = {
  selectedPrefix: (text: string) => chalk.green(`❯ ${text}`),
  selectedText: (text: string) => chalk.green.bold(text),
  description: (text: string) => chalk.gray(text),
  scrollInfo: (text: string) => chalk.gray(text),
  noMatch: (text: string) => chalk.red(text),
};

// ============ SelectList with Footer ============

/**
 * Wraps SelectList with a footer hint showing available keybindings.
 * This lets users discover navigation keys without relying on terminal conventions.
 */
class SelectListWithFooter implements Component {
  private selectList: SelectList;
  private tui: TUI;
  private filterText = '';
  private isFiltering = false;

  /** Callbacks stored at wrapper level, forwarded through inner SelectList */
  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;
  /** Called when user presses q/esc — exits settings entirely */
  onExit?: () => void;
  /** Called when user presses backspace/h — goes back one level */
  onBack?: () => void;

  constructor(tui: TUI, items: SelectItem[], maxVisible: number, theme: SelectListTheme) {
    this.tui = tui;
    this.selectList = new SelectList(items, maxVisible, theme);
    // Forward inner callbacks through wrapper properties (resolved at call time)
    this.selectList.onSelect = (item) => {
      this.onSelect?.(item);
    };
    this.selectList.onCancel = () => {
      this.onCancel?.();
    };
  }

  handleInput(data: string): void {
    if (this.isFiltering) {
      // --- Filter mode: capture printable chars, delegate navigation to SelectList ---
      if (data.length === 1 && data >= ' ' && data <= '~') {
        // Printable character → append to filter
        this.filterText += data;
        this.applyFilter();
      } else if (data === 'backspace' || data === '\x7f' || data === '\b') {
        if (this.filterText.length > 0) {
          this.filterText = this.filterText.slice(0, -1);
          this.applyFilter();
        } else {
          // Empty filter + backspace → exit filter mode
          this.isFiltering = false;
          this.resetFilteredItems();
          this.selectList.invalidate();
        }
      } else if (data === 'escape') {
        // Cancel filter → exit filter mode, clear filter, restore full list
        this.isFiltering = false;
        this.filterText = '';
        this.resetFilteredItems();
        this.selectList.invalidate();
      } else if (data === 'enter') {
        // Confirm → exit filter mode (keeps filter applied), delegate to confirm selection
        this.isFiltering = false;
        this.selectList.handleInput('enter');
      } else {
        // Pass through for navigation (arrow keys)
        this.selectList.handleInput(data);
      }
    } else {
      if (data === '/') {
        // Enter filter mode
        this.isFiltering = true;
        this.filterText = '';
        this.selectList.invalidate();
      } else if (matchesKey(data, 'escape') || data === 'q') {
        // Exit settings entirely (same as onCancel's former role, now mapped to exit)
        this.onExit?.();
      } else if (data === 'backspace' || data === '\x7f' || data === '\b' || data === 'h') {
        // Go back one level
        this.onBack?.();
      } else {
        // Normal mode: pass through to SelectList (arrows, enter, etc.)
        this.selectList.handleInput(data);
      }
    }
  }

  /** Apply current filter text to the SelectList (uses includes, not startsWith) */
  private applyFilter(): void {
    const sl = this.selectList as unknown as {
      items: SelectItem[];
      filteredItems: SelectItem[];
      selectedIndex: number;
    };
    if (!this.filterText) {
      sl.filteredItems = [...sl.items];
    } else {
      const lower = this.filterText.toLowerCase();
      sl.filteredItems = sl.items.filter((item) => item.value.toLowerCase().includes(lower));
    }
    sl.selectedIndex = 0;
    this.selectList.invalidate();
  }

  /** Restore SelectList to show all unfiltered items */
  private resetFilteredItems(): void {
    const sl = this.selectList as unknown as {
      items: SelectItem[];
      filteredItems: SelectItem[];
      selectedIndex: number;
    };
    sl.filteredItems = [...sl.items];
    sl.selectedIndex = 0;
  }

  invalidate(): void {
    this.selectList.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = [];

    // Search bar at top when filtering
    if (this.isFiltering) {
      lines.push('');
      lines.push(chalk.cyan(`  /${this.filterText}█`));
      lines.push(chalk.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`));
      lines.push('');
    }

    // SelectList content
    const listLines = this.selectList.render(width);
    lines.push(...listLines);

    // Push footer to the bottom of the terminal by padding with blank lines
    const termHeight = this.tui.terminal.rows;
    const overlayStartRow = 1; // OVERLAY_OPTIONS.margin.top
    const footerLines = 3; // separator + hint + trailing empty
    const padding = Math.max(0, termHeight - overlayStartRow - lines.length - footerLines);
    for (let i = 0; i < padding; i++) {
      lines.push('');
    }

    // Append footer separator and keybinding hints
    if (width >= 50) {
      lines.push(chalk.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`));
      if (this.isFiltering) {
        lines.push(chalk.gray(`  ${t('dialog.footer.search')}`));
      } else {
        lines.push(chalk.gray(`  ${t('dialog.footer.normal')}`));
      }
    } else {
      if (this.isFiltering) {
        lines.push(chalk.gray(`  ${t('dialog.footer.searchNarrow')}`));
      } else {
        lines.push(chalk.gray(`  ${t('dialog.footer.normalNarrow')}`));
      }
    }
    lines.push('');
    return lines;
  }
}

// ============ Overlay Helpers ============

/**
 * Show a SelectList overlay and wait for user selection
 * @returns The selected item, or null if cancelled
 */
export function showSelectList(
  tui: TUI,
  items: SelectItem[],
  options?: { maxVisible?: number; title?: string; onExit?: () => void }
): Promise<SelectItem | null> {
  return new Promise((resolve) => {
    const list = new SelectListWithFooter(tui, items, options?.maxVisible ?? 10, SELECT_THEME);
    let handle: OverlayHandle | null = null;

    list.onSelect = (item: SelectItem) => {
      handle?.hide();
      resolve(item);
    };
    list.onCancel = () => {
      handle?.hide();
      resolve(null);
    };
    list.onExit = () => {
      handle?.hide();
      resolve(null);
      options?.onExit?.();
    };
    list.onBack = () => {
      handle?.hide();
      resolve(null);
    };

    handle = tui.showOverlay(list, OVERLAY_OPTIONS);
  });
}

// ============ Text Input Component (for API Key / Base URL) ============

class TextInputComponent implements Component {
  private input: Input;
  private label: string;

  constructor(
    label: string,
    initialValue: string,
    placeholder: string,
    onSubmit: (value: string) => void,
    onCancel: () => void
  ) {
    this.label = label;
    this.input = new Input();
    if (initialValue) {
      this.input.setValue(initialValue);
    }

    this.input.onSubmit = (value: string) => {
      const finalValue = value === placeholder ? initialValue : value;
      onSubmit(finalValue);
    };
    this.input.onEscape = () => {
      onCancel();
    };
  }

  get focused(): boolean {
    return this.input.focused;
  }

  set focused(v: boolean) {
    this.input.focused = v;
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const c = chalk;
    return [
      '',
      c.bold(`  ${this.label}`),
      '',
      c.gray(`  ${'─'.repeat(Math.min(width - 4, 50))}`),
      `  ${this.input.render(width - 4)[0] ?? ''}`,
      c.gray(`  ${'─'.repeat(Math.min(width - 4, 50))}`),
      '',
      c.gray(`  ${t('dialog.footer.textInput')}`),
      '',
    ];
  }
}

/**
 * Show a text input overlay
 * @returns The entered text, or null if cancelled
 */
export function showTextInput(
  tui: TUI,
  label: string,
  initialValue: string,
  placeholder?: string
): Promise<string | null> {
  return new Promise((resolve) => {
    let handle: OverlayHandle | null = null;

    const component = new TextInputComponent(
      label,
      initialValue,
      placeholder ?? '',
      (value: string) => {
        handle?.hide();
        resolve(value);
      },
      () => {
        handle?.hide();
        resolve(null);
      }
    );

    handle = tui.showOverlay(component, {
      width: '60%',
      minWidth: 50,
      maxHeight: 12,
      anchor: 'top-left',
    });
  });
}

// ============ Config View (dismissible overlay) ============

/**
 * A simple overlay component that displays configuration text
 * and dismisses on q/Esc/Enter/BS/h.
 */
class ConfigViewComponent implements Component {
  private readonly lines: string[];
  private onDismiss?: () => void;

  constructor(config: ZapmycoConfig, renderer: Renderer) {
    this.lines = renderer.renderConfig(config);
  }

  /** Set the dismiss callback from showConfigView */
  setDismissCallback(cb: () => void): void {
    this.onDismiss = cb;
  }

  handleInput(data: string): void {
    if (
      data === 'escape' ||
      data === 'q' ||
      data === 'enter' ||
      data === 'backspace' ||
      data === '\x7f' ||
      data === '\b' ||
      data === 'h'
    ) {
      this.onDismiss?.();
    }
  }

  invalidate(): void {
    // No cached state to invalidate
  }

  render(width: number): string[] {
    if (width < 50) {
      return [...this.lines, '', chalk.gray(`  ${t('dialog.configView.narrow')}`)];
    }
    return [
      ...this.lines,
      '',
      chalk.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`),
      chalk.gray(`  ${t('dialog.configView.wide')}`),
      '',
    ];
  }
}

/**
 * Show the current configuration as a dismissible overlay.
 * Returns when the user dismisses it.
 */
export function showConfigView(tui: TUI, config: ZapmycoConfig, renderer: Renderer): Promise<void> {
  return new Promise((resolve) => {
    const component = new ConfigViewComponent(config, renderer);
    const handle = tui.showOverlay(component, {
      width: '100%',
      anchor: 'top-left',
      margin: { top: 1, bottom: 1 },
    });

    component.setDismissCallback(() => {
      handle.hide();
      resolve();
    });
  });
}

// ============ Security Approval Dialog ============

/**
 * 安全审批对话框组件
 *
 * Claude Code 风格的简洁审批对话框，一句话说清审批内容。
 * 支持方向键 + Tab 导航、Enter 确认，以及数字键快捷操作。
 *
 * 键位：
 *   ↑/k 上移   ↓/j 下移   Tab 切换   Enter 确认
 *   1 允许本次   2 本次会话始终允许   3 拒绝   Esc 取消
 */
class ApprovalDialogComponent implements Component {
  private readonly request: ApprovalRequest;
  private onResolve?: (response: ApprovalResponse) => void;
  private selectedOptionIndex = 0;

  private OPTIONS = [
    {
      label: '允许本次',
      action: () => this.onResolve?.({ approved: true, scope: 'once' }),
    },
    {
      label: '本次会话始终允许',
      action: () => this.onResolve?.({ approved: true, scope: 'session' }),
    },
    {
      label: '拒绝',
      action: () => this.onResolve?.({ approved: false }),
    },
  ] as const;

  constructor(request: ApprovalRequest, onResolve: (response: ApprovalResponse) => void) {
    this.request = request;
    this.onResolve = onResolve;
  }

  handleInput(data: string): void {
    // Escape / q / Ctrl+C → 取消
    if (matchesKey(data, 'escape') || data === 'q' || matchesKey(data, Key.ctrl('c'))) {
      this.onResolve?.({ approved: false });
      return;
    }

    // ↑/k → 上移
    if (matchesKey(data, 'up') || data === 'k') {
      if (this.selectedOptionIndex > 0) {
        this.selectedOptionIndex--;
      }
      return;
    }

    // ↓/j → 下移
    if (matchesKey(data, 'down') || data === 'j') {
      if (this.selectedOptionIndex < this.OPTIONS.length - 1) {
        this.selectedOptionIndex++;
      }
      return;
    }

    // Tab → 循环切换到下一个选项
    if (matchesKey(data, 'tab')) {
      this.selectedOptionIndex = (this.selectedOptionIndex + 1) % this.OPTIONS.length;
      return;
    }

    // Enter → 确认当前选项
    if (matchesKey(data, 'enter')) {
      this.OPTIONS[this.selectedOptionIndex]?.action();
      return;
    }

    // 数字快捷键：1 → 允许本次, 2 → 本次会话始终允许, 3 → 拒绝
    if (data === '1') this.OPTIONS[0]?.action();
    else if (data === '2') this.OPTIONS[1]?.action();
    else if (data === '3') this.OPTIONS[2]?.action();
  }

  invalidate(): void {
    // No cached state
  }

  render(width: number): string[] {
    const c = chalk;
    const lines: string[] = [''];

    // 标题：是否允许工具 "ToolId(keyParam)" 的调用？
    const paramEntries = Object.entries(this.request.params);
    let paramSuffix = '';
    if (paramEntries.length > 0) {
      const [, value] = paramEntries[0]!;
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      paramSuffix = raw.length > 50 ? `${raw.slice(0, 47)}...` : raw;
    }
    lines.push(
      c.bold(
        `  是否允许工具 "${this.request.toolId}${paramSuffix ? `(${paramSuffix})` : ''}" 的调用？`
      )
    );
    lines.push('');

    // 操作选项列表（支持方向键/Tab 导航 + 数字键选择）
    const keyLabels = ['1', '2', '3'];
    for (let i = 0; i < this.OPTIONS.length; i++) {
      const opt = this.OPTIONS[i]!;
      const isFocused = this.selectedOptionIndex === i;
      const prefix = isFocused ? c.green('❯') : ' ';
      const keyLabel = c.gray(keyLabels[i] ?? `${i + 1}`);
      const label = isFocused ? c.green.bold(opt.label) : opt.label;
      lines.push(`  ${prefix} ${keyLabel} ${label}`);
    }

    lines.push('');

    // 页脚提示（仅保留非常规操作）
    if (width >= 40) {
      lines.push(c.gray('  Esc 取消  ·  Tab 切换'));
    } else {
      lines.push(c.gray('  Esc 取消'));
    }
    lines.push('');

    return lines;
  }
}

/**
 * 显示安全审批对话框
 *
 * @param tui - TUI 实例
 * @param request - 审批请求
 * @returns 审批响应（用户选择）
 */
/** @internal 导出用于测试 */
export { ApprovalDialogComponent as ApprovalDialogComponentForTesting };

export function showApprovalDialog(tui: TUI, request: ApprovalRequest): Promise<ApprovalResponse> {
  return new Promise((resolve) => {
    let handle: OverlayHandle | null = null;

    const component = new ApprovalDialogComponent(request, (response) => {
      handle?.hide();
      resolve(response);
    });

    handle = tui.showOverlay(component, {
      width: '80%',
      minWidth: 50,
      maxHeight: 12,
      anchor: 'top-left',
      margin: { top: 2, bottom: 1 },
    });
  });
}
