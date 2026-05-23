/**
 * renderNodeToOutput — DOM 树遍历 → Output 操作
 *
 * 递归遍历 DOM 树，使用 Yoga 计算的布局信息将每个节点渲染到 Output。
 *
 * PR2 简化版实现：
 *   - ink-root: 渲染子节点
 *   - ink-box: 裁剪到 Yoga 计算的 bounding rect，渲染子节点
 *   - ink-text: 将文本节点写入 Output，应用 TextStyles 样式
 *
 * 后续 PR 将添加：
 *   - ScrollBox 滚动支持（PR3）
 *   - Blit fast path（PR6）
 *   - NoSelect（PR4）
 *   - 边框渲染（PR9）
 */

import type { DOMElement } from './dom';
import { type Clip, Output } from './output';
import { getStyleId } from './style-cache';
import type { TextStyles } from './styles';
import { textStylesToAnsiCodes } from './styles';

// ---------------------------------------------------------------------------
// renderNodeToOutput
// ---------------------------------------------------------------------------

export interface RenderOptions {
  prevScreen?: import('./screen').Screen;
}

/**
 * 递归遍历 DOM 树，将节点渲染到 Output。
 */
export function renderNodeToOutput(
  node: DOMElement,
  output: Output,
  options?: RenderOptions
): void {
  switch (node.nodeName) {
    case 'ink-root':
      renderRoot(node, output, options);
      break;
    case 'ink-box':
      renderBox(node, output, options);
      break;
    case 'ink-scroll-box':
      renderScrollBox(node, output, options);
      break;
    case 'ink-text':
      renderText(node, output);
      break;
    case 'ink-virtual-text':
      renderChildren(node, output, options);
      break;
    case 'ink-link':
      // 超链接内部文本节点由父 Text 的 collectText 收集
      // 超链接渲染由 Text 组件处理（通过 href 属性）
      renderChildren(node, output, options);
      break;
    case 'ink-raw-ansi':
      renderRawAnsi(node, output);
      break;
    default:
      renderChildren(node, output, options);
  }
}

/** 渲染 ink-root 节点 */
function renderRoot(node: DOMElement, output: Output, options?: RenderOptions): void {
  renderChildren(node, output, options);
}

/** 渲染 ink-box 节点 — 使用 Yoga 计算的位置 */
function renderBox(node: DOMElement, output: Output, options?: RenderOptions): void {
  const yoga = node.yogaNode;
  if (!yoga) {
    renderChildren(node, output, options);
    return;
  }

  const x = Math.round(yoga.getComputedLeft());
  const y = Math.round(yoga.getComputedTop());
  const w = Math.round(yoga.getComputedWidth());
  const h = Math.round(yoga.getComputedHeight());

  // 应用 padding
  const padTop = Math.round(yoga.getComputedPadding('top'));
  const padLeft = Math.round(yoga.getComputedPadding('left'));

  // 压入裁剪栈
  const clip: Clip = {
    x1: x,
    y1: y,
    x2: x + w - 1,
    y2: y + h - 1,
  };
  output.clip(clip);

  // 在 Box 的 padding 区域内渲染子节点
  const childOutput = new Output({ width: w, height: h });
  renderChildren(node, childOutput, options);

  // 将子节点内容 blit 到父 Output 的正确位置
  const childScreen = childOutput.get();
  output.blit(childScreen, 0, 0, w, h, x + padLeft, y + padTop);

  output.unclip();
}

/** 渲染 ink-scroll-box 节点 — 裁剪到视口，标记溢出状态 */
function renderScrollBox(node: DOMElement, output: Output, options?: RenderOptions): void {
  const yoga = node.yogaNode;
  if (!yoga) {
    renderChildren(node, output, options);
    return;
  }

  const x = Math.round(yoga.getComputedLeft());
  const y = Math.round(yoga.getComputedTop());
  const w = Math.round(yoga.getComputedWidth());
  const h = Math.round(yoga.getComputedHeight());

  // 应用 padding
  const padTop = Math.round(yoga.getComputedPadding('top'));
  const padLeft = Math.round(yoga.getComputedPadding('left'));

  // 压入裁剪栈（限制到视口区域）
  const clip: Clip = {
    x1: x,
    y1: y,
    x2: x + w - 1,
    y2: y + h - 1,
  };
  output.clip(clip);

  // 在完整区域内渲染子节点
  const childOutput = new Output({ width: w, height: h });
  renderChildren(node, childOutput, options);

  // 获取子内容
  const childScreen = childOutput.get();

  // 检查内容是否溢出视口 → 标记 scrollDrainPending
  if (childScreen.rows > h) {
    node.attributes['data-scroll-drain'] = true;
  }

  // 将子节点内容 blit 到父 Output 的正确位置
  output.blit(childScreen, 0, 0, w, h, x + padLeft, y + padTop);

  output.unclip();
}

/** 渲染 ink-text 节点 — 生成带样式的文本 */
function renderText(node: DOMElement, output: Output): void {
  const yoga = node.yogaNode;
  if (!yoga) return;

  const x = Math.round(yoga.getComputedLeft());
  const y = Math.round(yoga.getComputedTop());
  const w = Math.round(yoga.getComputedWidth());

  // 收集所有文本子节点
  const text = collectText(node);
  if (text.length === 0) return;

  // 应用 TextStyles → SGR 码
  const textStyles = node.style as TextStyles;
  const ansiCodes = textStylesToAnsiCodes(textStyles);

  // 使用轻量级 styleId
  const styleKey = ansiCodes.join(',');
  const styleId = getStyleId(styleKey, ansiCodes);

  // 写入文本（截断以适配宽度）
  const displayText = text.slice(0, w);
  output.write(x, y, displayText, styleId);
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 收集节点下的所有文本 */
function collectText(node: DOMElement): string {
  let result = '';
  for (const child of node.childNodes) {
    if (child.nodeName === '#text') {
      result += child.nodeValue;
    } else if ('childNodes' in child) {
      result += collectText(child);
    }
  }
  return result;
}

/** 渲染子节点 */
function renderChildren(node: DOMElement, output: Output, options?: RenderOptions): void {
  for (const child of node.childNodes) {
    if (child.nodeName === '#text') {
      // 裸文本节点
      const parentYoga = node.yogaNode;
      if (parentYoga) {
        const x = Math.round(parentYoga.getComputedLeft());
        const y = Math.round(parentYoga.getComputedTop());
        output.write(x, y, child.nodeValue);
      }
    } else if ('childNodes' in child) {
      renderNodeToOutput(child as DOMElement, output, options);
    }
  }
}

/** 渲染 ink-raw-ansi 节点 — 原始 ANSI 透传 */
function renderRawAnsi(node: DOMElement, output: Output): void {
  const rawText = node.attributes.rawText as string | undefined;
  const rawWidth = node.attributes.rawWidth as number | undefined;
  const rawHeight = node.attributes.rawHeight as number | undefined;

  if (!rawText || !rawWidth || !rawHeight) return;

  const yoga = node.yogaNode;
  const x = yoga ? Math.round(yoga.getComputedLeft()) : 0;
  const y = yoga ? Math.round(yoga.getComputedTop()) : 0;

  // 逐行写入原始 ANSI 文本
  const lines = (rawText as string).split('\n');
  for (let i = 0; i < lines.length; i++) {
    output.write(x, y + i, lines[i] ?? '');
  }
}

// 样式缓存管理已提取到 ./style-cache
// 导出兼容符号
export { clearStyleCaches, getStyleCodes, transitionStyle } from './style-cache';
