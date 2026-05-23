/**
 * render-border — 边框渲染
 *
 * 在 Output 上渲染各种风格的边框。
 * 支持：single / double / round / dashed / custom。
 * 可选嵌入 borderText（位置/对齐/偏移）。
 *
 * 参考 claude-code src/ink/render-border.ts
 */

import type { DOMElement } from './dom';
import type { Output } from './output';
import { stringWidth } from './stringWidth';
import { getStyleId } from './style-cache';
import type { Color } from './styles';

// ---------------------------------------------------------------------------
// 边框样式类型
// ---------------------------------------------------------------------------

export interface BoxStyle {
  top: string;
  topLeft: string;
  topRight: string;
  bottom: string;
  bottomLeft: string;
  bottomRight: string;
  left: string;
  right: string;
}

export type BorderStyle = 'single' | 'double' | 'round' | 'dashed' | BoxStyle;

export interface BorderTextOptions {
  content: string;
  position?: 'top' | 'bottom';
  align?: 'start' | 'end' | 'center';
  offset?: number;
}

// ---------------------------------------------------------------------------
// 预定义边框字符集
// ---------------------------------------------------------------------------

const BOX_STYLES: Record<string, BoxStyle> = {
  single: {
    top: '─',
    topLeft: '┌',
    topRight: '┐',
    bottom: '─',
    bottomLeft: '└',
    bottomRight: '┘',
    left: '│',
    right: '│',
  },
  double: {
    top: '═',
    topLeft: '╔',
    topRight: '╗',
    bottom: '═',
    bottomLeft: '╚',
    bottomRight: '╝',
    left: '║',
    right: '║',
  },
  round: {
    top: '─',
    topLeft: '╭',
    topRight: '╮',
    bottom: '─',
    bottomLeft: '╰',
    bottomRight: '╯',
    left: '│',
    right: '│',
  },
  dashed: {
    top: '╌',
    left: '╎',
    right: '╎',
    bottom: '╌',
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
  },
  bold: {
    top: '━',
    topLeft: '┏',
    topRight: '┓',
    bottom: '━',
    bottomLeft: '┗',
    bottomRight: '┛',
    left: '┃',
    right: '┃',
  },
};

// ---------------------------------------------------------------------------
// 边框渲染
// ---------------------------------------------------------------------------

/**
 * 渲染 DOM 元素的边框。
 * 应在子节点渲染之后调用，确保边框覆盖子节点的清除操作。
 */
export function renderBorder(x: number, y: number, node: DOMElement, output: Output): void {
  const style = node.style;
  const borderStyle = style.borderStyle;
  if (!borderStyle) return;

  // 解析边框字符集
  const resolvedBox: BoxStyle | undefined =
    typeof borderStyle === 'string' ? BOX_STYLES[borderStyle] : borderStyle;
  if (!resolvedBox) return;
  const box: BoxStyle = resolvedBox;

  // 获取尺寸（从 Yoga 节点或直接使用传入的 xy）
  const yoga = node.yogaNode;
  if (!yoga) return;

  const computedWidth = Math.round(yoga.getComputedWidth());
  const computedHeight = Math.round(yoga.getComputedHeight());

  // 每侧可见性
  const showTop = style.borderTop !== false;
  const showBottom = style.borderBottom !== false;
  const showLeft = style.borderLeft !== false;
  const showRight = style.borderRight !== false;

  // 颜色解析
  const borderColor = (style.borderColor ?? style.color) as Color | undefined;
  const borderDim = (style.borderDimColor ?? style.dim) as boolean | undefined;
  const topColor = (style.borderTopColor ?? borderColor) as Color | undefined;
  const bottomColor = (style.borderBottomColor ?? borderColor) as Color | undefined;
  const leftColor = (style.borderLeftColor ?? borderColor) as Color | undefined;
  const rightColor = (style.borderRightColor ?? borderColor) as Color | undefined;
  const topDim = (style.borderTopDimColor ?? borderDim) as boolean | undefined;
  const bottomDim = (style.borderBottomDimColor ?? borderDim) as boolean | undefined;
  const leftDim = (style.borderLeftDimColor ?? borderDim) as boolean | undefined;
  const rightDim = (style.borderRightDimColor ?? borderDim) as boolean | undefined;

  // 内容宽度 = 总宽度 - 左右边框
  const contentWidth = computedWidth - (showLeft ? 1 : 0) - (showRight ? 1 : 0);

  // 边框文本
  const borderText = style.borderText as BorderTextOptions | undefined;

  // ---- 顶边 ----
  if (showTop && computedHeight > 0) {
    const leftChar = showLeft ? box.topLeft : '';
    const rightChar = showRight ? box.topRight : '';
    const repeatChar = box.top;
    const topLine = buildBorderLine(
      leftChar,
      repeatChar,
      rightChar,
      contentWidth,
      borderText?.position === 'top' ? borderText : undefined
    );
    const styleId = getBorderStyleId(topColor, topDim);
    output.write(x, y, topLine, styleId);
  }

  // ---- 侧边 ----
  for (let row = 1; row < computedHeight - 1; row++) {
    if (showLeft) {
      const styleId = getBorderStyleId(leftColor, leftDim);
      output.write(x, y + row, box.left, styleId);
    }
    if (showRight) {
      const styleId = getBorderStyleId(rightColor, rightDim);
      output.write(x + computedWidth - 1, y + row, box.right, styleId);
    }
  }

  // ---- 底边 ----
  if (showBottom && computedHeight > 0) {
    const leftChar = showLeft ? box.bottomLeft : '';
    const rightChar = showRight ? box.bottomRight : '';
    const repeatChar = box.bottom;
    const bottomLine = buildBorderLine(
      leftChar,
      repeatChar,
      rightChar,
      contentWidth,
      borderText?.position === 'bottom' ? borderText : undefined
    );
    const styleId = getBorderStyleId(bottomColor, bottomDim);
    output.write(x, y + computedHeight - 1, bottomLine, styleId);
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 构建单行边框字符串（含可选的嵌入文本） */
function buildBorderLine(
  leftCorner: string,
  repeatChar: string,
  rightCorner: string,
  contentWidth: number,
  textOpts?: BorderTextOptions
): string {
  if (!textOpts || textOpts.position === undefined) {
    return leftCorner + repeatChar.repeat(Math.max(0, contentWidth)) + rightCorner;
  }

  const { content, align = 'center', offset = 0 } = textOpts;
  const textWidth = stringWidth(content);

  // 计算文本插入位置
  let textStart: number;
  if (align === 'start') {
    textStart = offset;
  } else if (align === 'end') {
    textStart = contentWidth - textWidth - offset;
  } else {
    // center
    textStart = Math.floor((contentWidth - textWidth) / 2) + offset;
  }

  textStart = Math.max(0, Math.min(textStart, contentWidth - textWidth));

  // 构建行
  const beforeText = Math.max(0, textStart);
  const afterText = Math.max(0, contentWidth - textStart - textWidth);

  return (
    leftCorner +
    repeatChar.repeat(beforeText) +
    content +
    repeatChar.repeat(afterText) +
    rightCorner
  );
}

/** 获取边框样式的 styleId */
function getBorderStyleId(color?: Color, dim?: boolean): number {
  const ansiCodes: string[] = [];
  if (color) {
    // 简单颜色处理 — 支持命名色和 hex
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        const r = Number.parseInt(hex.charAt(0) + hex.charAt(0), 16);
        const g = Number.parseInt(hex.charAt(1) + hex.charAt(1), 16);
        const b = Number.parseInt(hex.charAt(2) + hex.charAt(2), 16);
        ansiCodes.push(`38;2;${r};${g};${b}`);
      } else if (hex.length === 6) {
        const r = Number.parseInt(hex.slice(0, 2), 16);
        const g = Number.parseInt(hex.slice(2, 4), 16);
        const b = Number.parseInt(hex.slice(4, 6), 16);
        ansiCodes.push(`38;2;${r};${g};${b}`);
      }
    } else {
      // 命名色映射到 ANSI 16 色
      const namedColor = color.toLowerCase();
      const colorMap: Record<string, string> = {
        black: '30',
        red: '31',
        green: '32',
        yellow: '33',
        blue: '34',
        magenta: '35',
        cyan: '36',
        white: '37',
        gray: '90',
        grey: '90',
        'bright-red': '91',
        'bright-green': '92',
        'bright-yellow': '93',
        'bright-blue': '94',
        'bright-magenta': '95',
        'bright-cyan': '96',
        'bright-white': '97',
      };
      const code = colorMap[namedColor];
      if (code) ansiCodes.push(code);
    }
  }

  if (dim) ansiCodes.push('2');

  const key = ansiCodes.join(',');
  return getStyleId(key, ansiCodes);
}
