/**
 * hit-test — 组件命中测试
 *
 * 根据屏幕坐标（col, row）查找最深层 DOM 元素。
 * 支持 dispatchClick 和 dispatchHover 派发。
 *
 * 参考 claude-code src/ink/hit-test.ts
 */

import type { DOMElement } from './dom';
import { ClickEvent } from './events/click-event';

// ---------------------------------------------------------------------------
// nodeCache — 布局 rect 缓存
// ---------------------------------------------------------------------------

interface CachedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const nodeCache = new WeakMap<DOMElement, CachedRect>();

/**
 * 更新节点的布局 rect 缓存。
 * 在 render-node-to-output 遍历时调用。
 */
export function updateNodeCache(
  node: DOMElement,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  nodeCache.set(node, { x, y, width, height });
}

/**
 * 清除节点的布局缓存。
 */
export function clearNodeCache(node: DOMElement): void {
  nodeCache.delete(node);
}

// ---------------------------------------------------------------------------
// hitTest
// ---------------------------------------------------------------------------

/**
 * 查找 (col, row) 所在的最深层 DOM 元素。
 *
 * @param node - 起始搜索节点（通常是 root）
 * @param col  - 屏幕列（0-based）
 * @param row  - 屏幕行（0-based）
 * @returns 命中最深层 DOM 元素，或 null
 */
export function hitTest(node: DOMElement, col: number, row: number): DOMElement | null {
  const rect = nodeCache.get(node);
  if (!rect) return null;

  // 检查点是否在当前节点范围内
  if (col < rect.x || col >= rect.x + rect.width || row < rect.y || row >= rect.y + rect.height) {
    return null;
  }

  // 反向遍历子节点（后绘制在上层）
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i];
    if (!child || child.nodeName === '#text') continue;

    const childElement = child as DOMElement;
    const hit = hitTest(childElement, col, row);
    if (hit) return hit;
  }

  // 没有子节点命中，返回当前节点
  return node;
}

// ---------------------------------------------------------------------------
// dispatchClick
// ---------------------------------------------------------------------------

/**
 * 派发点击事件到目标组件。
 *
 * 流程：
 * 1. hitTest 查找目标
 * 2. click-to-focus：找最近有 tabIndex 的祖先设置焦点
 * 3. 创建 ClickEvent，bubble 派发
 *
 * @param root        - 根 DOM 元素
 * @param col         - 屏幕列
 * @param row         - 屏幕行
 * @param cellIsBlank - 点击的单元格是否为空
 * @returns 至少一个 onClick 处理器被调用
 */
export function dispatchClick(
  root: DOMElement,
  col: number,
  row: number,
  cellIsBlank = false
): boolean {
  const target = hitTest(root, col, row);
  if (!target) return false;

  // click-to-focus: 找最近的 tabIndex 祖先
  let focusTarget: DOMElement | null = target;
  while (focusTarget && !focusTarget.attributes.tabIndex) {
    focusTarget = (focusTarget.parentNode as DOMElement | undefined) ?? null;
  }
  if (focusTarget?.focusManager) {
    // 由焦点管理器处理
  }

  // 创建事件并派发
  const event = new ClickEvent(col, row, cellIsBlank);

  // 设置 local 坐标
  const targetRect = nodeCache.get(target);
  if (targetRect) {
    event.localCol = col - targetRect.x;
    event.localRow = row - targetRect.y;
  }

  // bubble 派发
  let fired = false;
  let current: DOMElement | undefined = target;
  while (current) {
    const handlers = current._eventHandlers as Record<string, unknown> | undefined;
    if (handlers) {
      const handler = handlers.onClick as ((evt: ClickEvent) => void) | undefined;
      if (handler) {
        handler(event);
        fired = true;
        if (event.didStopImmediatePropagation()) break;
      }
    }
    current = current.parentNode;
  }

  return fired;
}

// ---------------------------------------------------------------------------
// dispatchHover
// ---------------------------------------------------------------------------

/**
 * 派发 hover 事件。
 * 追踪鼠标悬停的节点集合，触发 onMouseEnter/onMouseLeave。
 *
 * @param root    - 根 DOM 元素
 * @param col     - 屏幕列
 * @param row     - 屏幕行
 * @param hovered - 当前悬停节点集合（调用者维护，此函数会修改它）
 */
export function dispatchHover(
  root: DOMElement,
  col: number,
  row: number,
  hovered: Set<DOMElement>
): void {
  const target = hitTest(root, col, row);

  // 收集目标及其祖先中有关联 handler 的节点
  const targetChain = new Set<DOMElement>();
  if (target) {
    let current: DOMElement | undefined = target;
    while (current) {
      const handlers = current._eventHandlers as Record<string, unknown> | undefined;
      if (handlers?.onMouseEnter || handlers?.onMouseLeave) {
        targetChain.add(current);
      }
      current = current.parentNode;
    }
  }

  // 离开的节点: 之前在 hovered 中但不在 targetChain 中
  for (const node of hovered) {
    if (!targetChain.has(node)) {
      const handlers = node._eventHandlers as Record<string, unknown> | undefined;
      (handlers?.onMouseLeave as ((evt: unknown) => void) | undefined)?.({
        col,
        row,
        target: node,
      });
    }
  }

  // 进入的节点: 在 targetChain 中但不在 hovered 中
  for (const node of targetChain) {
    if (!hovered.has(node)) {
      const handlers = node._eventHandlers as Record<string, unknown> | undefined;
      (handlers?.onMouseEnter as ((evt: unknown) => void) | undefined)?.({
        col,
        row,
        target: node,
      });
    }
  }

  // 更新 hovered 集合
  hovered.clear();
  for (const node of targetChain) {
    hovered.add(node);
  }
}
