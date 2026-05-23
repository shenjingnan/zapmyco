/**
 * useInput — 键盘输入 hook
 *
 * 基于 EventEmitter（InputEvent 路径）封装键盘输入处理。
 * 由 App.tsx 的 processKeysInBatch 发射 InputEvent，
 * 此 hook 监听 internal_eventEmitter 的 'input' 事件。
 *
 * PR7 重构：从 stdin.on('data') + matchesKey 迁移到
 * parse-keypress + InputEvent 路径。
 *
 * handler 签名 (input: string, key: Key) 保持向后兼容。
 */

import { useCallback, useContext, useEffect, useRef } from 'react';
import { StdinContext } from '../components/App';
import type { InputEvent, Key } from '../events/input-event';

// ---------------------------------------------------------------------------
// useInput
// ---------------------------------------------------------------------------

export type InputHandler = (input: string, key: Key) => void;

/**
 * 键盘输入 hook。
 *
 * @param handler - 输入处理函数，接收 (input: string, key: Key)
 * @param options - 配置项
 * @param options.isActive - 是否激活（默认 true）。设为 false 时不处理输入
 *
 * @example
 * useInput((input, key) => {
 *   if (key.return) onSubmit();
 *   if (key.escape) onCancel();
 * });
 */
export function useInput(handler: InputHandler, options?: { isActive?: boolean }): void {
  const { internal_eventEmitter } = useContext(StdinContext);
  const isActive = options?.isActive ?? true;

  // 用 ref 保持 handler 引用稳定，避免 useEffect 频繁重建
  const handlerRef = useRef<InputHandler>(handler);
  handlerRef.current = handler;

  const handleInputEvent = useCallback(
    (event: InputEvent) => {
      if (!isActive) return;
      handlerRef.current(event.input, event.key);
    },
    [isActive]
  );

  useEffect(() => {
    internal_eventEmitter.on('input', handleInputEvent);
    return () => {
      internal_eventEmitter.removeListener('input', handleInputEvent);
    };
  }, [internal_eventEmitter, handleInputEvent]);
}
