/**
 * useInterval — 基于共享 Clock 的定时器 hook
 *
 * 与传统的 useInterval 不同，此 hook 基于 ClockContext
 * 共享时钟运行，所有定时器合并为一个 setInterval。
 *
 * 传递 null 可以暂停定时器。
 *
 * useAnimationTimer — 基于共享时钟的动画计时器
 * 以指定间隔更新返回值，驱动纯时间计算（shimmer 位置、帧索引等）。
 * 以非 keepAlive 方式订阅，仅在 keepAlive 订阅者（如 spinner）驱动时钟时更新。
 */

import { useContext, useEffect, useRef, useState } from 'react';
import { ClockContext } from '../components/ClockContext';

/**
 * 基于共享时钟的定时器 hook。
 *
 * @param callback - 定时回调
 * @param intervalMs - 间隔毫秒数。传递 null 暂停定时器。
 *
 * @example
 * useInterval(() => {
 *   setCount(c => c + 1);
 * }, 1000);
 */
export function useInterval(callback: () => void, intervalMs: number | null): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const clock = useContext(ClockContext);

  useEffect(() => {
    if (!clock || intervalMs === null) return;

    let lastUpdate = clock.now();

    const onChange = (): void => {
      const now = clock.now();
      if (now - lastUpdate >= intervalMs) {
        lastUpdate = now;
        callbackRef.current();
      }
    };

    return clock.subscribe(onChange, false);
  }, [clock, intervalMs]);
}

/**
 * useAnimationTimer — 基于共享时钟的动画计时器
 *
 * 以指定间隔更新返回值，驱动纯时间计算。
 *
 * @param intervalMs - 更新间隔毫秒数
 * @returns 当前时钟时间（毫秒）
 *
 * @example
 * const time = useAnimationTimer(100);
 * // time 每 100ms 更新一次
 */
export function useAnimationTimer(intervalMs: number): number {
  const clock = useContext(ClockContext);
  const [time, setTime] = useState(() => clock?.now() ?? 0);

  useEffect(() => {
    if (!clock) return;

    let lastUpdate = clock.now();

    const onChange = (): void => {
      const now = clock.now();
      if (now - lastUpdate >= intervalMs) {
        lastUpdate = now;
        setTime(now);
      }
    };

    return clock.subscribe(onChange, false);
  }, [clock, intervalMs]);

  return time;
}
