/**
 * node-cache — 布局节点缓存
 *
 * 跟踪已渲染节点的布局边界，用于 blit 优化和清除。
 * 管理 pendingClears（移除子元素的矩形区域）和 absoluteNodeRemoved 标志。
 *
 * 参考 claude-code src/ink/node-cache.ts
 */

import type { DOMElement } from './dom';
import type { Rectangle } from './layout/geometry';

/**
 * 每个渲染节点的缓存布局边界（用于 blit + 清除）。
 * `top` 是 yoga-local 的 getComputedTop() — 当子元素位置未变化时，
 * ScrollBox 视口裁剪可跳过 yoga 读取。
 */
export type CachedLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  top?: number;
};

export const nodeCache = new WeakMap<DOMElement, CachedLayout>();

/** 移除子元素的矩形区域，下次渲染时需要清除 */
export const pendingClears = new WeakMap<DOMElement, Rectangle[]>();

/**
 * 当为绝对定位节点添加 pendingClear 时设置此标志。
 * 通知渲染器为下一帧禁用 blit：被移除的节点可能绘制过非兄弟元素
 * （如覆盖在 ScrollBox 上方的 overlay），因此从 prevScreen 恢复的 blit
 * 会恢复被移除 overlay 的像素。普通流式移除已在父级通过 hasRemovedChild 处理。
 * 每次渲染开始时重置。
 */
let absoluteNodeRemoved = false;

/**
 * 添加待清除区域。
 * @param parent     - 父节点
 * @param rect       - 需要清除的矩形区域
 * @param isAbsolute - 是否为绝对定位节点
 */
export function addPendingClear(parent: DOMElement, rect: Rectangle, isAbsolute: boolean): void {
  const existing = pendingClears.get(parent);
  if (existing) {
    existing.push(rect);
  } else {
    pendingClears.set(parent, [rect]);
  }
  if (isAbsolute) {
    absoluteNodeRemoved = true;
  }
}

/**
 * 消费 absoluteNodeRemoved 标志并重置。
 * @returns 是否发生过绝对定位节点移除
 */
export function consumeAbsoluteRemovedFlag(): boolean {
  const had = absoluteNodeRemoved;
  absoluteNodeRemoved = false;
  return had;
}
