/**
 * Layout engine factory — 布局引擎工厂
 *
 * 返回具体布局引擎实现的实例（当前为 Yoga）。
 */

import type { LayoutNode } from './node';
import { createYogaLayoutNode } from './yoga';

export function createLayoutNode(): LayoutNode {
  return createYogaLayoutNode();
}
