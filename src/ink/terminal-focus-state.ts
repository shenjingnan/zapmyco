/**
 * terminal-focus-state — 终端焦点状态（DEC 1004）
 *
 * 模块级状态，跟踪终端窗口焦点（通过 DECSET 1004 焦点报告）。
 * 提供 useSyncExternalStore 兼容的订阅接口。
 *
 * 参考 claude-code src/ink/terminal-focus-state.ts
 */

export type TerminalFocusState = 'focused' | 'blurred' | 'unknown';

let focusState: TerminalFocusState = 'unknown';
const resolvers: Set<() => void> = new Set();
const subscribers: Set<() => void> = new Set();

/** 设置焦点状态（由 App.tsx 从 FOCUS_IN/OUT 序列解析后调用） */
export function setTerminalFocused(v: boolean): void {
  focusState = v ? 'focused' : 'blurred';

  // 通知 subscribers（useSyncExternalStore）
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // 忽略单个订阅者错误
    }
  }

  // 失去焦点时 resolve 所有 pending resolvers（用于 wake-from-sleep 检测）
  if (!v) {
    for (const resolve of resolvers) {
      try {
        resolve();
      } catch {
        // 忽略单个 resolver 错误
      }
    }
    resolvers.clear();
  }
}

/** 获取焦点状态（布尔值，unknown 视为 focused） */
export function getTerminalFocused(): boolean {
  return focusState !== 'blurred';
}

/** 获取原始焦点状态 */
export function getTerminalFocusState(): TerminalFocusState {
  return focusState;
}

/**
 * 订阅焦点状态变化（用于 useSyncExternalStore）。
 * 返回取消订阅函数。
 */
export function subscribeTerminalFocus(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** 重置焦点状态 */
export function resetTerminalFocusState(): void {
  focusState = 'unknown';
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // 忽略单个订阅者错误
    }
  }
}
