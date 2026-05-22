/**
 * 样式类型定义和 CSS→Yoga 转换工具
 *
 * 同时用于 Box(布局) 和 Text(排版) 组件的样式定义。
 * 参考 claude-code src/ink/styles.ts
 */

import type { LayoutNode } from './layout/node';
import {
  LayoutAlign,
  LayoutDisplay,
  LayoutFlexDirection,
  LayoutJustify,
  LayoutOverflow,
  LayoutPositionType,
  LayoutWrap,
} from './layout/node';

// ---------------------------------------------------------------------------
// 颜色类型
// ---------------------------------------------------------------------------

/** 颜色值 — 支持命名色、hex、RGB、ANSI 色 */
export type Color = string;

// ---------------------------------------------------------------------------
// 排版样式 (TextStyles)
// ---------------------------------------------------------------------------

export interface TextStyles {
  color?: Color;
  backgroundColor?: Color;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
}

// ---------------------------------------------------------------------------
// 完整样式属性 (Styles)
// ---------------------------------------------------------------------------

export interface Styles {
  // 布局（Box）
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | string;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingX?: number;
  paddingY?: number;
  margin?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  marginX?: number;
  marginY?: number;
  gap?: number;
  columnGap?: number;
  rowGap?: number;
  position?: 'relative' | 'absolute';
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  overflow?: 'visible' | 'hidden' | 'scroll';
  overflowX?: 'visible' | 'hidden' | 'scroll';
  overflowY?: 'visible' | 'hidden' | 'scroll';
  display?: 'flex' | 'none';

  // 排版（Text）
  color?: Color;
  backgroundColor?: Color;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;

  // 文本换行
  textWrap?:
    | 'wrap'
    | 'wrap-trim'
    | 'truncate'
    | 'truncate-start'
    | 'truncate-middle'
    | 'truncate-end';
}

// ---------------------------------------------------------------------------
// CSS → Yoga 样式应用
// ---------------------------------------------------------------------------

/**
 * 将 CSS 样式属性应用到 Yoga 节点。
 *
 * @param style     CSS 样式对象
 * @param yogaNode  Yoga 布局节点
 */
export function applyStyles(style: Styles, yogaNode: LayoutNode): void {
  // 尺寸
  if (style.width !== undefined) {
    if (typeof style.width === 'number') {
      yogaNode.setWidth(style.width);
    } else if (style.width.endsWith('%')) {
      yogaNode.setWidthPercent(Number.parseFloat(style.width));
    }
  }
  if (style.height !== undefined) {
    if (typeof style.height === 'number') {
      yogaNode.setHeight(style.height);
    } else if (style.height.endsWith('%')) {
      yogaNode.setHeightPercent(Number.parseFloat(style.height));
    }
  }
  if (style.minWidth !== undefined) yogaNode.setMinWidth(style.minWidth);
  if (style.minHeight !== undefined) yogaNode.setMinHeight(style.minHeight);
  if (style.maxWidth !== undefined) yogaNode.setMaxWidth(style.maxWidth);
  if (style.maxHeight !== undefined) yogaNode.setMaxHeight(style.maxHeight);

  // Flex
  if (style.flexGrow !== undefined) yogaNode.setFlexGrow(style.flexGrow);
  if (style.flexShrink !== undefined) yogaNode.setFlexShrink(style.flexShrink);
  if (style.flexBasis !== undefined) {
    if (typeof style.flexBasis === 'number') {
      yogaNode.setFlexBasis(style.flexBasis);
    } else if (style.flexBasis === 'auto') {
      // auto flex basis is default in yoga-layout
    } else if (style.flexBasis.endsWith('%')) {
      yogaNode.setFlexBasisPercent(Number.parseFloat(style.flexBasis));
    }
  }
  if (style.flexDirection) {
    const map: Record<string, LayoutFlexDirection> = {
      row: LayoutFlexDirection.Row,
      'row-reverse': LayoutFlexDirection.RowReverse,
      column: LayoutFlexDirection.Column,
      'column-reverse': LayoutFlexDirection.ColumnReverse,
    };
    yogaNode.setFlexDirection(map[style.flexDirection] ?? LayoutFlexDirection.Column);
  }
  if (style.flexWrap) {
    const map: Record<string, LayoutWrap> = {
      nowrap: LayoutWrap.NoWrap,
      wrap: LayoutWrap.Wrap,
      'wrap-reverse': LayoutWrap.WrapReverse,
    };
    yogaNode.setFlexWrap(map[style.flexWrap] ?? LayoutWrap.NoWrap);
  }

  // 对齐
  if (style.justifyContent) {
    const map: Record<string, LayoutJustify> = {
      'flex-start': LayoutJustify.FlexStart,
      center: LayoutJustify.Center,
      'flex-end': LayoutJustify.FlexEnd,
      'space-between': LayoutJustify.SpaceBetween,
      'space-around': LayoutJustify.SpaceAround,
      'space-evenly': LayoutJustify.SpaceEvenly,
    };
    yogaNode.setJustifyContent(map[style.justifyContent] ?? LayoutJustify.FlexStart);
  }
  if (style.alignItems) {
    const map: Record<string, LayoutAlign> = {
      auto: LayoutAlign.Auto,
      stretch: LayoutAlign.Stretch,
      'flex-start': LayoutAlign.FlexStart,
      center: LayoutAlign.Center,
      'flex-end': LayoutAlign.FlexEnd,
    };
    yogaNode.setAlignItems(map[style.alignItems] ?? LayoutAlign.Stretch);
  }
  if (style.alignSelf) {
    const map: Record<string, LayoutAlign> = {
      auto: LayoutAlign.Auto,
      stretch: LayoutAlign.Stretch,
      'flex-start': LayoutAlign.FlexStart,
      center: LayoutAlign.Center,
      'flex-end': LayoutAlign.FlexEnd,
    };
    yogaNode.setAlignSelf(map[style.alignSelf] ?? LayoutAlign.Auto);
  }

  // Padding
  const applyPadding = (edge: import('./layout/node').LayoutEdge, value: number | undefined) => {
    if (value !== undefined) yogaNode.setPadding(edge, value);
  };
  if (style.padding !== undefined) {
    applyPadding('all', style.padding);
  } else {
    applyPadding('top', style.paddingTop ?? style.paddingY);
    applyPadding('bottom', style.paddingBottom ?? style.paddingY);
    applyPadding('left', style.paddingLeft ?? style.paddingX);
    applyPadding('right', style.paddingRight ?? style.paddingX);
  }

  // Margin
  const applyMargin = (edge: import('./layout/node').LayoutEdge, value: number | undefined) => {
    if (value !== undefined) yogaNode.setMargin(edge, value);
  };
  if (style.margin !== undefined) {
    applyMargin('all', style.margin);
  } else {
    applyMargin('top', style.marginTop ?? style.marginY);
    applyMargin('bottom', style.marginBottom ?? style.marginY);
    applyMargin('left', style.marginLeft ?? style.marginX);
    applyMargin('right', style.marginRight ?? style.marginX);
  }

  // Gap
  if (style.gap !== undefined) yogaNode.setGap('all', style.gap);
  if (style.columnGap !== undefined) yogaNode.setGap('column', style.columnGap);
  if (style.rowGap !== undefined) yogaNode.setGap('row', style.rowGap);

  // Position
  if (style.position === 'absolute') {
    yogaNode.setPositionType(LayoutPositionType.Absolute);
    if (style.top !== undefined) yogaNode.setPosition('top', style.top);
    if (style.bottom !== undefined) yogaNode.setPosition('bottom', style.bottom);
    if (style.left !== undefined) yogaNode.setPosition('left', style.left);
    if (style.right !== undefined) yogaNode.setPosition('right', style.right);
  }

  // Overflow
  const overflow = style.overflow ?? style.overflowY;
  if (overflow) {
    const map: Record<string, LayoutOverflow> = {
      visible: LayoutOverflow.Visible,
      hidden: LayoutOverflow.Hidden,
      scroll: LayoutOverflow.Scroll,
    };
    yogaNode.setOverflow(map[overflow] ?? LayoutOverflow.Visible);
  }

  // Display
  if (style.display === 'none') {
    yogaNode.setDisplay(LayoutDisplay.None);
  }
}

// ---------------------------------------------------------------------------
// TextStyles → ANSI SGR 码
// ---------------------------------------------------------------------------

/**
 * 将 TextStyles 转换为 ANSI SGR 码数组。
 * 用于在渲染时生成样式切换序列。
 */
export function textStylesToAnsiCodes(styles: TextStyles): string[] {
  const codes: string[] = [];

  if (styles.color) {
    const colorCode = namedColorToAnsi(styles.color);
    if (colorCode) codes.push(colorCode);
  }
  if (styles.backgroundColor) {
    const bgCode = namedBgColorToAnsi(styles.backgroundColor);
    if (bgCode) codes.push(bgCode);
  }
  if (styles.bold) codes.push('1');
  if (styles.dim) codes.push('2');
  if (styles.italic) codes.push('3');
  if (styles.underline) codes.push('4');
  if (styles.inverse) codes.push('7');
  if (styles.strikethrough) codes.push('9');

  return codes;
}

/**
 * 将命名颜色转换为 ANSI 前景色码。
 * 支持：hex (#rrggbb), rgb (rgb(r,g,b)), 命名色
 */
function namedColorToAnsi(color: string): string | undefined {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return `38;2;${r};${g};${b}`;
    }
  }
  if (color.startsWith('rgb(')) {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return `38;2;${match[1]};${match[2]};${match[3]}`;
    }
  }
  // 常见命名色
  const namedColors: Record<string, string> = {
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
  return namedColors[color.toLowerCase()];
}

/** 将命名颜色转换为 ANSI 背景色码 */
function namedBgColorToAnsi(color: string): string | undefined {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return `48;2;${r};${g};${b}`;
    }
  }
  if (color.startsWith('rgb(')) {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return `48;2;${match[1]};${match[2]};${match[3]}`;
    }
  }
  const namedColors: Record<string, string> = {
    black: '40',
    red: '41',
    green: '42',
    yellow: '43',
    blue: '44',
    magenta: '45',
    cyan: '46',
    white: '47',
    gray: '100',
    grey: '100',
    'bright-red': '101',
    'bright-green': '102',
    'bright-yellow': '103',
    'bright-blue': '104',
    'bright-magenta': '105',
    'bright-cyan': '106',
    'bright-white': '107',
  };
  return namedColors[color.toLowerCase()];
}

/**
 * 从 TextStyles 构建带样式的 SGR 开始序列。
 * 返回空串表示无样式。
 */
export function textStylesToSgrStart(styles?: TextStyles): string {
  if (!styles) return '';
  const codes = textStylesToAnsiCodes(styles);
  if (codes.length === 0) return '';
  return `\x1b[${codes.join(';')}m`;
}
