import React, { type ReactNode } from 'react';
import type { Styles } from '../styles';

export interface TextProps {
  children?: ReactNode;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
  style?: Styles;
}

/**
 * Text — 文本渲染组件。
 *
 * 渲染带样式文本。PR2: 完整样式支持。
 * 样式通过 Reconciler 传递到渲染管线（render-node-to-output.ts）。
 */
export function Text({ children, style, ...props }: TextProps): React.ReactElement {
  const textStyles: Record<string, unknown> = { ...style };

  const styleProps = [
    'color',
    'backgroundColor',
    'bold',
    'italic',
    'underline',
    'dim',
    'strikethrough',
    'inverse',
  ] as const;
  for (const key of styleProps) {
    const value = (props as Record<string, unknown>)[key];
    if (value !== undefined) {
      textStyles[key] = value;
    }
  }

  return React.createElement('ink-text', { style: textStyles }, children);
}
