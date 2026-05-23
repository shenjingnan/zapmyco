/**
 * TerminalFocusEvent — 终端焦点事件
 *
 * 当终端窗口获得或失去焦点时（DECSET 1004 焦点报告）触发。
 * 终端的信号：CSI I → focus, CSI O → blur。
 * 由 App.tsx 在 processKeysInBatch 中解析并发射。
 */

import { Event } from './event.js';

export type TerminalFocusEventType = 'terminalfocus' | 'terminalblur';

export class TerminalFocusEvent extends Event {
  readonly type: TerminalFocusEventType;

  constructor(type: TerminalFocusEventType) {
    super();
    this.type = type;
  }
}
