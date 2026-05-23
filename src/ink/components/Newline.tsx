import React from 'react';

/**
 * Newline — 换行组件。
 *
 * 渲染一个换行符。在终端中，<Newline /> = 移动到下一行。
 * 多个 Newline 堆叠产生空行。
 *
 * @example
 * <Text>
 *   第一行
 *   <Newline />
 *   第二行
 * </Text>
 */
export function Newline(): React.ReactElement {
  return React.createElement('ink-text', null, '\n');
}
