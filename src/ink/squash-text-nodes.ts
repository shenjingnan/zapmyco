/**
 * squash-text-nodes — DOM 文本节点合并为 StyledSegment
 *
 * 递归遍历 DOM 树，将文本节点合并为带样式的片段数组。
 * 用于 render-node-to-output.ts 的文本渲染管线。
 *
 * 参考 claude-code src/ink/squash-text-nodes.ts
 */

import type { DOMElement, DOMNode } from './dom';
import type { Styles, TextStyles } from './styles';

// ---------------------------------------------------------------------------
// StyledSegment 类型
// ---------------------------------------------------------------------------

export interface StyledSegment {
  text: string;
  styles: TextStyles;
  hyperlink: string | undefined;
}

// ---------------------------------------------------------------------------
// 递归收集
// ---------------------------------------------------------------------------

/**
 * 递归收集 DOM 子树中的文本节点，合并为带样式的片段数组。
 *
 * - #text 节点：用当前合并的样式生成片段
 * - ink-text / ink-virtual-text：下钻并合并样式
 * - ink-link：下钻并记录 hyperlink
 * - ink-box 等容器：跳过（不产生文本）
 *
 * @param node       - 当前 DOM 节点
 * @param parentStyles - 从父节点继承的样式
 * @param hyperlink  - 从 ink-link 继承的超链接
 * @returns StyledSegment 数组
 */
export function squashTextNodesToSegments(
  node: DOMNode,
  parentStyles: TextStyles = {},
  hyperlink?: string
): StyledSegment[] {
  // 文本节点
  if (node.nodeName === '#text') {
    const text = node.nodeValue;
    if (!text) return [];
    return [{ text, styles: { ...parentStyles }, hyperlink }];
  }

  const element = node as DOMElement;

  // 合并当前元素样式
  const mergedStyles = element.style
    ? { ...parentStyles, ...extractTextStyles(element.style) }
    : parentStyles;

  // 检查是否是 link 节点
  const linkHref =
    element.nodeName === 'ink-link'
      ? ((element.attributes.href as string | undefined) ?? hyperlink)
      : hyperlink;

  // 仅文本容器才下钻收集
  if (
    element.nodeName === 'ink-text' ||
    element.nodeName === 'ink-virtual-text' ||
    element.nodeName === 'ink-link'
  ) {
    const segments: StyledSegment[] = [];
    for (const child of element.childNodes) {
      segments.push(...squashTextNodesToSegments(child, mergedStyles, linkHref));
    }
    return segments;
  }

  // 非文本节点（box 等）不产生文本片段
  return [];
}

/**
 * 仅收集纯文本（无样式），用于测量。
 */
export function squashTextNodes(node: DOMNode): string {
  if (node.nodeName === '#text') {
    return node.nodeValue;
  }

  const element = node as DOMElement;
  // 仅文本容器才收集
  if (
    element.nodeName === 'ink-text' ||
    element.nodeName === 'ink-virtual-text' ||
    element.nodeName === 'ink-link'
  ) {
    let result = '';
    for (const child of element.childNodes) {
      result += squashTextNodes(child);
    }
    return result;
  }

  return '';
}

/**
 * 从通用 Styles 对象提取文本样式子集。
 */
function extractTextStyles(style: Styles): TextStyles {
  const textStyles: TextStyles = {};
  if (typeof style.color === 'string') textStyles.color = style.color;
  if (typeof style.backgroundColor === 'string') textStyles.backgroundColor = style.backgroundColor;
  if (style.bold === true) textStyles.bold = true;
  if (style.dim === true) textStyles.dim = true;
  if (style.italic === true) textStyles.italic = true;
  if (style.underline === true) textStyles.underline = true;
  if (style.strikethrough === true) textStyles.strikethrough = true;
  if (style.inverse === true) textStyles.inverse = true;
  return textStyles;
}
