/**
 * Yoga 布局集成。
 *
 * PR1: 类型定义骨架。完整实现在 PR2 使用 yoga-layout 做 flexbox 计算。
 */

export type YogaNode = Record<string, never>;

/** PR1: stub */
export function createYogaNode(): YogaNode {
  return {};
}

/** PR1: stub */
export function applyStyles(_yogaNode: YogaNode, _styles: Record<string, unknown>): void {
  // TODO
}
