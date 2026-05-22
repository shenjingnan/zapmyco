/**
 * Ink 公开 API 入口。
 *
 * PR2: 从本地 src/ink/ 自定义实现导出。
 * 后续 PR 将添加更多导出（hooks、contexts 等）。
 */

import { Box } from './components/Box';
import { Text } from './components/Text';
import { Ink as InkImpl } from './ink';

export { Box, InkImpl as Ink, Text };

/** 快速渲染函数 */
export function render(element: import('react').ReactNode): InkImpl {
  const ink = new InkImpl({ exitOnCtrlC: true });
  ink.render(element);
  ink.start();
  return ink;
}
