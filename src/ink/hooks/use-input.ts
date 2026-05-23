/**
 * useInput — 键盘输入 hook
 *
 * 基于 StdinContext 封装键盘输入处理。
 * 监听 stdin data 事件，通过 matchesKey（从 @/cli/tui/key 导入）
 * 解析按键为 Key 对象。
 *
 * > 注意：events/ 系统和 parse-keypress（PR7）尚未实现。
 * > 此 hook 直接使用 stdin data 事件 + matchesKey 作为过渡方案，
 * > 后续 PR7 会替换为完整的事件系统。
 */

import { useCallback, useContext, useEffect, useRef } from 'react';
import { matchesKey } from '@/cli/tui/key';
import { StdinContext } from '../components/App';

// ---------------------------------------------------------------------------
// Key 类型
// ---------------------------------------------------------------------------

export interface Key {
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  escape: boolean;
  return: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  pageUp: boolean;
  pageDown: boolean;
  home: boolean;
  end: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

const EMPTY_KEY: Key = {
  ctrl: false,
  shift: false,
  meta: false,
  escape: false,
  return: false,
  tab: false,
  backspace: false,
  delete: false,
  pageUp: false,
  pageDown: false,
  home: false,
  end: false,
  up: false,
  down: false,
  left: false,
  right: false,
};

// ---------------------------------------------------------------------------
// 按键解析辅助（基于 matchesKey）
// ---------------------------------------------------------------------------

/** 将 raw data 解析为 { input, key } */
function parseInput(data: string): { input: string; key: Key } {
  const key: Key = { ...EMPTY_KEY };

  // 预检查各个键
  if (matchesKey(data, 'escape')) key.escape = true;
  else if (matchesKey(data, 'enter')) key.return = true;
  else if (matchesKey(data, 'tab')) key.tab = true;
  else if (matchesKey(data, 'backspace')) key.backspace = true;
  else if (matchesKey(data, 'delete')) key.delete = true;
  else if (matchesKey(data, 'pageup')) key.pageUp = true;
  else if (matchesKey(data, 'pagedown')) key.pageDown = true;
  else if (matchesKey(data, 'home')) key.home = true;
  else if (matchesKey(data, 'end')) key.end = true;
  else if (matchesKey(data, 'up')) key.up = true;
  else if (matchesKey(data, 'down')) key.down = true;
  else if (matchesKey(data, 'left')) key.left = true;
  else if (matchesKey(data, 'right')) key.right = true;

  // Ctrl 修饰键检测
  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 0x01 && code <= 0x1a) {
      key.ctrl = true;
    }
  }

  // Shift 修饰键 — 大写字母检测
  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 0x41 && code <= 0x5a) {
      key.shift = true;
    }
  }

  return { input: data, key };
}

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
  const { stdin } = useContext(StdinContext);
  const isActive = options?.isActive ?? true;

  // 用 ref 保持 handler 引用稳定，避免 useEffect 频繁重建
  const handlerRef = useRef<InputHandler>(handler);
  handlerRef.current = handler;

  const handleData = useCallback(
    (data: Buffer) => {
      if (!isActive) return;

      const input = data.toString();
      const { key } = parseInput(input);

      handlerRef.current(input, key);
    },
    [isActive]
  );

  useEffect(() => {
    stdin.on('data', handleData);
    return () => {
      stdin.removeListener('data', handleData);
    };
  }, [stdin, handleData]);
}
