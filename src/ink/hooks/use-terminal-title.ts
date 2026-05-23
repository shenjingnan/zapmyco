/**
 * useTerminalTitle — 终端标题 hook
 *
 * 声明式设置终端标签/窗口标题。
 * 传入字符串设置标题（ANSI 转义序列自动剥离）。
 * 传入 null 则无操作。
 *
 * Windows 上使用 process.title（经典终端不支持 OSC）。
 * 其他平台写入 OSC 0（设置标题+图标）序列到终端。
 */

import { useContext, useEffect } from 'react';
import stripAnsi from 'strip-ansi';
import { TerminalWriteContext } from '../components/TerminalWriteContext';
import { OSC, osc } from '../termio/osc';

/**
 * 声明式设置终端标签/窗口标题。
 *
 * @param title - 标题文本。传入 null 则无操作。
 *
 * @example
 * useTerminalTitle('正在处理...');
 * useTerminalTitle(null); // 不设置标题
 */
export function useTerminalTitle(title: string | null): void {
  const writeRaw = useContext(TerminalWriteContext);

  useEffect(() => {
    if (title === null || !writeRaw) return;

    const clean = stripAnsi(title);

    if (process.platform === 'win32') {
      process.title = clean;
    } else {
      writeRaw(osc(OSC.SET_TITLE_AND_ICON, clean));
    }
  }, [title, writeRaw]);
}
