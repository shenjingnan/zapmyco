/**
 * Input 组件
 *
 * 单行文本输入框。
 * 支持 Enter 提交、Escape 取消、方向键移动光标、Home/End、退格删除。
 */

import { matchesKey } from './key';
import type { Component } from './types';

export class Input implements Component {
  focused: boolean = true;
  onSubmit?: (value: string) => void;
  onEscape?: () => void;

  #value = '';
  #cursorPos = 0;

  setValue(v: string): void {
    this.#value = v;
    this.#cursorPos = v.length;
  }

  getValue(): string {
    return this.#value;
  }

  handleInput(data: string): void {
    // Enter → 提交
    if (matchesKey(data, 'enter')) {
      this.onSubmit?.(this.#value);
      return;
    }

    // Escape → 取消
    if (matchesKey(data, 'escape')) {
      this.onEscape?.();
      return;
    }

    // 退格删除光标前字符
    if (data === 'backspace' || data === '\x7f' || data === '\b') {
      if (this.#cursorPos > 0) {
        this.#value =
          this.#value.slice(0, this.#cursorPos - 1) + this.#value.slice(this.#cursorPos);
        this.#cursorPos--;
      }
      return;
    }

    // 方向键移动光标
    if (matchesKey(data, 'left')) {
      if (this.#cursorPos > 0) this.#cursorPos--;
      return;
    }

    if (matchesKey(data, 'right')) {
      if (this.#cursorPos < this.#value.length) this.#cursorPos++;
      return;
    }

    if (matchesKey(data, 'home')) {
      this.#cursorPos = 0;
      return;
    }

    if (matchesKey(data, 'end')) {
      this.#cursorPos = this.#value.length;
      return;
    }

    // 可见字符 → 插入到光标位置
    if (data.length === 1 && data >= ' ' && data <= '~') {
      this.#value =
        this.#value.slice(0, this.#cursorPos) + data + this.#value.slice(this.#cursorPos);
      this.#cursorPos++;
    }
  }

  render(width: number): string[] {
    const beforeCursor = this.#value.slice(0, this.#cursorPos);
    const afterCursor = this.#value.slice(this.#cursorPos);
    const display = `${beforeCursor}█${afterCursor}`;
    return [display.slice(0, width)];
  }

  invalidate(): void {
    // 无缓存
  }
}
