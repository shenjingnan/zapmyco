import React from 'react';

/**
 * Spacer — 弹性空间组件。
 *
 * 在 flex 布局中占据剩余空间，等价于 <Box flexGrow={1} />。
 * 用于将组件推送到容器两端。
 *
 * @example
 * <Box flexDirection="row">
 *   <Text>左侧</Text>
 *   <Spacer />
 *   <Text>右侧</Text>
 * </Box>
 */
export function Spacer(): React.ReactElement {
  return React.createElement('ink-box', { style: { flexGrow: 1 } });
}
