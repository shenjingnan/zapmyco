/**
 * KeyboardEvent — 键盘事件
 *
 * 遵循浏览器 KeyboardEvent 语义。
 * 从 ParsedKey 构建，通过 Dispatcher 在 DOM 树中 capture/bubble 派发。
 */

import type { ParsedKey } from '../parse-keypress.js';
import { TerminalEvent } from './terminal-event.js';

// ---------------------------------------------------------------------------
// keyFromParsed — 将 ParsedKey 映射为浏览器兼容的 key 字符串
// ---------------------------------------------------------------------------

function keyFromParsed(parsed: ParsedKey): string {
  // Ctrl 组合：返回名称（浏览器兼容：Ctrl+C → e.key === 'c'）
  if (parsed.ctrl && parsed.name) {
    return parsed.name;
  }

  // 可打印字符（0x20–0x7E，不含 DEL）
  const seq = parsed.sequence;
  if (seq.length === 1) {
    const code = seq.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      return seq;
    }
  }

  // 特殊键（箭头、功能键、回车、Tab、Escape 等）
  if (parsed.name) {
    return parsed.name;
  }

  // 回退到原始序列
  return seq;
}

// ---------------------------------------------------------------------------
// KeyboardEvent
// ---------------------------------------------------------------------------

export class KeyboardEvent extends TerminalEvent {
  readonly key: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly superKey: boolean;
  readonly fn: boolean;

  constructor(parsedKey: ParsedKey) {
    super('keydown', { bubbles: true, cancelable: true });
    this.key = keyFromParsed(parsedKey);
    this.ctrl = parsedKey.ctrl;
    this.shift = parsedKey.shift;
    this.meta = parsedKey.meta || parsedKey.option;
    this.superKey = parsedKey.super;
    this.fn = parsedKey.fn;
  }
}
