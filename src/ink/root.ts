/**
 * Ink 公开 API 入口。
 *
 * PR1 从真实 ink 包 re-export，使验证应用能直接运行。
 * 后续 PR 逐步替换为本地 src/ink/ 中的自定义实现。
 */
export { Box, render, Text } from 'ink';
