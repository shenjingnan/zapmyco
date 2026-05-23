/**
 * FocusEvent — 焦点事件
 *
 * dispatchFocus/blur 时使用。
 * relatedTarget 追踪焦点移入/移出的相关元素。
 * 冒泡以匹配 react-dom 的 focusin/focusout 语义。
 */

import { type EventTarget, TerminalEvent } from './terminal-event.js';

export class FocusEvent extends TerminalEvent {
  readonly relatedTarget: EventTarget | null;

  constructor(type: 'focus' | 'blur', relatedTarget: EventTarget | null = null) {
    super(type, { bubbles: true, cancelable: false });
    this.relatedTarget = relatedTarget;
  }
}
