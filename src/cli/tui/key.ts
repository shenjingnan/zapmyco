/**
 * 键常量与匹配函数
 *
 * 自建 pi-tui 兼容的 Key 常量和 matchesKey 函数。
 * Key.ctrl('c') 返回 'ctrl+c' 而非对象，与 pi-tui 原始行为不同。
 */

/** 命名键到终端转义序列的映射 */
const NAMED_KEY_MAP: Record<string, string> = {
  escape: '\x1b',
  enter: '\r',
  tab: '\t',
  space: ' ',
  backspace: '\x7f',
  up: '\x1b[A',
  down: '\x1b[B',
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
 * @param data - 原始终端输入数据（通常来自 stdin 'data' 事件）
 * @param keyId - 键标识（如 'escape', 'ctrl+c', 'up'）
 * @returns 是否匹配
 *
 * @example
 * matchesKey('\x1b', 'escape')         → true
 * matchesKey('\r', 'enter')             → true
 * matchesKey('\x03', 'ctrl+c')          → true
 * matchesKey('\x1b[A', 'up')            → true
 */
export function matchesKey(data: string, keyId: string): boolean {
  // 1. 匹配命名键（escape, enter, up, down 等）
  const namedSequence = NAMED_KEY_MAP[keyId];
  if (namedSequence !== undefined) {
    return data === namedSequence;
  }

  // 2. 匹配 shift+tab（特殊转义序列）
  if (keyId === 'shift+tab') {
    return data === '\x1b[Z';
  }

  // 3. 匹配 Ctrl 组合键：ctrl+X 或 ctrl+shift+X
  const ctrlMatch = keyId.match(/^ctrl(?:\+shift)?\+([a-z])$/i);
  if (ctrlMatch) {
    const charCode = ctrlMatch[1]!.toLowerCase().charCodeAt(0);
    // Ctrl 组合键对应 ASCII 控制字符：Ctrl+A=0x01, Ctrl+B=0x02, ..., Ctrl+Z=0x1A
    const ctrlCode = charCode - 96;
    return data === String.fromCharCode(ctrlCode);
  }

  return false;
}
