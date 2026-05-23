/**
 * Dispatcher — DOM-style capture/bubble 事件派发器
 *
 * 实现与 react-dom 一致的两阶段事件派发：
 *   1. capture 阶段：根 → 目标（收集时 unshift → root-first）
 *   2. bubble 阶段：目标 → 根（收集时 push → target-first）
 *
 * 最终执行顺序：[root-cap, ..., parent-cap, target-cap, target-bub, parent-bub, ..., root-bub]
 *
 * reconciler host config 通过 currentEvent / currentUpdatePriority
 * 实现 resolveEventType、resolveEventTimeStamp 和 resolveUpdatePriority。
 *
 * discreteUpdates 由 reconciler 在创建后注入（避免循环导入）。
 */

import {
  ContinuousEventPriority,
  DefaultEventPriority,
  DiscreteEventPriority,
  NoEventPriority,
} from 'react-reconciler/constants.js';
import { HANDLER_FOR_EVENT } from './event-handlers.js';
import type { EventPhase, EventTarget, TerminalEvent } from './terminal-event.js';

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

type DispatchListener = {
  node: EventTarget;
  handler: (event: TerminalEvent) => void;
  phase: EventPhase;
};

type DiscreteUpdates = <A, B>(
  fn: (a: A, b: B) => boolean,
  a: A,
  b: B,
  c: undefined,
  d: undefined
) => boolean;

// ---------------------------------------------------------------------------
// getHandler — 从节点获取事件处理器
// ---------------------------------------------------------------------------

function getHandler(
  node: EventTarget,
  eventType: string,
  capture: boolean
): ((event: TerminalEvent) => void) | undefined {
  const handlers = node._eventHandlers;
  if (!handlers) return undefined;

  const mapping = HANDLER_FOR_EVENT[eventType];
  if (!mapping) return undefined;

  const propName = capture ? mapping.capture : mapping.bubble;
  if (!propName) return undefined;

  return handlers[propName] as ((event: TerminalEvent) => void) | undefined;
}

// ---------------------------------------------------------------------------
// collectListeners — 按派发顺序收集监听器
// ---------------------------------------------------------------------------

function collectListeners(target: EventTarget, event: TerminalEvent): DispatchListener[] {
  const listeners: DispatchListener[] = [];

  let node: EventTarget | undefined = target;
  while (node) {
    const isTarget = node === target;

    const captureHandler = getHandler(node, event.type, true);
    const bubbleHandler = getHandler(node, event.type, false);

    if (captureHandler) {
      listeners.unshift({
        node,
        handler: captureHandler,
        phase: isTarget ? 'at_target' : 'capturing',
      });
    }

    if (bubbleHandler && (event.bubbles || isTarget)) {
      listeners.push({
        node,
        handler: bubbleHandler,
        phase: isTarget ? 'at_target' : 'bubbling',
      });
    }

    node = node.parentNode;
  }

  return listeners;
}

// ---------------------------------------------------------------------------
// processDispatchQueue — 按顺序执行监听器
// ---------------------------------------------------------------------------

function processDispatchQueue(listeners: DispatchListener[], event: TerminalEvent): void {
  let previousNode: EventTarget | undefined;

  for (const { node, handler, phase } of listeners) {
    if (event._isImmediatePropagationStopped()) {
      break;
    }

    if (event._isPropagationStopped() && node !== previousNode) {
      break;
    }

    event._setEventPhase(phase);
    event._setCurrentTarget(node);
    event._prepareForTarget(node);

    try {
      handler(event);
    } catch (error) {
      // 避免单个监听器错误影响整个派发
      console.error('[ink] event handler error:', error);
    }

    previousNode = node;
  }
}

// ---------------------------------------------------------------------------
// getEventPriority — 事件类型 → React 调度优先级
// ---------------------------------------------------------------------------

function getEventPriority(eventType: string): number {
  switch (eventType) {
    case 'keydown':
    case 'keyup':
    case 'click':
    case 'focus':
    case 'blur':
    case 'paste':
      return DiscreteEventPriority as number;
    case 'resize':
    case 'scroll':
    case 'mousemove':
      return ContinuousEventPriority as number;
    default:
      return DefaultEventPriority as number;
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export class Dispatcher {
  currentEvent: TerminalEvent | null = null;
  currentUpdatePriority: number = DefaultEventPriority as number;
  discreteUpdates: DiscreteUpdates | null = null;

  /**
   * 推断事件优先级。
   * 如果设置了显式优先级则返回该优先级，
   * 否则根据当前派发事件的类型推断。
   */
  resolveEventPriority(): number {
    if (this.currentUpdatePriority !== (NoEventPriority as number)) {
      return this.currentUpdatePriority;
    }
    if (this.currentEvent) {
      return getEventPriority(this.currentEvent.type);
    }
    return DefaultEventPriority as number;
  }

  /**
   * 派发事件 — capture → at_target → bubble
   * 返回 true 如果 defaultPrevented 未被调用。
   */
  dispatch(target: EventTarget, event: TerminalEvent): boolean {
    const previousEvent = this.currentEvent;
    this.currentEvent = event;
    try {
      event._setTarget(target);

      const listeners = collectListeners(target, event);
      processDispatchQueue(listeners, event);

      event._setEventPhase('none');
      event._setCurrentTarget(null);

      return !event.defaultPrevented;
    } finally {
      this.currentEvent = previousEvent;
    }
  }

  /**
   * 以离散（同步）优先级派发。
   * 用于用户初始化事件：键盘、点击、焦点、粘贴。
   */
  dispatchDiscrete(target: EventTarget, event: TerminalEvent): boolean {
    if (!this.discreteUpdates) {
      return this.dispatch(target, event);
    }
    return this.discreteUpdates(
      (t: unknown, e: unknown) => this.dispatch(t as EventTarget, e as TerminalEvent),
      target as unknown as never,
      event as unknown as never,
      undefined,
      undefined
    );
  }

  /**
   * 以连续优先级派发。
   * 用于高频事件：resize, scroll, mouse move。
   */
  dispatchContinuous(target: EventTarget, event: TerminalEvent): boolean {
    const previousPriority = this.currentUpdatePriority;
    try {
      this.currentUpdatePriority = ContinuousEventPriority as number;
      return this.dispatch(target, event);
    } finally {
      this.currentUpdatePriority = previousPriority;
    }
  }
}
