/**
 * TerminalEvent — DOM-style 终端事件基类
 *
 * 镜像浏览器 Event API：
 * - target, currentTarget, eventPhase (none/capturing/at_target/bubbling)
 * - stopPropagation, stopImmediatePropagation, preventDefault
 * - bubbles, cancelable, defaultPrevented, timeStamp
 *
 * EventTarget 类型定义了 DOM 节点必须实现的最小接口，
 * 供 Dispatcher 在 capture/bubble 遍历中使用。
 */

import { Event } from './event.js';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type EventPhase = 'none' | 'capturing' | 'at_target' | 'bubbling';

/**
 * EventTarget — Dispatcher 遍历所需的 DOM 节点接口。
 * DOMElement 需满足此接口才能参与事件派发。
 */
export type EventTarget = {
  parentNode: EventTarget | undefined;
  _eventHandlers?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// TerminalEvent
// ---------------------------------------------------------------------------

type TerminalEventInit = {
  bubbles?: boolean;
  cancelable?: boolean;
};

export class TerminalEvent extends Event {
  readonly type: string;
  readonly timeStamp: number;
  readonly bubbles: boolean;
  readonly cancelable: boolean;

  private _target: EventTarget | null = null;
  private _currentTarget: EventTarget | null = null;
  private _eventPhase: EventPhase = 'none';
  private _propagationStopped = false;
  private _defaultPrevented = false;

  constructor(type: string, init?: TerminalEventInit) {
    super();
    this.type = type;
    this.timeStamp = performance.now();
    this.bubbles = init?.bubbles ?? true;
    this.cancelable = init?.cancelable ?? true;
  }

  get target(): EventTarget | null {
    return this._target;
  }
  get currentTarget(): EventTarget | null {
    return this._currentTarget;
  }
  get eventPhase(): EventPhase {
    return this._eventPhase;
  }
  get defaultPrevented(): boolean {
    return this._defaultPrevented;
  }

  stopPropagation(): void {
    this._propagationStopped = true;
  }

  override stopImmediatePropagation(): void {
    super.stopImmediatePropagation();
    this._propagationStopped = true;
  }

  preventDefault(): void {
    if (this.cancelable) {
      this._defaultPrevented = true;
    }
  }

  // ---------------------------------------------------------------------------
  // 内部方法（仅供 Dispatcher 使用）
  // ---------------------------------------------------------------------------

  _setTarget(target: EventTarget): void {
    this._target = target;
  }
  _setCurrentTarget(target: EventTarget | null): void {
    this._currentTarget = target;
  }
  _setEventPhase(phase: EventPhase): void {
    this._eventPhase = phase;
  }
  _isPropagationStopped(): boolean {
    return this._propagationStopped;
  }
  _isImmediatePropagationStopped(): boolean {
    return this.didStopImmediatePropagation();
  }

  /**
   * 在每个处理器触发前调用。
   * 子类可重写以实现每个节点的设置（如 ClickEvent 的 localCol/localRow 计算）。
   */
  _prepareForTarget(_target: EventTarget): void {
    // 默认无操作
  }
}
