/**
 * zapmyco Ink 框架 barrel 导出。
 *
 * 提供 Ink 渲染框架的公开 API。
 * PR1: re-export from real ink 包（通过 root.ts 桥接）
 * 后续 PR: 逐步从 src/ink/ 导出自定义实现
 */
export { Box, render, Text } from './ink/root';
