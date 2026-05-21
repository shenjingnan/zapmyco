/**
 * 键常量与匹配函数
 *
 * Key 常量和 matchesKey 函数。
 * matchesKey 使用本地 parseKey 处理原始终端数据，
 * 支持传统字节、CSI-u (Kitty)、modifyOtherKeys 三种协议。
 */

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
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
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
  pageup: 'pageup',
  pagedown: 'pagedown',

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

/** ESC 控制字符，用于匹配终端转义序列 */
const ESC = String.fromCharCode(0x1b);

/**
 * 本地 parseKey 实现
 *
 * 处理 CSI-u (kitty/iTerm2) 和 modifyOtherKeys 协议。
 * 传统终端序列由 legacyMatch 兜底。
 */
function parseKey(data: string): string | undefined {
  // CSI-u: ESC [ <charCode> ; <modifier> u
  // modifier: 5=Ctrl, 6=Ctrl+Shift
  const csiURe = new RegExp(`^${ESC}\\[(\\d+);(\\d+)u$`);
  const m = data.match(csiURe);
  if (m) {
    // biome-ignore lint/style/noNonNullAssertion: regex guarantees group existence
    const charCode = parseInt(m[1]!, 10);
    // biome-ignore lint/style/noNonNullAssertion: regex guarantees group existence
    const modifier = parseInt(m[2]!, 10);
    const char = String.fromCharCode(charCode).toLowerCase();
    if (modifier === 5) return `ctrl+${char}`;
    if (modifier === 6) return `ctrl+shift+${char}`;
    return undefined;
  }

  // modifyOtherKeys: ESC [ 27 ; <modifier> ; <charCode> ~
  const moKRe = new RegExp(`^${ESC}\\[27;(\\d+);(\\d+)~$`);
  const m2 = data.match(moKRe);
  if (m2) {
    // biome-ignore lint/style/noNonNullAssertion: regex guarantees group existence
    const charCode = parseInt(m2[2]!, 10);
    // biome-ignore lint/style/noNonNullAssertion: regex guarantees group existence
    const modifier = parseInt(m2[1]!, 10);
    const char = String.fromCharCode(charCode).toLowerCase();
    if (modifier === 5) return `ctrl+${char}`;
    if (modifier === 6) return `ctrl+shift+${char}`;
    return undefined;
  }

  return undefined;
}

/**
 * 匹配原始终端输入数据与键标识
 *
 * 先用 parseKey 解析高级协议（CSI-u、modifyOtherKeys），
 * 再回退到传统字节匹配。
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
  // Pre-check: 在 parseKey 之前处理 Ctrl+Home/Ctrl+End 序列。
  // CSI-u 协议将 Home 编码为 H(72)、End 编码为 F(70)，
  // parseKey 会将其解析为 ctrl+h / ctrl+f 导致无法正确匹配 ctrl+home/ctrl+end。
  if (keyId === 'ctrl+home' || keyId === 'ctrl+end') {
    if (legacyMatch(data, keyId)) return true;
  }

  const parsed = parseKey(data);
  if (parsed === keyId) return true;

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

  // Ctrl+Home (xterm modifyOtherKeys: \x1b[1;5H, CSI-u: \x1b[72;5u, modifyOtherKeys mode 2: \x1b[27;5;72~)
  if (keyId === 'ctrl+home') {
    return data === '\x1b[1;5H' || data === '\x1b[72;5u' || data === '\x1b[27;5;72~';
  }
  // Ctrl+End (xterm modifyOtherKeys: \x1b[1;5F, CSI-u: \x1b[70;5u, modifyOtherKeys mode 2: \x1b[27;5;70~)
  if (keyId === 'ctrl+end') {
    return data === '\x1b[1;5F' || data === '\x1b[70;5u' || data === '\x1b[27;5;70~';
  }

  // Ctrl 组合键：ctrl+X → ASCII 控制字符
  const ctrlMatch = keyId.match(/^ctrl(?:\+shift)?\+([a-z])$/i);
  if (ctrlMatch) {
    const charCode = ctrlMatch[1]?.toLowerCase().charCodeAt(0) ?? 0;
    const ctrlCode = charCode - 96;
    return data === String.fromCharCode(ctrlCode);
  }

  return false;
}
