/**
 * RawAnsi — 原始 ANSI 透传组件
 *
 * 绕过 React 树 → Yoga → 重序列化的 roundtrip，直接渲染预生成的 ANSI 输出。
 *
 * 当外部渲染器已产生 ANSI 转义且正确换行的内容时使用。
 * 普通的 Text 渲染会重新解析 ANSI → React Text span → Yoga → re-emit，
 * 对大量语法高亮内容来说 roundtrip 是渲染的主要开销。
 *
 * 此组件发射单个 Yoga leaf，将 joined string 直接交给 output.write()，
 * output.write() 内部已处理 \n 分割和 ANSI 解析到 screen buffer。
 */

import type React from 'react';

export interface RawAnsiProps {
  /**
   * 预渲染的 ANSI 行。每个元素必须是恰好一行的终端行
   * （已由生产者换行到 width）且包含内联 ANSI 转义码。
   */
  lines: string[];
  /** 生产者换行的列宽度。作为固定 leaf 宽度传递给 Yoga。 */
  width: number;
}

/**
 * 原始 ANSI 透传组件。
 *
 * 当 lines 为空数组时返回 null。
 *
 * @example
 * <RawAnsi lines={ansiLines} width={terminalWidth} />
 */
export function RawAnsi({ lines, width }: RawAnsiProps): React.ReactElement | null {
  if (lines.length === 0) {
    return null;
  }

  return <ink-raw-ansi rawText={lines.join('\n')} rawWidth={width} rawHeight={lines.length} />;
}
