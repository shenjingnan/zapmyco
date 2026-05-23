/**
 * TerminalWriteContext — 原始终端写入上下文
 *
 * 提供 writeRaw 函数供 hooks（useTabStatus、useTerminalTitle）和组件
 * （AlternateScreen）直接写入原始 ANSI 序列到终端，绕过 Ink 渲染管线。
 */

import { createContext } from 'react';

export type WriteRaw = (data: string) => void;

export const TerminalWriteContext = createContext<WriteRaw | null>(null);
