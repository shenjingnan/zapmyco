/**
 * App — 根组件
 *
 * 包裹整个 Ink 应用，管理 stdin/stdout 上下文和 Ctrl+C 退出。
 * PR2: 添加上下文 Provider 和实际输入处理。
 */

import React, { createContext, type ReactNode, useCallback, useEffect } from 'react';

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
}

export const StdinContext = createContext<StdinContextValue>({
  stdin: process.stdin,
  stdout: process.stdout,
  setRawMode: () => {},
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
}

/** 内部使用的 Props，onExit 始终为函数 */
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
}: AppProps): React.ReactElement {
  const exit = useCallback(
    (error?: Error) => {
      onExit?.(error);
    },
    [onExit]
  );

  const handleInput = useCallback(
    (input: string) => {
      if (input === '\x03' && exitOnCtrlC) {
        exit();
      }
    },
    [exitOnCtrlC, exit]
  );

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
  };

  return (
    <AppContext.Provider value={{ exit }}>
      <StdinContext.Provider value={contextValue}>
        {React.createElement('ink-root', null, children)}
      </StdinContext.Provider>
    </AppContext.Provider>
  );
}
