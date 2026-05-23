/**
 * AlternateScreen — 备选屏幕组件
 *
 * 在终端的备选屏幕缓冲区中渲染子节点。
 *
 * 挂载时：
 * - 进入 alt screen (DEC 1049)，清屏，光标归位
 * - 高度约束为终端行数（溢出需通过 flexbox 处理）
 * - 可选启用 SGR 鼠标追踪
 *
 * 卸载时：
 * - 禁用鼠标追踪（如启用）
 * - 退出 alt screen，恢复主屏幕内容
 *
 * 使用 useInsertionEffect（早于 useLayoutEffect）确保
 * ENTER_ALT_SCREEN 在第一帧渲染前到达终端。
 */

import React, { type PropsWithChildren, useContext, useInsertionEffect } from 'react';
import instances from '../instances';
import {
  DISABLE_MOUSE_TRACKING,
  ENABLE_MOUSE_TRACKING,
  ENTER_ALT_SCREEN,
  EXIT_ALT_SCREEN,
} from '../termio/dec';
import { Box } from './Box';
import { TerminalSizeContext } from './TerminalSizeContext';
import { TerminalWriteContext } from './TerminalWriteContext';

export interface AlternateScreenProps {
  /** 启用 SGR 鼠标追踪（滚轮 + 点击/拖拽）。默认 true。 */
  mouseTracking?: boolean;
}

/**
 * 在终端的备选屏幕缓冲区中渲染子节点。
 *
 * @example
 * <AlternateScreen mouseTracking={true}>
 *   <Box flexDirection="column">
 *     <Text>Alt screen content</Text>
 *   </Box>
 * </AlternateScreen>
 */
export function AlternateScreen({
  children,
  mouseTracking = true,
}: PropsWithChildren<AlternateScreenProps>): React.ReactElement {
  const size = useContext(TerminalSizeContext);
  const writeRaw = useContext(TerminalWriteContext);

  // useInsertionEffect 在 mutation 阶段触发（早于 useLayoutEffect），
  // 确保 alt screen 切换在第一帧渲染前写入终端
  useInsertionEffect(() => {
    const ink = instances.get(process.stdout);
    if (!writeRaw) return;

    writeRaw(ENTER_ALT_SCREEN + '\x1B[2J\x1B[H' + (mouseTracking ? ENABLE_MOUSE_TRACKING : ''));
    ink?.setAltScreenActive(true, mouseTracking);

    return () => {
      ink?.setAltScreenActive(false);
      ink?.clearTextSelection();
      writeRaw((mouseTracking ? DISABLE_MOUSE_TRACKING : '') + EXIT_ALT_SCREEN);
    };
  }, [writeRaw, mouseTracking]);

  const rows = size?.rows ?? 24;

  return (
    <Box flexDirection="column" height={rows} width="100%" flexShrink={0}>
      {children}
    </Box>
  );
}
