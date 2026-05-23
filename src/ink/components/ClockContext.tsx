/**
 * ClockContext — 共享动画时钟
 *
 * 提供单个共享的 setInterval 驱动所有定时动画。
 * 有 keepAlive 订阅者时时钟运行，否则暂停。
 * 同一 tick 内所有订阅者看到相同的时间值（tickTime）。
 *
 * 焦点丢失时降低 tick 频率以节省 CPU。
 */

import type React from 'react';
import { createContext, useEffect, useState } from 'react';
import { FRAME_INTERVAL_MS } from '../constants';
import { useTerminalFocus } from '../hooks/use-terminal-focus';

// ---------------------------------------------------------------------------
// Clock 类型
// ---------------------------------------------------------------------------

export interface Clock {
  subscribe: (onChange: () => void, keepAlive: boolean) => () => void;
  now: () => number;
  setTickInterval: (ms: number) => void;
}

// ---------------------------------------------------------------------------
// createClock
// ---------------------------------------------------------------------------

export function createClock(tickIntervalMs: number): Clock {
  const subscribers = new Map<() => void, boolean>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let currentTickIntervalMs = tickIntervalMs;
  let startTime = 0;
  // 同一 tick 内的快照时间，确保所有订阅者看到相同值
  let tickTime = 0;

  function tick(): void {
    tickTime = Date.now() - startTime;
    for (const onChange of subscribers.keys()) {
      onChange();
    }
  }

  function updateInterval(): void {
    const anyKeepAlive = [...subscribers.values()].some(Boolean);

    if (anyKeepAlive) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (startTime === 0) {
        startTime = Date.now();
      }
      interval = setInterval(tick, currentTickIntervalMs);
    } else if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  return {
    subscribe(onChange, keepAlive) {
      subscribers.set(onChange, keepAlive);
      updateInterval();
      return () => {
        subscribers.delete(onChange);
        updateInterval();
      };
    },

    now() {
      if (startTime === 0) {
        startTime = Date.now();
      }
      // 时钟运行时返回同步的 tickTime
      if (interval && tickTime) {
        return tickTime;
      }
      // 暂停时返回实时时间
      return Date.now() - startTime;
    },

    setTickInterval(ms) {
      if (ms === currentTickIntervalMs) return;
      currentTickIntervalMs = ms;
      updateInterval();
    },
  };
}

// ---------------------------------------------------------------------------
// ClockContext
// ---------------------------------------------------------------------------

export const ClockContext = createContext<Clock | null>(null);

const BLURRED_TICK_INTERVAL_MS = FRAME_INTERVAL_MS * 2;

// ---------------------------------------------------------------------------
// ClockProvider
// ---------------------------------------------------------------------------

export interface ClockProviderProps {
  children: React.ReactNode;
}

/**
 * ClockProvider — 提供共享动画时钟上下文
 *
 * 单独组件以避免 App.tsx re-render。
 * 时钟值通过 useState 创建一次（稳定引用），不会导致消费者 re-render。
 */
export function ClockProvider({ children }: ClockProviderProps): React.ReactElement {
  const [clock] = useState(() => createClock(FRAME_INTERVAL_MS));
  const focused = useTerminalFocus();

  useEffect(() => {
    clock.setTickInterval(focused ? FRAME_INTERVAL_MS : BLURRED_TICK_INTERVAL_MS);
  }, [clock, focused]);

  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}
