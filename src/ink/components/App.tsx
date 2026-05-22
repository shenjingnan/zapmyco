import React, { type ReactNode, useCallback, useEffect } from 'react';

export interface AppProps {
  children?: ReactNode;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  exitOnCtrlC?: boolean;
}

/**
 * App — 根组件。
 *
 * 包裹整个 Ink 应用，管理 stdin/stdout 上下文和 Ctrl+C 退出。
 * PR1 最小实现，后续 PR 将集成完整的 Context Provider 系统。
 */
export function App({
  children,
  stdin,
  stdout: _stdout,
  exitOnCtrlC = true,
}: AppProps): React.ReactElement {
  const handleInput = useCallback(
    (input: string) => {
      if (input === '\x03' && exitOnCtrlC) {
        // Ctrl+C — PR1 预留，后续 PR 通过 AppContext 触发退出
      }
    },
    [exitOnCtrlC]
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

  return React.createElement('ink-root', null, children);
}
