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
