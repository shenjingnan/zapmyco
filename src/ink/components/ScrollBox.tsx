/**
 * ScrollBox — 可滚动容器组件
 *
 * 渲染为 `ink-scroll-box` 元素，由 render-node-to-output.ts 特殊处理：
 * 1. 读取 `data-scroll-top` 属性获取当前滚动偏移
 * 2. 应用视口裁剪（同 Box）
 * 3. 判断内容是否溢出视口（scrollDrainPending）
 *
 * ScrollBox 可受控使用（通过 scrollTop + onScroll 属性）或非受控使用。
 * VirtualMessageList 作为子组件通过 props 接收 scrollTop。
 */

import { createElement, forwardRef, type ReactNode, useImperativeHandle, useState } from 'react';
import type { Styles } from '../styles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScrollBoxHandle {
  /** 滚动到指定位置（显示行偏移，0 = 底部） */
  scrollTo(position: number): void;
  /** 相对滚动（正数=向下，显示行） */
  scrollBy(delta: number): void;
  /** 滚动到底部 */
  scrollToBottom(): void;
  /** 当前滚动偏移量（显示行），0 = 底部 */
  readonly scrollTop: number;
  /** 是否处于底部 */
  readonly isAtBottom: boolean;
}

export interface ScrollBoxProps {
  children?: ReactNode;
  style?: Styles;
  /** 可选 ref 获取命令式 API */
  scrollRef?: React.Ref<ScrollBoxHandle>;
  /** 受控模式：外部控制 scrollTop */
  scrollTop?: number;
  /** 受控模式：scrollTop 变化回调 */
  onScroll?: (scrollTop: number) => void;

  // 简写 flexbox props
  flexGrow?: number;
  height?: number | string;
  width?: number | string;
  padding?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
}

// ---------------------------------------------------------------------------
// ScrollBox
// ---------------------------------------------------------------------------

/**
 * ScrollBox 组件 — 可滚动视口容器。
 *
 * 支持受控和非受控两种模式：
 * - 非受控：ScrollBox 内部管理 scrollTop 状态
 * - 受控：通过 scrollTop + onScroll 属性由父组件管理
 */
export const ScrollBox = forwardRef<ScrollBoxHandle, ScrollBoxProps>(function ScrollBox(
  {
    children,
    style,
    flexGrow,
    height,
    width,
    padding,
    paddingLeft,
    paddingRight,
    paddingTop,
    paddingBottom,
    scrollRef,
    scrollTop: controlledScrollTop,
    onScroll,
  }: ScrollBoxProps,
  ref
): React.ReactElement {
  // 内部状态（非受控模式使用）
  const [internalScrollTop, setInternalScrollTop] = useState(0);

  // 实际使用的 scrollTop：受控模式取外部值，否则取内部状态
  const actualScrollTop = controlledScrollTop ?? internalScrollTop;

  const setScrollTop = (value: number) => {
    const clamped = Math.max(0, value);
    if (controlledScrollTop === undefined) {
      setInternalScrollTop(clamped);
    }
    onScroll?.(clamped);
  };

  // 构建样式，强制 overflow=scroll
  const mergedStyle: Styles = {
    ...style,
    ...(flexGrow !== undefined ? { flexGrow } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(padding !== undefined ? { padding } : {}),
    ...(paddingLeft !== undefined ? { paddingLeft } : {}),
    ...(paddingRight !== undefined ? { paddingRight } : {}),
    ...(paddingTop !== undefined ? { paddingTop } : {}),
    ...(paddingBottom !== undefined ? { paddingBottom } : {}),
    overflow: 'scroll',
  };

  // 暴露命令式 API
  useImperativeHandle(ref ?? scrollRef, () => ({
    scrollTo(position: number): void {
      setScrollTop(Math.max(0, position));
    },
    scrollBy(delta: number): void {
      setScrollTop(Math.max(0, actualScrollTop + delta));
    },
    scrollToBottom(): void {
      setScrollTop(0);
    },
    get scrollTop(): number {
      return actualScrollTop;
    },
    get isAtBottom(): boolean {
      return actualScrollTop <= 0;
    },
  }));

  // 使用 React createElement 创建 ink-scroll-box 元素
  // reconciler 会将 props（除 children 外）作为 attributes 存储到 DOMElement
  return createElement(
    'ink-scroll-box',
    {
      style: mergedStyle,
      'data-scroll-top': actualScrollTop,
    },
    children
  );
});
