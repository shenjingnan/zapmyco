/**
 * App — 根组件
 *
 * 包裹整个 Ink 应用，管理 stdin/stdout 上下文、Ctrl+C 退出和事件管线。
 * PR2: 添加上下文 Provider 和输入处理。
 * PR7: 集成 parse-keypress 管线、EventEmitter、TerminalQuerier。
 */

import React, { createContext, type ReactNode, useCallback, useEffect, useRef } from 'react';
import { EventEmitter } from '../events/emitter';
import { InputEvent } from '../events/input-event';
import { TerminalFocusEvent } from '../events/terminal-focus-event';
import type { ParsedInput, ParsedKey } from '../parse-keypress';
import { INITIAL_STATE, parseMultipleKeypresses } from '../parse-keypress';
import reconciler from '../reconciler';
import { setTerminalFocused } from '../terminal-focus-state';
import { TerminalQuerier, xtversion } from '../terminal-querier';
import {
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
  ENABLE_KITTY_KEYBOARD,
  ENABLE_MODIFY_OTHER_KEYS,
  FOCUS_IN,
  FOCUS_OUT,
} from '../termio/csi';
import { DBP, DFE, EBP, EFE } from '../termio/dec';

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

export interface AppContextValue {
  exit: (error?: Error) => void;
}

export const AppContext = createContext<AppContextValue>({
  exit: () => {},
});

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

// ---------------------------------------------------------------------------
// AppProps
// ---------------------------------------------------------------------------

export interface AppProps {
  children?: ReactNode;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  exitOnCtrlC?: boolean;
  onExit?: (error?: Error) => void;
  /** 键盘事件回调（由 Ink class 提供，用于 dispatchKeyboardEvent） */
  onKeyboardEvent?: (parsedKey: ParsedKey) => void;
}

/** 内部使用的 Props */
export interface InternalAppProps extends AppProps {
  onExit: (error?: Error) => void;
}

// ---------------------------------------------------------------------------
// App Component
// ---------------------------------------------------------------------------

/**
 * App — 根组件。
 * 在 React 树最外层提供上下文 Provider。
 */
export function App({
  children,
  stdin,
  stdout,
  exitOnCtrlC = true,
  onExit,
  onKeyboardEvent,
}: AppProps): React.ReactElement {
  const exit = useCallback(
    (error?: Error) => {
      onExit?.(error);
    },
    [onExit]
  );

  // PR7: 事件基础设施
  const internalEventEmitterRef = useRef(new EventEmitter());
  const keyParseStateRef = useRef(INITIAL_STATE);
  const querierRef = useRef<TerminalQuerier | null>(null);

  // 初始化 querier
  if (!querierRef.current && typeof stdout.write === 'function') {
    querierRef.current = new TerminalQuerier(stdout);
  }

  // ---- 输入处理管线 ----
  const processKeysInBatch = useCallback(
    (items: ParsedInput[]) => {
      const querier = querierRef.current;
      const emitter = internalEventEmitterRef.current;

      for (const item of items) {
        if (item.kind === 'response') {
          querier?.onResponse(item.response);
          continue;
        }

        if (item.kind === 'mouse') {
          // 鼠标事件由 Ink 类处理（现有 ink.tsx 的 handleSgrMouse）
          // PR7：保持不变，后续 PR 可迁移到此路径
          continue;
        }

        // 终端焦点事件
        if (item.sequence === FOCUS_IN) {
          setTerminalFocused(true);
          emitter.emit('terminalfocus', new TerminalFocusEvent('terminalfocus'));
          continue;
        }
        if (item.sequence === FOCUS_OUT) {
          setTerminalFocused(false);
          emitter.emit('terminalblur', new TerminalFocusEvent('terminalblur'));
          continue;
        }

        // Ctrl+Z 挂起
        if (item.kind === 'key' && item.ctrl && item.name === 'z') {
          // handleSuspend — 暂时不做特殊处理
          continue;
        }

        if (item.kind === 'key') {
          // Ctrl+C 退出
          if (item.ctrl && item.name === 'c' && exitOnCtrlC) {
            exit();
            continue;
          }

          // 旧式 useInput 路径
          const inputEvent = new InputEvent(item);
          emitter.emit('input', inputEvent);

          // 新式 dispatchKeyboardEvent 路径（ink.tsx 提供回调）
          if (!inputEvent.didStopImmediatePropagation()) {
            onKeyboardEvent?.(item);
          }
        }
      }
    },
    [exitOnCtrlC, exit, onKeyboardEvent]
  );

  const processInput = useCallback(
    (input: string | Buffer | null) => {
      if (!keyParseStateRef.current._tokenizer) {
        keyParseStateRef.current = { ...INITIAL_STATE };
      }

      const [keys, newState] = parseMultipleKeypresses(keyParseStateRef.current, input);
      keyParseStateRef.current = newState;

      if (keys.length > 0) {
        reconciler.discreteUpdates(
          (items: ParsedInput[], _unused: undefined) => {
            processKeysInBatch(items);
            return true;
          },
          keys,
          undefined,
          undefined,
          undefined
        );
      }
    },
    [processKeysInBatch]
  );

  const handleReadable = useCallback(() => {
    try {
      let chunk: string | Buffer | null = stdin.read();
      while (chunk !== null) {
        processInput(chunk);
        chunk = stdin.read();
      }
    } catch {
      // stdin 读取错误 — 静默恢复
    }
  }, [stdin, processInput]);

  // ---- 旧式 handleInput（保留向后兼容） ----
  const handleInput = useCallback(
    (input: string) => {
      if (input === '\x03' && exitOnCtrlC) {
        exit();
      }
    },
    [exitOnCtrlC, exit]
  );

  // ---- Effect: 设置 stdin 监听和终端初始化 ----
  useEffect(() => {
    if (!stdin.isTTY) return;

    stdin.setEncoding('utf8');
    stdin.addListener('readable', handleReadable);

    // 终端能力设置
    stdout.write(EBP); // 括号粘贴模式
    stdout.write(EFE); // 焦点事件
    stdout.write(ENABLE_KITTY_KEYBOARD); // Kitty 键盘协议
    stdout.write(ENABLE_MODIFY_OTHER_KEYS); // modifyOtherKeys

    // 延迟探测终端身份（避免与初始渲染竞争）
    const timer = setTimeout(() => {
      const querier = querierRef.current;
      if (querier) {
        querier.send(xtversion()).catch(() => {});
        querier.flush().catch(() => {});
      }
    }, 100);

    return () => {
      stdin.removeListener('readable', handleReadable);
      clearTimeout(timer);

      // 清理终端状态
      try {
        stdout.write(DISABLE_MODIFY_OTHER_KEYS);
        stdout.write(DISABLE_KITTY_KEYBOARD);
        stdout.write(DFE);
        stdout.write(DBP);
      } catch {
        // 忽略清理错误
      }
    };
  }, [stdin, stdout, handleReadable]);

  // ---- 旧式 data 监听（保持向后兼容，仅用于键盘） ----
  useEffect(() => {
    const onData = (data: Buffer) => {
      handleInput(data.toString());
    };

    if (stdin.isTTY) {
      stdin.on('data', onData);
    }

    return () => {
      stdin.removeListener('data', onData);
    };
  }, [stdin, handleInput]);

  const contextValue: StdinContextValue = {
    stdin,
    stdout,
    setRawMode: (mode: boolean) => {
      if (stdin.isTTY) {
        stdin.setRawMode(mode);
      }
    },
    internal_eventEmitter: internalEventEmitterRef.current,
    internal_querier: querierRef.current ?? new TerminalQuerier(stdout),
  };

  return (
    <AppContext.Provider value={{ exit }}>
      <StdinContext.Provider value={contextValue}>
        {React.createElement('ink-root', null, children)}
      </StdinContext.Provider>
    </AppContext.Provider>
  );
}
