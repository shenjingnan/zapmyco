/**
 * useAnimationFrame — 动画帧 hook
 *
 * 基于 requestAnimationFrame 驱动动画更新。
 * enabled 控制是否激活（执行中才启用，空闲时暂停）。
 *
 * 用于 Editor 的 loading spinner 和 StatusBars 的动画。
 */

import { useEffect, useRef } from 'react';

export interface UseAnimationFrameOptions {
  /** 是否激活动画（默认 true） */
  enabled?: boolean;
}

/**
 * 动画帧 hook。当 enabled 为 true 时，每一帧调用 callback。
 *
 * @param callback - 帧回调，接收 (delta: number) = 距上一帧的毫秒数
 * @param options - 配置项
 *
 * @example
 * // loading spinner 每 100ms 推进一帧
 * const frameRef = useRef(0);
 * const lastTickRef = useRef(0);
 * useAnimationFrame((delta) => {
 *   lastTickRef.current += delta;
 *   if (lastTickRef.current >= 100) {
 *     frameRef.current = (frameRef.current + 1) % frames.length;
 *     lastTickRef.current = 0;
 *   }
 * }, { enabled: isExecuting });
 */
export function useAnimationFrame(
  callback: (delta: number) => void,
  options?: UseAnimationFrameOptions
): void {
  const enabled = options?.enabled ?? true;
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let rafId: number;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;
      callbackRef.current(delta);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [enabled]);
}
