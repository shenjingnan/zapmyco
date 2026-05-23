/**
 * InputEvent — 输入事件（旧式路径）
 *
 * 这是 Ink v4 风格的输入事件，用于驱动 useInput hook。
 * 不走 capture/bubble DOM 树派发，而是直接通过 EventEmitter 发射。
 * 是 parse-keypress 和 useInput 之间的桥梁。
 *
 * parseKey() 是一个 ~190 行的私有函数，将 ParsedKey 映射为
 * useInput 可消费的 (input: string, key: Key) 格式。
 */

import type { ParsedKey } from '../parse-keypress.js';
import { Event } from './event.js';

// ---------------------------------------------------------------------------
// Key 类型（useInput 可消费的格式）
// ---------------------------------------------------------------------------

export type Key = {
  /** 箭头键别名（与 use-input.ts 旧版兼容） */
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  wheelUp: boolean;
  wheelDown: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  fn: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
  super: boolean;
};

// ---------------------------------------------------------------------------
// parseKey — 将 ParsedKey 映射为 [Key, input]
// ---------------------------------------------------------------------------

function parseKey(keypress: ParsedKey): [Key, string] {
  const key: Key = {
    up: false,
    down: false,
    left: false,
    right: false,
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    wheelUp: false,
    wheelDown: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    fn: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
  };

  let input: string;

  // Ctrl 组合
  if (keypress.ctrl && keypress.name) {
    key.ctrl = true;
    input = keypress.name;
    return [key, input];
  }

  const name = keypress.name;

  // CSI u (Kitty) 和 modifyOtherKeys 序列
  if (name === 'return') {
    key.return = true;
    input = '\r';
  } else if (name === 'tab') {
    key.tab = true;
    input = '\t';
  } else if (name === 'backspace') {
    key.backspace = true;
    input = '\b';
  } else if (name === 'escape') {
    key.escape = true;
    input = '\x1b';
  } else if (name === 'delete') {
    key.delete = true;
    input = '\x7f';
  } else if (name === 'up') {
    key.up = true;
    key.upArrow = true;
    input = '\x1b[A';
  } else if (name === 'down') {
    key.down = true;
    key.downArrow = true;
    input = '\x1b[B';
  } else if (name === 'left') {
    key.left = true;
    key.leftArrow = true;
    input = '\x1b[D';
  } else if (name === 'right') {
    key.right = true;
    key.rightArrow = true;
    input = '\x1b[C';
  } else if (name === 'pageup' || name === 'prior') {
    key.pageUp = true;
    input = '\x1b[5~';
  } else if (name === 'pagedown' || name === 'next') {
    key.pageDown = true;
    input = '\x1b[6~';
  } else if (name === 'home') {
    key.home = true;
    input = '\x1b[H';
  } else if (name === 'end') {
    key.end = true;
    input = '\x1b[F';
  } else if (name === 'wheelup') {
    key.wheelUp = true;
    input = '\x1b[<0;0;0M';
  } else if (name === 'wheeldown') {
    key.wheelDown = true;
    input = '\x1b[<1;0;0M';
  } else if (
    name === 'f1' ||
    name === 'f2' ||
    name === 'f3' ||
    name === 'f4' ||
    name === 'f5' ||
    name === 'f6' ||
    name === 'f7' ||
    name === 'f8' ||
    name === 'f9' ||
    name === 'f10' ||
    name === 'f11' ||
    name === 'f12'
  ) {
    key.fn = true;
    input = keypress.sequence;
  } else if (keypress.shift && keypress.name && keypress.name.length === 1) {
    // Shift + 字母
    key.shift = true;
    input = keypress.name.toUpperCase();
  } else if (keypress.meta) {
    key.meta = true;
    input = keypress.name ?? keypress.sequence;
  } else if (name && name.length === 1 && name >= 'a' && name <= 'z') {
    // 普通字母
    input = name;
  } else if (keypress.sequence.length === 1) {
    // 可打印字符
    input = keypress.sequence;
    if (input >= 'A' && input <= 'Z') {
      key.shift = true;
    }
  } else {
    // 无法识别的序列 — 仅当它是完整的转义序列时才发出
    const seq = keypress.sequence;
    if (seq.length >= 2 && seq.startsWith('\x1b[') && seq.endsWith('~')) {
      // 未映射的功能键
      key.fn = true;
    }
    input = seq;
  }

  return [key, input];
}

// ---------------------------------------------------------------------------
// InputEvent
// ---------------------------------------------------------------------------

export class InputEvent extends Event {
  readonly keypress: ParsedKey;
  readonly key: Key;
  readonly input: string;

  constructor(keypress: ParsedKey) {
    super();
    const [key, input] = parseKey(keypress);
    this.keypress = keypress;
    this.key = key;
    this.input = input;
  }
}
