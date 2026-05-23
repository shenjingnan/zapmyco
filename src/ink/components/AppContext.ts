/**
 * AppContext — Ink 应用上下文
 *
 * 提供 exit() 方法供组件退出应用。
 */

import { createContext } from 'react';

export interface AppContextValue {
  exit: (error?: Error) => void;
}

export const AppContext = createContext<AppContextValue>({
  exit: () => {},
});
