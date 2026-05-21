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
