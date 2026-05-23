/**
 * get-max-width — Yoga 内容宽度（减去 padding 和 border）
 *
 * 返回 Yoga 节点的可用内容宽度，用于文本换行。
 * 注意：返回值可能比父容器宽（Yoga 两轮测量中的 AtMost 阶段）。
 * 调用者应钳制到实际可用宽度。
 *
 * 参考 claude-code src/ink/get-max-width.ts
 */

import type { LayoutNode } from './layout/node';

/**
 * 获取 Yoga 节点的可用内容宽度。
 *
 * formula: computedWidth - paddingLeft - paddingRight - borderLeft - borderRight
 *
 * @param yogaNode - Yoga 布局节点
 * @returns 可用内容宽度
 */
export function getMaxWidth(yogaNode: LayoutNode): number {
  const width = yogaNode.getComputedWidth();
  const padLeft = yogaNode.getComputedPadding('left');
  const padRight = yogaNode.getComputedPadding('right');
  const borderLeft = yogaNode.getComputedBorder('left');
  const borderRight = yogaNode.getComputedBorder('right');

  return Math.max(0, width - padLeft - padRight - borderLeft - borderRight);
}
