import React, { type ReactNode } from 'react';
import type { Styles } from '../styles';

export interface BoxProps {
  children?: ReactNode;
  style?: Styles;
  width?: number | string;
  height?: number | string;
  flexGrow?: number;
  flexShrink?: number;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  margin?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  overflow?: 'visible' | 'hidden' | 'scroll';
  display?: 'flex' | 'none';
  /** 标记为不可选择（用于 NoSelect 组件） */
  noSelect?: boolean | 'from-left-edge';
}

/**
 * Box — flexbox 容器组件。
 *
 * 终端中的 <div>，通过 flexbox 布局管理子元素位置。
 * PR2: 完整实现，style 属性同步到 Yoga 节点。
 */
export function Box({ children, style, noSelect, ...props }: BoxProps): React.ReactElement {
  const mergedStyle: Styles = { ...style };

  for (const [key, value] of Object.entries(props)) {
    if (key !== 'children' && value !== undefined) {
      (mergedStyle as Record<string, unknown>)[key] = value;
    }
  }

  const attrs: Record<string, unknown> = { style: mergedStyle };
  if (noSelect !== undefined) {
    attrs.noSelect = noSelect;
  }

  return React.createElement('ink-box', attrs, children);
}
