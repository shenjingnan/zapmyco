/**
 * useVirtualScroll — 虚拟滚动范围计算 hook
 *
 * 根据 scrollTop 和 viewportHeight 计算应渲染的逻辑行范围。
 * 匹配 OutputArea.renderToScreen 中的可见窗口算法。
 *
 * 配置常量：
 * - OVERSCAN_ROWS: 可见范围外额外渲染的行数（便于快速滚动时减少空白）
 * - COLD_START_COUNT: 初始加载时渲染的项数（高度数据尚未就绪时）
 * - MAX_MOUNTED_ITEMS: 同时挂载的最大项数
 * - SLIDE_STEP: 快速滚动步长（PR4+ 使用）
 * - SCROLL_QUANTUM: 滚动量化容器（PR4+ 使用）
 */

import { useDeferredValue, useMemo } from 'react';

// ---------------------------------------------------------------------------
// 配置常量
// ---------------------------------------------------------------------------

/** 可见范围外额外渲染的显示行数 */
export const OVERSCAN_ROWS = 80;

/** 冷启动时渲染的初始项数（高度数据尚未就绪时） */
export const COLD_START_COUNT = 30;

/** 同时挂载的最大项数 */
export const MAX_MOUNTED_ITEMS = 300;

/** 快速滚动步长（用于快速滚动节流） */
export const SLIDE_STEP = 25;

/** 滚动量化容器 */
export const SCROLL_QUANTUM = 40;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VirtualScrollOptions {
  /** 总逻辑项数 */
  totalItems: number;
  /** 获取第 i 项的高度（显示行数） */
  getItemHeight: (index: number) => number;
  /** 当前滚动偏移（显示行，0=底部） */
  scrollTop: number;
  /** 视口高度（可用显示行数） */
  viewportHeight: number;
}

export interface VirtualScrollResult {
  /** 可见项起始索引（包含） */
  startIndex: number;
  /** 可见项结束索引（不包含） */
  endIndex: number;
  /** 所有内容的总高度（显示行数） */
  totalHeight: number;
  /** startIndex 之前的显示行数 */
  offsetBefore: number;
  /** 是否处于底部跟随模式 */
  isAtBottom: boolean;
  /** 是否处于冷启动状态（总高度 == 0 且 totalItems > 0） */
  isCold: boolean;
}

// ---------------------------------------------------------------------------
// useVirtualScroll
// ---------------------------------------------------------------------------

/**
 * 虚拟滚动范围计算 hook。
 *
 * 核心算法：show display lines [visibleStart, visibleEnd)，
 * 找出哪些逻辑行与这个 display line 范围重叠。
 */
export function useVirtualScroll(options: VirtualScrollOptions): VirtualScrollResult {
  const { totalItems, getItemHeight, scrollTop, viewportHeight } = options;

  // 使用 deferred value 延迟范围增长，避免快速滚动时的闪烁
  const deferredScrollTop = useDeferredValue(scrollTop);
  const deferredViewportHeight = useDeferredValue(viewportHeight);

  // 使用 overscan 扩展可见范围
  const effectiveViewport =
    viewportHeight > 0 ? deferredViewportHeight + OVERSCAN_ROWS * 2 : COLD_START_COUNT;

  return useMemo(() => {
    // 边界情况：没有内容
    if (totalItems === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        totalHeight: 0,
        offsetBefore: 0,
        isAtBottom: true,
        isCold: false,
      };
    }

    // 计算总高度
    let totalHeight = 0;
    for (let i = 0; i < totalItems; i++) {
      totalHeight += Math.max(1, getItemHeight(i));
    }

    // 冷启动检测
    if (totalHeight === 0 && totalItems > 0) {
      return {
        startIndex: 0,
        endIndex: Math.min(totalItems, COLD_START_COUNT),
        totalHeight: 0,
        offsetBefore: 0,
        isAtBottom: scrollTop <= 0,
        isCold: true,
      };
    }

    // 计算可见窗口（同 OutputArea.renderToScreen 算法）
    const maxScroll = Math.max(0, totalHeight - viewportHeight);
    const clampedOffset = Math.min(deferredScrollTop, maxScroll);
    const visibleEnd = totalHeight - clampedOffset;
    const visibleStart = Math.max(0, visibleEnd - effectiveViewport);

    // 遍历 wrappedHeights 找到与 [visibleStart, visibleEnd) 重叠的逻辑行
    let accumulated = 0;
    let startIndex = 0;
    let endIndex = totalItems;
    let offsetBefore = 0;
    let foundStart = false;

    for (let i = 0; i < totalItems; i++) {
      const h = Math.max(1, getItemHeight(i));
      const itemEnd = accumulated + h;

      if (!foundStart && itemEnd > visibleStart) {
        startIndex = i;
        offsetBefore = accumulated;
        foundStart = true;
      }

      if (foundStart && accumulated >= visibleEnd) {
        endIndex = i;
        break;
      }

      accumulated = itemEnd;
    }

    // 限制挂载项数
    if (endIndex - startIndex > MAX_MOUNTED_ITEMS) {
      endIndex = startIndex + MAX_MOUNTED_ITEMS;
    }

    const isAtBottom = scrollTop <= 0;

    return {
      startIndex,
      endIndex,
      totalHeight,
      offsetBefore,
      isAtBottom,
      isCold: false,
    };
  }, [totalItems, getItemHeight, deferredScrollTop, effectiveViewport, viewportHeight, scrollTop]);
}
