/**
 * useApp — AppContext hook
 *
 * 提供对 Ink 应用上下文的访问（exit 方法）。
 */

import { useContext } from 'react';
import { AppContext, type AppContextValue } from '../components/App';

/**
 * 访问 Ink 应用上下文。
 *
 * @returns { exit: (error?: Error) => void }
 *
 * @example
 * const { exit } = useApp();
 * exit(new Error('something went wrong'));
 */
export function useApp(): AppContextValue {
  return useContext(AppContext);
}
