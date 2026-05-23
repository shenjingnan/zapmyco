/**
 * CSI (Control Sequence Introducer) 序列生成器
 *
 * 生成终端控制序列，如光标移动、擦除、滚动等。
 * 参考 claude-code src/ink/termio/csi.ts
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** ESC 控制字符 */
export const ESC = '\x1b';

/** CSI 前缀: ESC [ */
export const CSI_PREFIX = `${ESC}[`;

/** 参数分隔符 */
export const SEP = ';';

// ---------------------------------------------------------------------------
// CSI 序列构建
// ---------------------------------------------------------------------------

/**
 * 生成 CSI 序列: ESC [ params... final
 * 单参数：视为原始 body
 * 多参数：最后一个作为 final 字节，前面的作为参数用 ; 连接
 *
 * @example
 * csi(2, 'J')        // → '\x1b[2J'  (擦除整个屏幕)
 * csi(3, 'S')        // → '\x1b[3S'  (向上滚动 3 行)
 * csi('?25l')        // → '\x1b[?25l' (隐藏光标)
 */
export function csi(...args: (string | number)[]): string {
  if (args.length === 0) return CSI_PREFIX;
  if (args.length === 1) return `${CSI_PREFIX}${args[0]}`;
  const params = args.slice(0, -1);
  const final = args[args.length - 1];
  return `${CSI_PREFIX}${params.join(SEP)}${final}`;
}

// ---------------------------------------------------------------------------
// 光标移动
// ---------------------------------------------------------------------------

/** 光标上移 n 行 (CSI n A) */
export function cursorUp(n = 1): string {
  return n === 0 ? '' : csi(n, 'A');
}

/** 光标下移 n 行 (CSI n B) */
export function cursorDown(n = 1): string {
  return n === 0 ? '' : csi(n, 'B');
}

/** 光标右移 n 列 (CSI n C) */
export function cursorForward(n = 1): string {
  return n === 0 ? '' : csi(n, 'C');
}

/** 光标左移 n 列 (CSI n D) */
export function cursorBack(n = 1): string {
  return n === 0 ? '' : csi(n, 'D');
}

/** 光标移动到第 col 列 (1-indexed) (CSI n G) */
export function cursorTo(col: number): string {
  return csi(col, 'G');
}

/** 光标移动到第 1 列 */
export const CURSOR_LEFT = csi('G');

/** 光标移动到 row, col (1-indexed) (CSI row;col H) */
export function cursorPosition(row: number, col: number): string {
  return csi(row, col, 'H');
}

/** 光标移动到 (1,1) */
export const CURSOR_HOME = csi('H');

/**
 * 相对移动光标
 * 正 x = 右移, 负 x = 左移
 * 正 y = 下移, 负 y = 上移
 */
export function cursorMove(x: number, y: number): string {
  let result = '';
  if (x < 0) {
    result += cursorBack(-x);
  } else if (x > 0) {
    result += cursorForward(x);
  }
  if (y < 0) {
    result += cursorUp(-y);
  } else if (y > 0) {
    result += cursorDown(y);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 保存/恢复光标
// ---------------------------------------------------------------------------

/** 保存光标位置 (CSI s) */
export const CURSOR_SAVE = csi('s');

/** 恢复光标位置 (CSI u) */
export const CURSOR_RESTORE = csi('u');

// ---------------------------------------------------------------------------
// 擦除
// ---------------------------------------------------------------------------

/** 从光标擦除到行尾 (CSI K) */
export const ERASE_TO_END_OF_LINE = csi('K');

/** 从光标擦除到行首 (CSI 1 K) */
export const ERASE_TO_START_OF_LINE = csi(1, 'K');

/** 擦除整行 (CSI 2 K) */
export function eraseLine(): string {
  return csi(2, 'K');
}

/** 擦除整行常量 */
export const ERASE_LINE = csi(2, 'K');

/** 擦除多行 — 从当前行开始向上擦除 count 行 */
export function eraseLines(count: number): string {
  if (count <= 0) return '';
  let result = '';
  for (let i = 0; i < count; i++) {
    result += ERASE_LINE;
    if (i < count - 1) {
      result += cursorUp(1);
    }
  }
  result += CURSOR_LEFT;
  return result;
}

// ---------------------------------------------------------------------------
// 滚动
// ---------------------------------------------------------------------------

/** 向上滚动 n 行 (CSI n S) */
export function scrollUp(n = 1): string {
  return n === 0 ? '' : csi(n, 'S');
}

/** 向下滚动 n 行 (CSI n T) */
export function scrollDown(n = 1): string {
  return n === 0 ? '' : csi(n, 'T');
}

/** 设置滚动区域 DECSTBM (CSI top;bottom r)，1-indexed inclusive */
export function setScrollRegion(top: number, bottom: number): string {
  return csi(top, bottom, 'r');
}

/** 重置滚动区域为全屏 (CSI r) */
export const RESET_SCROLL_REGION = csi('r');

// ---------------------------------------------------------------------------
// 光标样式
// ---------------------------------------------------------------------------

/** 设置光标样式 (DECSCUSR — CSI n q) */
export function setCursorStyle(n: number): string {
  return csi(n, 'q');
}

/** 隐藏光标 (CSI ?25l) */
export const CURSOR_HIDE = csi('?25l');

/** 显示光标 (CSI ?25h) */
export const CURSOR_SHOW = csi('?25h');

// ---------------------------------------------------------------------------
// 括号粘贴模式
// ---------------------------------------------------------------------------

/** 括号粘贴开始标记 (CSI 200~) */
export const PASTE_START = csi('200~');

/** 括号粘贴结束标记 (CSI 201~) */
export const PASTE_END = csi('201~');

// ---------------------------------------------------------------------------
// 终端焦点事件
// ---------------------------------------------------------------------------

/** 终端焦点得到 (CSI I) */
export const FOCUS_IN = csi('I');

/** 终端焦点失去 (CSI O) */
export const FOCUS_OUT = csi('O');

// ---------------------------------------------------------------------------
// Kitty 键盘协议
// ---------------------------------------------------------------------------

/** 启用 Kitty 键盘协议 (CSI > 1 u) */
export const ENABLE_KITTY_KEYBOARD = csi('>1u');

/** 禁用 Kitty 键盘协议 (CSI < u) */
export const DISABLE_KITTY_KEYBOARD = csi('<u');

/** 启用 xterm modifyOtherKeys 级别 2 (CSI > 4;2 m) */
export const ENABLE_MODIFY_OTHER_KEYS = csi('>4;2m');

/** 禁用 xterm modifyOtherKeys (CSI > 4 m) */
export const DISABLE_MODIFY_OTHER_KEYS = csi('>4m');

// ---------------------------------------------------------------------------
// CSI 字节类型检查
// ---------------------------------------------------------------------------

/** CSI 参数字节范围: 0x30–0x3F */
export function isCSIParam(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x3f;
}

/** CSI 中间字节范围: 0x20–0x2F */
export function isCSIIntermediate(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x2f;
}

/** CSI 终止字节范围: 0x40–0x7E */
export function isCSIFinal(byte: number): boolean {
  return byte >= 0x40 && byte <= 0x7e;
}

// ---------------------------------------------------------------------------
// 擦除屏幕
// ---------------------------------------------------------------------------

/** 擦除整个屏幕 (CSI 2 J) */
export function eraseScreen(): string {
  return csi(2, 'J');
}

/** 擦除整个屏幕常量 */
export const ERASE_SCREEN = csi(2, 'J');

/** 擦除滚动缓冲区 (CSI 3 J) */
export const ERASE_SCROLLBACK = csi(3, 'J');

/** 从光标位置擦除到屏幕末尾 (CSI 0 J) */
export function eraseToEndOfScreen(): string {
  return csi('J');
}

/** 从光标位置擦除到屏幕开头 (CSI 1 J) */
export function eraseToStartOfScreen(): string {
  return csi(1, 'J');
}

// ---------------------------------------------------------------------------
// 光标样式
// ---------------------------------------------------------------------------

export const CURSOR_STYLES = [
  { style: 'default', blinking: false },
  { style: 'block', blinking: true },
  { style: 'block', blinking: false },
  { style: 'underline', blinking: true },
  { style: 'underline', blinking: false },
  { style: 'bar', blinking: true },
  { style: 'bar', blinking: false },
] as const;

// ---------------------------------------------------------------------------
// CSI 最终字节常量
// ---------------------------------------------------------------------------

export const CSI = {
  CUU: 0x41,
  CUD: 0x42,
  CUF: 0x43,
  CUB: 0x44,
  CNL: 0x45,
  CPL: 0x46,
  CHA: 0x47,
  CUP: 0x48,
  CHT: 0x49,
  ED: 0x4a,
  EL: 0x4b,
  IL: 0x4c,
  DL: 0x4d,
  EF: 0x4e,
  EA: 0x4f,
  DCH: 0x50,
  SU: 0x53,
  SD: 0x54,
  ECH: 0x58,
  CBT: 0x5a,
  HPA: 0x61,
  HPR: 0x61, // same as HPA
  REP: 0x62,
  DA: 0x63,
  VPA: 0x64,
  VPR: 0x65,
  HVP: 0x66,
  TBC: 0x67,
  SM: 0x68,
  RM: 0x6c,
  DECSCUSR: 0x71,
  DECSTBM: 0x72,
  SCOSC: 0x73,
  DECSC: 0x73, // same as SCOSC
  DECRC: 0x75,
  SCORC: 0x75, // same as DECRC
  DECREQTPARM: 0x78,
  SGR: 0x6d,
  DSR: 0x6e,
  DA1: 0x63,
  DA2: 0x63, // same final, differentiated by intermediate >
} as const;
