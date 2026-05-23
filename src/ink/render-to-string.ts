/**
 * render-to-string — 非交互式字符串渲染
 *
 * 遍历 DOM 树生成 ANSI 字符串（不通过 Screen buffer）。
 * 用于测试、管道输出和日志场景。
 *
 * 参考 claude-code src/ink/render-to-string.ts
 */

import type { DOMElement, DOMNode } from './dom';
import type { Styles, TextStyles } from './styles';
import { textStylesToAnsiCodes } from './styles';

// ---------------------------------------------------------------------------
// 主导出
// ---------------------------------------------------------------------------

/**
 * 将 DOM 树渲染为 ANSI 字符串。
 *
 * @param root - 根 DOM 元素
 * @returns ANSI 格式化字符串
 */
export function renderToString(root: DOMElement): string {
  let result = '';
  let lastOpenCodes: string[] = [];

  accumulateText(root, {}, (text, styles) => {
    const codes = textStylesToAnsiCodes(styles);
    const codesKey = codes.join(',');

    // 仅在样式变化时输出 SGR
    if (codesKey !== lastOpenCodes.join(',')) {
      if (codes.length > 0) {
        result += `\x1b[${codes.join(';')}m`;
      } else {
        result += '\x1b[0m';
      }
      lastOpenCodes = codes;
    }

    result += text;
  });

  // 关闭样式
  if (lastOpenCodes.length > 0) {
    result += '\x1b[0m';
  }

  return result;
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/**
 * 递归收集文本，用回调输出带样式的片段。
 */
function accumulateText(
  node: DOMNode,
  inheritedStyles: TextStyles,
  onSegment: (text: string, styles: TextStyles) => void
): void {
  if (node.nodeName === '#text') {
    if (node.nodeValue) {
      onSegment(node.nodeValue, inheritedStyles);
    }
    return;
  }

  const element = node as DOMElement;
  const mergedStyles = element.style
    ? { ...inheritedStyles, ...extractTextStyles(element.style) }
    : inheritedStyles;

  // 仅文本容器下钻
  if (
    element.nodeName === 'ink-text' ||
    element.nodeName === 'ink-virtual-text' ||
    element.nodeName === 'ink-link' ||
    element.nodeName === 'ink-root'
  ) {
    for (const child of element.childNodes) {
      accumulateText(child, mergedStyles, onSegment);
    }
  }
  // Box 等容器下钻但不继承文本样式
  else if (element.childNodes) {
    for (const child of element.childNodes) {
      accumulateText(child, inheritedStyles, onSegment);
    }
  }
}

/**
 * 从 Styles 提取 TextStyles。
 */
function extractTextStyles(style: Styles): TextStyles {
  const ts: TextStyles = {};
  if (style.color) ts.color = style.color;
  if (style.backgroundColor) ts.backgroundColor = style.backgroundColor;
  if (style.bold) ts.bold = true;
  if (style.dim) ts.dim = true;
  if (style.italic) ts.italic = true;
  if (style.underline) ts.underline = true;
  if (style.strikethrough) ts.strikethrough = true;
  if (style.inverse) ts.inverse = true;
  return ts;
}
