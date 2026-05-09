/**
 * Shared dialog components for TUI overlays
 *
 * Extracted from settings-cmd.ts for reuse across the REPL.
 * Provides SelectList and TextInput overlay dialogs.
 */

import {
  type Component,
  Input,
  type OverlayHandle,
  type OverlayOptions,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  type TUI,
} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import type { Renderer } from '@/cli/repl/types';
import type { ZapmycoConfig } from '@/config/types';
import { t } from '@/i18n';

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
      } else if (data === 'escape' || data === 'q') {
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
