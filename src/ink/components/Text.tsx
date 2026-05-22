import React, { type ReactNode } from 'react';

export interface TextProps {
  children?: ReactNode;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/**
 * Text — 文本渲染组件。
 *
 * 渲染带样式文本。PR1 仅渲染纯文本，
 * 颜色/样式支持在后续 PR 实现。
 */
export function Text({ children, ...style }: TextProps): React.ReactElement {
  return React.createElement('ink-text', { style }, children);
}
