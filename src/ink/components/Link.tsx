/**
 * Link — OSC 8 超链接组件
 *
 * 渲染可点击的超链接。支持终端通过 OSC 8 序列渲染超链接。
 * 不支持超链接的终端显示 fallback 或纯文本 URL。
 */

import type React from 'react';
import type { ReactNode } from 'react';
import { supportsHyperlinks } from '../supports-hyperlinks';
import { Text } from './Text';

export interface LinkProps {
  readonly children?: ReactNode;
  readonly url: string;
  readonly fallback?: ReactNode;
}

/**
 * OSC 8 超链接组件。
 *
 * @param props.url - 链接 URL
 * @param props.children - 链接文本（默认显示 URL）
 * @param props.fallback - 不支持超链接时的回退内容
 *
 * @example
 * <Link url="https://example.com">点击这里</Link>
 * <Link url="https://example.com" /> // 显示 URL
 */
export function Link({ children, url, fallback }: LinkProps): React.ReactElement {
  const content = children ?? url;

  if (supportsHyperlinks()) {
    return (
      <Text>
        <ink-link href={url}>{content}</ink-link>
      </Text>
    );
  }

  return <Text>{fallback ?? content}</Text>;
}
