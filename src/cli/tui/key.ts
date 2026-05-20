/**
 * 键常量与匹配函数
 *
 * 自建 pi-tui 兼容的 Key 常量和 matchesKey 函数。
 * matchesKey 内部使用 pi-tui 的 parseKey 处理原始终端数据，
 * 支持传统字节、CSI-u (Kitty)、modifyOtherKeys 三种协议。
 *
 * 注意：PR 5 将替换 parseKey 为本地实现。
 */

import { parseKey } from '@earendil-works/pi-tui';

/** 命名键到终端转义序列的映射（用于反向查找） */
const NAMED_KEY_MAP: Record<string, string> = {
  escape: '\x1b',
  enter: '\r',
  tab: '\t',
  space: ' ',
  backspace: '\x7f',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  home: '\x1b[H',
  end: '\x1b[F',
};

/**
 * Key 常量对象
 *
 * 提供命名键常量和 Ctrl 修饰键工厂函数。
 */
export const Key = {
  escape: 'escape',
  enter: 'enter',
  tab: 'tab',
  space: 'space',
  backspace: 'backspace',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',

  /**
   * 创建 Ctrl 组合键标识
   * @example Key.ctrl('c') → 'ctrl+c'
   */
  ctrl: (key: string): string => `ctrl+${key}`,

  /**
   * 创建 Ctrl+Shift 组合键标识
   * @example Key.ctrlShift('c') → 'ctrl+shift+c'
   */
  ctrlShift: (key: string): string => `ctrl+shift+${key}`,
} as const;

/**
 * 匹配原始终端输入数据与键标识
 *
 * 委托给 pi-tui 的 parseKey 解析原始数据，再与 keyId 比较。
 * 同时保留传统字节匹配作为备用（parseKey 可能返回 undefined）。
 *
 * @param data - 原始终端输入数据（通常来自 stdin 'data' 事件）
 * @param keyId - 键标识（如 'escape', 'ctrl+c', 'up'）
 * @returns 是否匹配
 *
 * @example
 * matchesKey('\x1b', 'escape')         → true
 * matchesKey('\r', 'enter')             → true
 * matchesKey('\x03', 'ctrl+c')          → true
 * matchesKey('\x1b[A', 'up')            → true
 * matchesKey('\x1b[99;5u', 'ctrl+c')    → true (CSI-u 协议，iTerm2)
 */
export function matchesKey(data: string, keyId: string): boolean {
  // 1. 用 pi-tui 的 parseKey 解析原始数据
  //    parseKey 处理所有协议格式，返回类似 'ctrl+c' 的键标识
  const parsed = parseKey(data);
  if (parsed === keyId) return true;

  // 2. 如果 parseKey 未识别（返回 undefined），回退到传统匹配
  if (parsed === undefined) {
    return legacyMatch(data, keyId);
  }

  return false;
}

/** 传统字节级匹配（不使用 parseKey 时的备用方案） */
function legacyMatch(data: string, keyId: string): boolean {
  // 命名键匹配
  const namedSequence = NAMED_KEY_MAP[keyId];
  if (namedSequence !== undefined) {
    return data === namedSequence;
  }

  // shift+tab
  if (keyId === 'shift+tab') {
    return data === '\x1b[Z';
  }

  // Ctrl 组合键：ctrl+X → ASCII 控制字符
  const ctrlMatch = keyId.match(/^ctrl(?:\+shift)?\+([a-z])$/i);
  if (ctrlMatch) {
    const charCode = ctrlMatch[1]!.toLowerCase().charCodeAt(0);
    const ctrlCode = charCode - 96;
    return data === String.fromCharCode(ctrlCode);
  }

  return false;
}
