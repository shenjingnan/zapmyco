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
  const styleId = getOrCreateStyleId(styleKey, ansiCodes);

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

// ---------------------------------------------------------------------------
// 简化的 StylePool 替代方案
// ---------------------------------------------------------------------------

const styleIdCache = new Map<string, number>();
const styleCodesCache: string[][] = [];
let nextStyleId = 1; // 0 = none

function getOrCreateStyleId(key: string, codes: string[]): number {
  if (key === '' || codes.length === 0) return 0;
  const existing = styleIdCache.get(key);
  if (existing !== undefined) return existing;
  const id = nextStyleId++;
  styleIdCache.set(key, id);
  styleCodesCache[id] = codes;
  return id;
}

/** 从 styleId 获取 ANSI 码数组 */
export function getStyleCodes(id: number): readonly string[] {
  return styleCodesCache[id] ?? [];
}

/** 获取从 fromId 切换到 toId 的 ANSI 序列 */
export function transitionStyle(fromId: number, toId: number): string {
  if (fromId === toId) return '';
  if (toId === 0) return '\x1b[0m';
  if (fromId === 0) {
    const codes = styleCodesCache[toId];
    if (!codes || codes.length === 0) return '';
    return `\x1b[${codes.join(';')}m`;
  }
  const toCodes = styleCodesCache[toId];
  if (!toCodes || toCodes.length === 0) return '\x1b[0m';
  return `\x1b[0m\x1b[${toCodes.join(';')}m`;
}

/** 清空样式缓存 */
export function clearStyleCaches(): void {
  styleIdCache.clear();
  styleCodesCache.length = 0;
  nextStyleId = 1;
}
