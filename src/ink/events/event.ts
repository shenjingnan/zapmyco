/**
 * Event — 事件基类
 *
 * 提供 stopImmediatePropagation 支持。
 * 该类是所有事件类型的最底层基类：
 *   - TerminalEvent (DOM-style: target, currentTarget, eventPhase, bubbles)
 *     - KeyboardEvent
 *     - FocusEvent
 *   - ClickEvent (旧式, 直接 extends Event)
 *   - InputEvent (旧式, 直接 extends Event)
 *   - TerminalFocusEvent (旧式, 直接 extends Event)
 */

export class Event {
  private _didStopImmediatePropagation = false;

  didStopImmediatePropagation(): boolean {
    return this._didStopImmediatePropagation;
  }

  stopImmediatePropagation(): void {
    this._didStopImmediatePropagation = true;
  }
}
