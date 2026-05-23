/**
 * useTabStatus — 标签状态指示器 hook
 *
 * 通过 OSC 21337 序列在终端标签栏显示状态指示点。
 * 支持三种状态：idle（绿色）、busy（橙色）、waiting（蓝色）。
 *
 * 不支持的终端会静默丢弃序列，因此可安全无条件调用。
 */

import { useContext, useEffect, useRef } from 'react';
import { TerminalWriteContext } from '../components/TerminalWriteContext';
import { OSC_PREFIX, OSC_ST } from '../termio/osc';
import type { Color } from '../termio/types';

export type TabStatusKind = 'idle' | 'busy' | 'waiting';

// ---------------------------------------------------------------------------
// 颜色预设
// ---------------------------------------------------------------------------

const rgb = (r: number, g: number, b: number): Color => ({
  type: 'rgb' as const,
  r,
  g,
  b,
});

const TAB_STATUS_PRESETS: Record<
  TabStatusKind,
  { indicator: Color; status: string; statusColor: Color }
> = {
  idle: {
    indicator: rgb(0, 215, 95),
    status: 'Idle',
    statusColor: rgb(136, 136, 136),
  },
  busy: {
    indicator: rgb(255, 149, 0),
    status: 'Working…',
    statusColor: rgb(255, 149, 0),
  },
  waiting: {
    indicator: rgb(95, 135, 255),
    status: 'Waiting',
    statusColor: rgb(95, 135, 255),
  },
};

// ---------------------------------------------------------------------------
// OSC 21337 序列辅助
// ---------------------------------------------------------------------------

/** 清除标签状态 */
const CLEAR_TAB_STATUS = `${OSC_PREFIX}21337;${OSC_ST}`;

/**
 * 构建标签状态 OSC 序列。
 * 格式: OSC 21337 ; <indicator-color> / <status-text> / <status-color> ST
 */
function buildTabStatus(kind: TabStatusKind): string {
  const preset = TAB_STATUS_PRESETS[kind];
  const indicator = rgbToAnsi(preset.indicator);
  const statusColor = rgbToAnsi(preset.statusColor);
  return `${OSC_PREFIX}21337;${indicator}/${preset.status}/${statusColor}${OSC_ST}`;
}

/** 将 Color 对象转换为 ANSI 颜色字符串 */
function rgbToAnsi(color: Color): string {
  if (color.type === 'rgb') {
    return `rgb:${color.r.toString(16).padStart(2, '0')}/${color.g.toString(16).padStart(2, '0')}/${color.b.toString(16).padStart(2, '0')}`;
  }
  return 'rgb:00/00/00';
}

// ---------------------------------------------------------------------------
// useTabStatus
// ---------------------------------------------------------------------------

/**
 * 声明式设置终端标签状态指示器（OSC 21337）。
 *
 * 在终端标签侧边栏显示彩色指示点 + 简短状态文本。
 * 传递 null 可退出（不设置状态）。
 *
 * @param kind - 状态类型：'idle' | 'busy' | 'waiting' | null
 *
 * @example
 * useTabStatus(isExecuting ? 'busy' : 'idle');
 */
export function useTabStatus(kind: TabStatusKind | null): void {
  const writeRaw = useContext(TerminalWriteContext);
  const prevKindRef = useRef<TabStatusKind | null>(null);

  useEffect(() => {
    // 从非 null 到 null 的转换：清除旧状态
    if (kind === null) {
      if (prevKindRef.current !== null && writeRaw) {
        writeRaw(CLEAR_TAB_STATUS);
      }
      prevKindRef.current = null;
      return;
    }

    prevKindRef.current = kind;
    if (!writeRaw) return;
    writeRaw(buildTabStatus(kind));
  }, [kind, writeRaw]);
}
