/**
 * DEC 私有模式编号与序列生成
 *
 * 用于管理 ANSI/DEC 转义序列。
 * 所有常用序列预生成为字符串常量，运行时零分配。
 */

/** ESC 控制字符 */
export const ESC = '\x1b';

/** CSI 前缀 */
export const CSI = `${ESC}[`;

/**
 * DEC 私有模式编号
 */
export const DEC = {
  CURSOR_VISIBLE: 25,
  ALT_SCREEN: 47,
  ALT_SCREEN_CLEAR: 1049,
  SYNCHRONIZED_UPDATE: 2026,
  MOUSE_BUTTON: 1002,
  MOUSE_SGR: 1006,
} as const;

/** 生成 DEC SET 序列: CSI ? <mode> h */
export const decset = (mode: number): string => `${CSI}?${mode}h`;

/** 生成 DEC RESET 序列: CSI ? <mode> l */
export const decreset = (mode: number): string => `${CSI}?${mode}l`;

// ---------------------------------------------------------------------------
// 预生成序列常量（渲染路径用，避免重复拼接）
// ---------------------------------------------------------------------------

/** 进入 Alternate Screen 并清屏 (DECSET 1049) */
export const ENTER_ALT_SCREEN = decset(DEC.ALT_SCREEN_CLEAR);

/** 退出 Alternate Screen (DECRESET 1049) */
export const EXIT_ALT_SCREEN = decreset(DEC.ALT_SCREEN_CLEAR);

/** 显示光标 (DECSET 25) */
export const SHOW_CURSOR = decset(DEC.CURSOR_VISIBLE);

/** 隐藏光标 (DECRESET 25) */
export const HIDE_CURSOR = decreset(DEC.CURSOR_VISIBLE);

/** 开始同步更新 (DECSET 2026) — 终端缓存输出直到遇到 ESU */
export const BSU = decset(DEC.SYNCHRONIZED_UPDATE);

/** 结束同步更新 (DECRESET 2026) — 终端一次性渲染缓存内容 */
export const ESU = decreset(DEC.SYNCHRONIZED_UPDATE);

// ---------------------------------------------------------------------------
// 硬件滚动 (DECSTBM + SU/SD) — 用于 PR 6 流式输出优化
// ---------------------------------------------------------------------------

/**
 * 设置滚动区域 (DECSTBM): CSI <top>;<bottom>r
 * top/bottom 为 1-based inclusive，与终端协议一致。
 * 设置后终端仅在 [top, bottom] 范围内响应 SU/SD 和换行滚动。
 */
export const setScrollRegion = (top: number, bottom: number): string => `${CSI}${top};${bottom}r`;

/** 重置滚动区域为全屏 (DECSTBM reset): CSI r */
export const RESET_SCROLL_REGION = `${CSI}r`;

/**
 * 向上滚动 n 行 (SU — Scroll Up): CSI <n>S
 * 在滚动区域内，内容上移 n 行，底部 n 行变为空白。
 * n=0 时返回空字符串（避免无效输出）。
 */
export const scrollUp = (n: number): string => (n === 0 ? '' : `${CSI}${n}S`);

/**
 * 向下滚动 n 行 (SD — Scroll Down): CSI <n>T
 * 在滚动区域内，内容下移 n 行，顶部 n 行变为空白。
 * n=0 时返回空字符串（避免无效输出）。
 */
export const scrollDown = (n: number): string => (n === 0 ? '' : `${CSI}${n}T`);
