/**
 * VirtualMessageList — 虚拟滚动消息列表
 *
 * 连接 OutputArea 数据层和 Ink 渲染管线。
 * 使用 useVirtualScroll 计算可见行范围，仅渲染在视口内的内容。
 *
 * PR3 基础实现：支持基本的内容展示。
 * 后续 PR 将添加完整消息格式化、ANSI 到 Ink 样式映射、搜索高亮等特性。
 */

import { type ReactElement, useMemo } from 'react';
import { stripAnsi } from '@/cli/repl/tools/shell-security';
import { Box } from '@/ink/components/Box';
import { Text } from '@/ink/components/Text';
import { useVirtualScroll } from '@/ink/hooks/use-virtual-scroll';
import type { OutputArea } from './output-area';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VirtualMessageListProps {
  /** OutputArea 实例（数据源） */
  outputArea: OutputArea;
  /** 当前滚动偏移（显示行，0=底部） */
  scrollTop: number;
  /** 视口高度（显示行数） */
  viewportHeight: number;
  /** 视口宽度（字符列数） */
  viewportWidth: number;
}

// ---------------------------------------------------------------------------
// VirtualMessageList
// ---------------------------------------------------------------------------

/**
 * 虚拟滚动消息列表组件。
 *
 * 从 OutputArea 读取 lines[] 和 wrappedHeights，
 * 通过 useVirtualScroll 计算可见范围，
 * 仅渲染视口内可见的内容行。
 */
export function VirtualMessageList({
  outputArea,
  scrollTop,
  viewportHeight,
  viewportWidth,
}: VirtualMessageListProps): ReactElement | null {
  // 同步宽度缓存（确保 OutputArea 的 wrappedHeights 与视口宽度一致）
  outputArea.syncCacheWidth(viewportWidth);

  const totalItems = outputArea.totalLines;

  // 虚拟滚动范围计算（必须放在条件返回之前，遵循 Rules of Hooks）
  const { startIndex, endIndex, isCold } = useVirtualScroll({
    totalItems,
    getItemHeight: (index: number) => outputArea.getLineHeight(index),
    scrollTop,
    viewportHeight,
  });

  // 渲染可见行（useMemo 必须无条件调用）
  const rows = useMemo(() => {
    if (isCold || totalItems === 0) {
      return null;
    }

    const elements: ReactElement[] = [];

    for (let i = startIndex; i < endIndex && i < totalItems; i++) {
      const wrappedLines = outputArea.getOrCreateWrappedLine(i);

      for (let wi = 0; wi < wrappedLines.length; wi++) {
        const wrappedText = wrappedLines[wi] ?? '';

        // 剥离 ANSI 码渲染为纯文本（后续 PR 将添加 ANSI→Ink 样式映射）
        const cleanText = stripAnsi(wrappedText);

        elements.push(
          <Box key={`l-${i}-w-${wi}`} height={1}>
            <Text>{cleanText}</Text>
          </Box>
        );
      }
    }

    return elements;
  }, [startIndex, endIndex, totalItems, outputArea, isCold]);

  // 冷启动或空内容
  if (rows === null) {
    return null;
  }

  return <Box flexDirection="column">{rows}</Box>;
}
