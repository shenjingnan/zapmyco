/**
 * NoSelect — 选择排除区域组件
 *
 * 标记内容为不可选择。在选择模式下，此区域内的单元格跳过选择高亮和复制。
 * 用于栅栏（行号、diff +/- 符号、列表标记等），使得拖拽选择能获得干净的内容。
 *
 * 仅影响备选屏幕文本选择（有鼠标追踪时）。
 */

import type React from 'react';
import type { PropsWithChildren } from 'react';
import { Box, type BoxProps } from './Box';

type Props = Omit<BoxProps, 'noSelect'> & {
  /**
   * 从列 0 扩展排除区域到此 Box 的右边缘（对每行生效）。
   * 用于在缩进容器内渲染的 gutter（如 diff 在多行消息容器内）：
   * 没有此项，跨行拖动会选中容器的前导空白。
   *
   * @default false
   */
  fromLeftEdge?: boolean;
};

/**
 * 标记内容为不可选择。
 *
 * @example
 * <Box flexDirection="row">
 *   <NoSelect fromLeftEdge>
 *     <Text dimColor> 42 +</Text>
 *   </NoSelect>
 *   <Text>const x = 1</Text>
 * </Box>
 */
export function NoSelect({
  children,
  fromLeftEdge,
  ...boxProps
}: PropsWithChildren<Props>): React.ReactElement {
  return (
    <Box {...boxProps} noSelect={fromLeftEdge ? 'from-left-edge' : true}>
      {children}
    </Box>
  );
}
