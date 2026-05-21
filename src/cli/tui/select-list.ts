/**
 * SelectList 组件
 *
 * 可搜索的选择列表组件。
 * 支持方向键/Vim 键导航、Enter 确认、Escape 取消、虚拟滚动、theme 样式。
 */

import { matchesKey } from './key';
import type { Component, SelectItem, SelectListTheme } from './types';

export class SelectList implements Component {
  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;
  onHighlight?: (item: SelectItem) => void;

  /** 公有属性 — 供 SelectListWithFooter 通过 as unknown as 直接访问 */
  items: SelectItem[];
  filteredItems: SelectItem[];
  selectedIndex: number;

  private maxVisible: number;
  private theme: SelectListTheme;
  private cache?: { width: number; lines: string[] };

  constructor(items: SelectItem[], maxVisible: number, theme: SelectListTheme) {
    this.items = items;
    this.filteredItems = [...items];
    this.selectedIndex = 0;
    this.maxVisible = maxVisible;
    this.theme = theme;
  }

  handleInput(data: string): void {
    // 下移
    if (matchesKey(data, 'down') || data === 'j') {
      if (this.selectedIndex < this.filteredItems.length - 1) {
        this.selectedIndex++;
      }
      return;
    }

    // 上移
    if (matchesKey(data, 'up') || data === 'k') {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
      }
      return;
    }

    // 确认选择
    if (matchesKey(data, 'enter')) {
      const item = this.filteredItems[this.selectedIndex];
      if (item) this.onSelect?.(item);
      return;
    }

    // 取消
    if (matchesKey(data, 'escape')) {
      this.onCancel?.();
    }
  }

  render(width: number): string[] {
    // 命中缓存
    if (this.cache?.width === width) return this.cache.lines;

    const lines: string[] = [];
    const total = this.filteredItems.length;

    if (total === 0) {
      lines.push(this.theme.noMatch('  No matches found'));
      this.cache = { width, lines };
      return lines;
    }

    // 虚拟滚动：选中项居中显示
    const half = Math.floor(this.maxVisible / 2);
    let start = Math.max(0, this.selectedIndex - half);
    const end = Math.min(total, start + this.maxVisible);
    if (end - start < this.maxVisible) {
      start = Math.max(0, end - this.maxVisible);
    }

    for (let i = start; i < end; i++) {
      const item = this.filteredItems[i];
      if (!item) continue;

      const isSelected = i === this.selectedIndex;
      const prefix = isSelected ? this.theme.selectedPrefix('❯') : '  ';
      const label = isSelected ? this.theme.selectedText(item.label) : item.label;
      const desc = item.description ? ` ${this.theme.description(item.description)}` : '';

      const line = `${prefix} ${label}${desc}`;
      lines.push(line.slice(0, width));
    }

    // 滚动信息
    if (total > this.maxVisible) {
      const info = `  Page ${this.selectedIndex + 1}-${Math.min(this.selectedIndex + this.maxVisible, total)} of ${total}`;
      lines.push(this.theme.scrollInfo(info));
    }

    this.cache = { width, lines };
    return lines;
  }

  invalidate(): void {
    delete this.cache;
  }
}
