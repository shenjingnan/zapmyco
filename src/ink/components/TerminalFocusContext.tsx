/**
 * TerminalFocusContext — 终端焦点上下文（DEC 1004）
 *
 * 提供 isTerminalFocused 标志和 terminalFocusState 状态。
 * 使用 useSyncExternalStore 订阅 terminal-focus-state.ts 模块级状态。
 * 单独 Provider 组件避免 App.tsx 在焦点变化时 re-render。
 */

import type React from 'react';
import { createContext, useSyncExternalStore } from 'react';
import type { TerminalFocusState } from '../terminal-focus-state';
import {
  getTerminalFocused,
  getTerminalFocusState,
  subscribeTerminalFocus,
} from '../terminal-focus-state';

export type { TerminalFocusState };

export interface TerminalFocusContextProps {
  readonly isTerminalFocused: boolean;
  readonly terminalFocusState: TerminalFocusState;
}

const TerminalFocusContext = createContext<TerminalFocusContextProps>({
  isTerminalFocused: true,
  terminalFocusState: 'unknown',
});

TerminalFocusContext.displayName = 'TerminalFocusContext';

export interface TerminalFocusProviderProps {
  children: React.ReactNode;
}

/**
 * TerminalFocusProvider — 提供终端焦点上下文
 *
 * 通过 useSyncExternalStore 订阅模块级焦点状态，
 * 只有消费焦点的组件会 re-render。
 */
export function TerminalFocusProvider({
  children,
}: TerminalFocusProviderProps): React.ReactElement {
  const isTerminalFocused = useSyncExternalStore(subscribeTerminalFocus, getTerminalFocused);
  const terminalFocusState = useSyncExternalStore(subscribeTerminalFocus, getTerminalFocusState);

  const value: TerminalFocusContextProps = {
    isTerminalFocused,
    terminalFocusState,
  };

  return <TerminalFocusContext.Provider value={value}>{children}</TerminalFocusContext.Provider>;
}

export default TerminalFocusContext;
