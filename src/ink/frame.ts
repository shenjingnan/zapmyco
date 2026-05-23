/**
 * Frame / Diff / Patch 类型体系
 *
 * 定义 Ink 渲染管的线核心类型：
 * - Frame: 一帧完整的屏幕状态
 * - Patch: 单条终端操作（移动光标、写入文本等）
 * - Diff: 从一帧到另一帧的补丁序列
 */

import type { Cursor } from './cursor';
import type { Size } from './layout/geometry';
import { Screen } from './screen';

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export interface Frame {
  /** 帧的 Screen 缓冲区 */
  readonly screen: Screen;
  /** 视口尺寸 */
  readonly viewport: Size;
  /** 光标位置和可见性 */
  readonly cursor: Cursor;
  /** DECSTBM 滚动优化提示（仅备选屏幕） */
  readonly scrollHint?: ScrollHint | null;
  /** 是否有 ScrollBox 需要继续排干 */
  readonly scrollDrainPending?: boolean;
}

export interface ScrollHint {
  top: number;
  bottom: number;
  delta: number;
}

// ---------------------------------------------------------------------------
// Patch / Diff
// ---------------------------------------------------------------------------

export type Patch =
  | { type: 'stdout'; content: string }
  | { type: 'clear'; count: number }
  | { type: 'clearTerminal'; reason: FlickerReason }
  | { type: 'cursorHide' }
  | { type: 'cursorShow' }
  | { type: 'cursorMove'; x: number; y: number }
  | { type: 'cursorTo'; col: number }
  | { type: 'carriageReturn' }
  | { type: 'hyperlink'; uri: string }
  | { type: 'styleStr'; str: string }
  // DECSTBM 硬件滚动（PR6）
  | { type: 'setScrollRegion'; top: number; bottom: number }
  | { type: 'scrollUp'; count: number }
  | { type: 'scrollDown'; count: number }
  | { type: 'resetScrollRegion' };

export type Diff = Patch[];

export type FlickerReason = 'resize' | 'offscreen' | 'clear';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * 判断是否需要清屏
 */
export function shouldClearScreen(prevFrame: Frame, frame: Frame): FlickerReason | undefined {
  const didResize =
    frame.viewport.height !== prevFrame.viewport.height ||
    frame.viewport.width !== prevFrame.viewport.width;
  if (didResize) return 'resize';

  const currentOverflows = frame.screen.rows >= frame.viewport.height;
  const prevOverflowed = prevFrame.screen.rows >= prevFrame.viewport.height;
  if (currentOverflows || prevOverflowed) return 'offscreen';

  return undefined;
}

/** 创建空 Frame */
export function emptyFrame(rows: number, columns: number): Frame {
  return {
    screen: new Screen(rows, columns),
    viewport: { width: columns, height: rows },
    cursor: { x: 0, y: 0, visible: true },
  };
}
