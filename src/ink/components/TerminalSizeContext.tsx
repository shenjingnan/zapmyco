/**
 * TerminalSizeContext — 终端尺寸上下文
 *
 * 提供终端当前的 columns 和 rows。
 * TerminalSizeProvider 通过 InkContext 获取 Ink 实例并订阅 resize 事件。
 */

import type React from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { InkContext } from './InkContext';

export interface TerminalSize {
  columns: number;
  rows: number;
}

export const TerminalSizeContext = createContext<TerminalSize | null>(null);

export interface TerminalSizeProviderProps {
  children: React.ReactNode;
}

/**
 * TerminalSizeProvider — 提供终端尺寸上下文
 *
 * 通过 InkContext 获取 Ink 实例，订阅 resize 事件更新尺寸值。
 * 单独 Provider 组件避免 App.tsx re-render。
 */
export function TerminalSizeProvider({ children }: TerminalSizeProviderProps): React.ReactElement {
  const ink = useContext(InkContext);
  const [size, setSize] = useState<TerminalSize>(() => ({
    columns: ink?.columns ?? 80,
    rows: ink?.rows ?? 24,
  }));

  useEffect(() => {
    if (!ink) return;

    // 初始同步
    setSize({ columns: ink.columns, rows: ink.rows });

    // 订阅 resize
    const handler = (columns: number, rows: number) => {
      setSize({ columns, rows });
    };

    ink._resizeHandlers.add(handler);
    return () => {
      ink._resizeHandlers.delete(handler);
    };
  }, [ink]);

  const value = useMemo(() => size, [size]);

  return <TerminalSizeContext.Provider value={value}>{children}</TerminalSizeContext.Provider>;
}
