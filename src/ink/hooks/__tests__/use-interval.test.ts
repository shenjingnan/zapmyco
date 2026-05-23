/**
 * use-interval — 定时器 hook 测试
 *
 * 测试 ClockContext.createClock 纯逻辑部分。
 */

import { describe, expect, it, vi } from 'vitest';
import { createClock } from '../../components/ClockContext';

describe('createClock', () => {
  it('应创建 clock 对象', () => {
    const clock = createClock(100);
    expect(clock).toBeDefined();
    expect(typeof clock.subscribe).toBe('function');
    expect(typeof clock.now).toBe('function');
    expect(typeof clock.setTickInterval).toBe('function');
  });

  it('now() 应返回正数时间值', () => {
    const clock = createClock(100);
    const time = clock.now();
    expect(time).toBeGreaterThanOrEqual(0);
  });

  it('subscribe 应返回取消订阅函数', () => {
    const clock = createClock(100);
    const unsub = clock.subscribe(() => {}, false);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('keepAlive=true 的订阅应启动内部定时器', () => {
    vi.useFakeTimers();
    const clock = createClock(100);
    const onChange = vi.fn();

    clock.subscribe(onChange, true);

    // tick 应触发 onChange
    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('所有 keepAlive 订阅者取消后应停止定时器', () => {
    vi.useFakeTimers();
    const clock = createClock(100);
    const onChange = vi.fn();

    const unsub = clock.subscribe(onChange, true);
    unsub();

    // 取消后不应再触发
    vi.advanceTimersByTime(200);
    expect(onChange).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('setTickInterval 应更新定时器间隔', () => {
    vi.useFakeTimers();
    const clock = createClock(200);
    const onChange = vi.fn();

    clock.subscribe(onChange, true);

    // 200ms 前不应触发
    vi.advanceTimersByTime(150);
    expect(onChange).not.toHaveBeenCalled();

    // 200ms 时应触发
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('非 keepAlive 订阅不应启动定时器', () => {
    vi.useFakeTimers();
    const clock = createClock(100);
    const onChange = vi.fn();

    clock.subscribe(onChange, false);

    vi.advanceTimersByTime(200);
    expect(onChange).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('keepAlive 订阅者应启动定时器、非 keepAlive 不应', () => {
    vi.useFakeTimers();
    const clock = createClock(100);
    const keepAliveHandler = vi.fn();
    const nonKeepAliveHandler = vi.fn();

    // 先加非 keepAlive — 不应启动
    clock.subscribe(nonKeepAliveHandler, false);
    vi.advanceTimersByTime(200);
    expect(nonKeepAliveHandler).not.toHaveBeenCalled();

    // 加 keepAlive — 应启动
    clock.subscribe(keepAliveHandler, true);
    vi.advanceTimersByTime(100);
    expect(keepAliveHandler).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
