/**
 * StdinContext — stdin/stdout 流上下文
 *
 * 提供对 stdin/stdout 流、raw mode 控制和内部事件基础设施的访问。
 */

import { createContext } from 'react';
import { EventEmitter } from '../events/emitter';
import { TerminalQuerier } from '../terminal-querier';

export interface StdinContextValue {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  setRawMode: (mode: boolean) => void;
  internal_eventEmitter: EventEmitter;
  internal_querier: TerminalQuerier;
}

export const StdinContext = createContext<StdinContextValue>({
  stdin: process.stdin,
  stdout: process.stdout,
  setRawMode: () => {},
  internal_eventEmitter: new EventEmitter(),
  internal_querier: new TerminalQuerier(process.stdout),
});
