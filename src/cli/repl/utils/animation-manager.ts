import type { TUI } from '@earendil-works/pi-tui';

/**
 * 动画帧推进回调
 * @param timestamp 当前时间戳 (performance.now())
 */
export type FrameCallback = (timestamp: number) => void;

/**
 * AnimationManager — 将 spinner/计时器动画从 setInterval 迁移到渲染周期驱动
 *
 * 原理：
 * 通过 monkey-patch pi-tui 的 doRender() 方法，在每次实际渲染前统一推进
 * 所有已注册的 spinner 帧，从而：
 * 1. 消除对 setInterval (macrotask) 的依赖，避免 Timer 阶段被事件循环饿死
 * 2. 帧推进与渲染同步，视觉上更流畅
 * 3. 减少事件循环中的定时器数量，降低调度开销
 *
 * 使用方式：
 * ```typescript
 * const anim = new AnimationManager();
 * anim.bind(tui);
 *
 * const unsub = anim.register((now) => {
 *   // 根据 now 判断是否推进帧
 *   frame = (frame + 1) % frames.length;
 * });
 * ```
 */
export class AnimationManager {
  /** 已注册的帧推进回调 */
  readonly #callbacks = new Set<FrameCallback>();
  /** 绑定的 TUI 实例 */
  #tui: TUI | null = null;
  /** 备份的原始 doRender */
  #originalDoRender: (() => void) | null = null;

  /**
   * 注册一个帧推进回调。
   * 回调会在每次 doRender() 执行前被调用，传入当前 performance.now() 时间戳。
   * 回调应该根据时间戳自行控制帧推进频率（如每 100ms 推进一帧）。
   *
   * @returns 注销函数
   */
  register(cb: FrameCallback): () => void {
    this.#callbacks.add(cb);
    return () => {
      this.#callbacks.delete(cb);
    };
  }

  /**
   * 绑定到 TUI 实例，monkey-patch 其 doRender 方法。
   * 如果已经绑定到另一个 TUI 实例，会先解除绑定。
   */
  bind(tui: TUI): void {
    if (this.#tui) {
      this.unbind();
    }
    this.#tui = tui;

    const tuiObj = tui as unknown as { doRender?: () => void };
    if (typeof tuiObj.doRender !== 'function') {
      // 测试环境中 TUI mock 可能没有 doRender 方法，跳过 monkey-patch
      return;
    }

    this.#originalDoRender = tuiObj.doRender.bind(tui);

    const callbacks = this.#callbacks;
    const self = this;

    tuiObj.doRender = function (this: TUI) {
      // 在所有注册的回调中推进动画帧
      const now = performance.now();
      for (const cb of callbacks) {
        cb(now);
      }
      // 调回原始 doRender
      self.#originalDoRender?.call(this);
    };
  }

  /**
   * 解除绑定，恢复 TUI 实例的原始 doRender。
   */
  unbind(): void {
    if (this.#originalDoRender && this.#tui) {
      (this.#tui as unknown as { doRender: () => void }).doRender = this.#originalDoRender;
    }
    this.#originalDoRender = null;
    this.#tui = null;
  }
}
