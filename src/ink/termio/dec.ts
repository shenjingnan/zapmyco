/**
 * DEC 私有模式序列生成器
 *
 * 用于管理 DEC 私有模式启用/禁用。
 * 从 src/cli/tui/dec.ts 移植。
 */

import { csi } from './csi';

/** DEC 私有模式编号 */
export const DEC = {
  CURSOR_VISIBLE: 25,
  ALT_SCREEN: 47,
  ALT_SCREEN_CLEAR: 1049,
  SYNCHRONIZED_UPDATE: 2026,
  MOUSE_NORMAL: 1000,
  MOUSE_BUTTON: 1002,
  MOUSE_ANY: 1003,
  MOUSE_SGR: 1006,
} as const;

/** 生成 DEC SET 序列: CSI ?<mode>h */
export const decset = (mode: number): string => csi(`?${mode}h`);

/** 生成 DEC RESET 序列: CSI ?<model>l */
export const decreset = (mode: number): string => csi(`?${mode}l`);

// ---------------------------------------------------------------------------
// 预生成序列常量
// ---------------------------------------------------------------------------

/** 进入 Alternate Screen 并清屏 (DECSET 1049) */
export const ENTER_ALT_SCREEN = decset(DEC.ALT_SCREEN_CLEAR);

/** 退出 Alternate Screen (DECRESET 1049) */
export const EXIT_ALT_SCREEN = decreset(DEC.ALT_SCREEN_CLEAR);

/** 显示光标 (DECSET 25) */
export const SHOW_CURSOR = decset(DEC.CURSOR_VISIBLE);

/** 隐藏光标 (DECRESET 25) */
export const HIDE_CURSOR = decreset(DEC.CURSOR_VISIBLE);

/** 开始同步更新 BSU (DECSET 2026) */
export const BSU = decset(DEC.SYNCHRONIZED_UPDATE);

/** 结束同步更新 ESU (DECRESET 2026) */
export const ESU = decreset(DEC.SYNCHRONIZED_UPDATE);
