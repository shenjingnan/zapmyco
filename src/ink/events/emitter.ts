/**
 * EventEmitter — 节点 EventEmitter 封装
 *
 * 扩展 Node.js EventEmitter：
 * - setMaxListeners(0)：React 中多个组件可合法监听同一事件
 * - emit() 重写：检查 Event.stopImmediatePropagation
 *
 * 用于旧式事件路径（InputEvent → useInput hook）。
 * 新式 TerminalEvent 使用 Dispatcher DOM 树派发。
 */

import { EventEmitter as NodeEventEmitter } from 'events';
import { Event } from './event.js';

export class EventEmitter extends NodeEventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }

  override emit(type: string | symbol, ...args: unknown[]): boolean {
    // 保持 'error' 事件的 Node.js 默认行为（未监听时抛出）
    if (type === 'error') {
      return super.emit(type, ...args);
    }

    const listeners = this.rawListeners(type);
    if (listeners.length === 0) return false;

    const maybeEvent = args[0] instanceof Event ? args[0] : null;

    for (const listener of listeners) {
      listener.apply(this, args);
      if (maybeEvent?.didStopImmediatePropagation()) {
        break;
      }
    }
    return true;
  }
}
