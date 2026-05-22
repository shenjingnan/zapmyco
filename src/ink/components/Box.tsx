import React, { type ReactNode } from 'react';

export interface BoxProps {
  children?: ReactNode;
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
  width?: number | string;
  height?: number | string;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  justifyContent?: 'flex-start' | 'flex-end' | 'center';
  alignItems?: 'flex-start' | 'flex-end' | 'center';
}

/**
 * Box — flexbox 容器组件。
 *
 * 终端中的 <div>，通过 flexbox 布局管理子元素位置。
 * PR1 渲染子元素，后续 PR 集成 Yoga flexbox 完整布局。
 */
export function Box({ children, ...style }: BoxProps): React.ReactElement {
  return React.createElement('ink-box', { style }, children);
}
