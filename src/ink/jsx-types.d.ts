/**
 * Ink JSX 元素类型声明
 *
 * 声明 Ink 自定义元素的 JSX 类型，使 TypeScript 能识别 ink-link、ink-raw-ansi 等元素。
 */

import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-link': {
        href?: string;
        children?: React.ReactNode;
      };
      'ink-raw-ansi': {
        rawText?: string;
        rawWidth?: number;
        rawHeight?: number;
      };
    }
  }
}
