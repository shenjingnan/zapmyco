/**
 * useStdin — StdinContext hook
 *
 * 提供对 stdin/stdout 流和 raw mode 控制的访问。
 */

import { useContext } from 'react';
import { StdinContext, type StdinContextValue } from '../components/StdinContext';

/**
 * 访问 stdin/stdout 流和 raw mode 控制。
 *
 * @returns { stdin, stdout, setRawMode }
 *
 * @example
 * const { stdin, stdout, setRawMode } = useStdin();
 * setRawMode(true);
 * stdout.write('hello');
 */
export function useStdin(): StdinContextValue {
  return useContext(StdinContext);
}
