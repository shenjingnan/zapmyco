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
 * PR3: 添加 ScrollBox 滚动支持
 * PR9: 添加边框渲染、背景渲染、文本换行集成
 */

import type { DOMElement } from './dom';
import { getMaxWidth } from './get-max-width';
import { updateNodeCache } from './hit-test';
import { lineWidth } from './line-width-cache';
import { type Clip, Output } from './output';
import { renderBackground } from './render-background';
import { renderBorder } from './render-border';
import { squashTextNodesToSegments } from './squash-text-nodes';
import { getStyleId } from './style-cache';
import type { TextStyles } from './styles';
import { textStylesToAnsiCodes } from './styles';
import { widestLine } from './widest-line';
import { type TextWrapType, wrapText } from './wrap-text';

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
      // 超链接内部文本节点由父 Text 的 squashTextNodes 收集
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

  // 缓存布局信息供 hit-test 使用
  updateNodeCache(node, x, y, w, h);

  // 压入裁剪栈
  const clip: Clip = {
    x1: x,
    y1: y,
    x2: x + w - 1,
    y2: y + h - 1,
  };
  output.clip(clip);

  // PR9: 在子节点渲染前绘制背景
  const bgColor = node.style.backgroundColor;
  if (bgColor) {
    renderBackground(x, y, w, h, bgColor as string, output);
  }

  // 在 Box 的 padding 区域内渲染子节点
  const padTop = Math.round(yoga.getComputedPadding('top'));
  const padLeft = Math.round(yoga.getComputedPadding('left'));
  const childOutput = new Output({ width: w, height: h });
  renderChildren(node, childOutput, options);

  // 将子节点内容 blit 到父 Output 的正确位置
  const childScreen = childOutput.get();
  output.blit(childScreen, 0, 0, w, h, x + padLeft, y + padTop);

  output.unclip();

  // PR9: 在子节点渲染后绘制边框（确保覆盖子节点的清除操作）
  renderBorder(x, y, node, output);
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

  // 缓存布局信息供 hit-test 使用
  updateNodeCache(node, x, y, w, h);

  // 压入裁剪栈（限制到视口区域）
  const clip: Clip = {
    x1: x,
    y1: y,
    x2: x + w - 1,
    y2: y + h - 1,
  };
  output.clip(clip);

  // PR9: 背景渲染
  const bgColor = node.style.backgroundColor;
  if (bgColor) {
    renderBackground(x, y, w, h, bgColor as string, output);
  }

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
  output.blit(childScreen, 0, 0, w, h, x, y);

  output.unclip();

  // PR9: 边框渲染
  renderBorder(x, y, node, output);
}

/** 渲染 ink-text 节点 — 生成带样式的文本 */
function renderText(node: DOMElement, output: Output): void {
  const yoga = node.yogaNode;
  if (!yoga) return;

  const x = Math.round(yoga.getComputedLeft());
  const y = Math.round(yoga.getComputedTop());
  const w = Math.round(yoga.getComputedWidth());

  // 缓存布局信息供 hit-test 使用
  updateNodeCache(node, x, y, w, 1);

  // PR9: 使用 squashTextNodesToSegments 收集带样式的文本片段
  const segments = squashTextNodesToSegments(node, node.style as TextStyles);

  // PR9: 获取可用内容宽度（考虑 padding 和 border）
  const maxWidth = Math.min(
    getMaxWidth(yoga),
    w - Math.round(yoga.getComputedPadding('left')) - Math.round(yoga.getComputedPadding('right'))
  );

  if (maxWidth <= 0) return;

  // 当前写入位置
  let currentX = x + Math.round(yoga.getComputedPadding('left'));
  let currentY = y + Math.round(yoga.getComputedPadding('top'));

  for (const segment of segments) {
    if (!segment.text) continue;
    const text = segment.text;
    const textStyles = segment.styles;

    // PR9: 检查是否需要换行
    const lineWidest = widestLine(text);
    const needsWrap = lineWidest > maxWidth;
    const wrapType = (node.style.textWrap as TextWrapType) ?? 'wrap';

    // 确定显示文本
    let displayText: string;
    if (needsWrap) {
      displayText = wrapText(text, maxWidth, wrapType);
    } else {
      displayText = text;
    }

    // 生成样式 ID
    const ansiCodes = textStylesToAnsiCodes(textStyles);
    const styleKey = ansiCodes.join(',');
    const styleId = getStyleId(styleKey, ansiCodes);

    // 写入文本
    const lines = displayText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (i > 0) {
        // 换行
        currentY++;
        currentX = x + Math.round(yoga.getComputedPadding('left'));
      }
      // 截断以适配可用宽度
      const truncatedLine =
        lineWidth(line) > maxWidth ? wrapText(line, maxWidth, 'truncate-end') : line;
      output.write(currentX, currentY, truncatedLine, styleId);
      // 更新 X 位置（多个 segment 在同一行）
      currentX += lineWidth(truncatedLine);
    }
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

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

  // 缓存布局信息供 hit-test 使用
  if (yoga) {
    updateNodeCache(
      node,
      x,
      y,
      Math.round(yoga.getComputedWidth()),
      Math.round(yoga.getComputedHeight())
    );
  }

  // 逐行写入原始 ANSI 文本
  const lines = (rawText as string).split('\n');
  for (let i = 0; i < lines.length; i++) {
    output.write(x, y + i, lines[i] ?? '');
  }
}

// 样式缓存管理已提取到 ./style-cache
// 导出兼容符号
export { clearStyleCaches, getStyleCodes, transitionStyle } from './style-cache';
