/**
 * measure-element — Yoga 元素尺寸查询
 *
 * 从 DOMElement 的 Yoga 节点读取计算后的尺寸。
 *
 * 参考 claude-code src/ink/measure-element.ts
 */

import type { DOMElement } from './dom';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * 读取 DOM 元素的 Yoga 计算尺寸。
 *
 * @param node - DOM 元素
 * @returns `{ width, height }`（无 Yoga 节点时返回 0, 0）
 */
export function measureElement(node: DOMElement): ElementSize {
  const yoga = node.yogaNode;
  if (!yoga) {
    return { width: 0, height: 0 };
  }
  return {
    width: Math.round(yoga.getComputedWidth()),
    height: Math.round(yoga.getComputedHeight()),
  };
}
