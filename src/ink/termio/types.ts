/**
 * ANSI 语义类型定义
 *
 * 定义 Parser 输出的语义动作类型和文本样式类型。
 * tokenizer 产生 Token（字符串），parser 产生 Action（结构化语义）。
 */

// ---------------------------------------------------------------------------
// 颜色
// ---------------------------------------------------------------------------

export type NamedColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite';

export type Color =
  | { type: 'named'; name: NamedColor }
  | { type: 'indexed'; index: number }
  | { type: 'rgb'; r: number; g: number; b: number }
  | { type: 'default' };

// ---------------------------------------------------------------------------
// 下划线样式
// ---------------------------------------------------------------------------

export type UnderlineStyle = 'none' | 'single' | 'double' | 'curly' | 'dotted' | 'dashed';

// ---------------------------------------------------------------------------
// 文本样式
// ---------------------------------------------------------------------------

export interface TextStyle {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  blink: boolean;
  reverse: boolean;
  hidden: boolean;
  strikethrough: boolean;
  overline: boolean;
  underline: UnderlineStyle;
  fg: Color;
  bg: Color;
  underlineColor: Color;
}

export function defaultStyle(): TextStyle {
  return {
    bold: false,
    dim: false,
    italic: false,
    blink: false,
    reverse: false,
    hidden: false,
    strikethrough: false,
    overline: false,
    underline: 'none',
    fg: { type: 'default' },
    bg: { type: 'default' },
    underlineColor: { type: 'default' },
  };
}

export function colorsEqual(a: Color, b: Color): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'named':
      return (b as typeof a).name === a.name;
    case 'indexed':
      return (b as typeof a).index === a.index;
    case 'rgb':
      return (b as typeof a).r === a.r && (b as typeof a).g === a.g && (b as typeof a).b === a.b;
    case 'default':
      return true;
  }
}

export function stylesEqual(a: TextStyle, b: TextStyle): boolean {
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.blink === b.blink &&
    a.reverse === b.reverse &&
    a.hidden === b.hidden &&
    a.strikethrough === b.strikethrough &&
    a.overline === b.overline &&
    a.underline === b.underline &&
    colorsEqual(a.fg, b.fg) &&
    colorsEqual(a.bg, b.bg) &&
    colorsEqual(a.underlineColor, b.underlineColor)
  );
}

// ---------------------------------------------------------------------------
// 光标动作
// ---------------------------------------------------------------------------

export type CursorDirection = 'up' | 'down' | 'forward' | 'back';

export type CursorAction =
  | { type: 'move'; direction: CursorDirection; n: number }
  | { type: 'position'; row: number; col: number }
  | { type: 'column'; col: number }
  | { type: 'row'; row: number }
  | { type: 'save' }
  | { type: 'restore' }
  | { type: 'show' }
  | { type: 'hide' }
  | { type: 'style'; n: number }
  | { type: 'nextLine'; n: number }
  | { type: 'prevLine'; n: number };

// ---------------------------------------------------------------------------
// 擦除动作
// ---------------------------------------------------------------------------

export type EraseAction =
  | { type: 'display'; n: number }
  | { type: 'line'; n: number }
  | { type: 'chars'; n: number };

// ---------------------------------------------------------------------------
// 滚动动作
// ---------------------------------------------------------------------------

export type ScrollAction =
  | { type: 'up'; n: number }
  | { type: 'down'; n: number }
  | { type: 'setRegion'; top: number; bottom: number };

// ---------------------------------------------------------------------------
// 模式动作
// ---------------------------------------------------------------------------

export type ModeAction =
  | { type: 'alternateScreen'; enable: boolean }
  | { type: 'bracketedPaste'; enable: boolean }
  | { type: 'mouseTracking'; enable: boolean; mode?: number }
  | { type: 'focusEvents'; enable: boolean };

// ---------------------------------------------------------------------------
// 链接动作
// ---------------------------------------------------------------------------

export type LinkAction = { type: 'start'; url: string; params?: string } | { type: 'end' };

// ---------------------------------------------------------------------------
// 标题动作
// ---------------------------------------------------------------------------

export type TitleAction =
  | { type: 'windowTitle'; title: string }
  | { type: 'iconName'; name: string }
  | { type: 'both'; title: string; iconName?: string };

// ---------------------------------------------------------------------------
// Tab 状态动作
// ---------------------------------------------------------------------------

export type TabStatusAction = {
  type: 'tabStatus';
  indicator?: string;
  status?: string;
  statusColor?: Color | null;
};

// ---------------------------------------------------------------------------
// 字素和文本段
// ---------------------------------------------------------------------------

export type TextSegment = {
  type: 'text';
  text: string;
  style: TextStyle;
};

export type Grapheme = {
  value: string;
  width: 1 | 2;
};

// ---------------------------------------------------------------------------
// 语义动作（Parser 输出）
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'text'; graphemes: Grapheme[]; style: TextStyle }
  | { type: 'cursor'; action: CursorAction }
  | { type: 'erase'; action: EraseAction }
  | { type: 'scroll'; action: ScrollAction }
  | { type: 'mode'; action: ModeAction }
  | { type: 'link'; action: LinkAction }
  | { type: 'title'; action: TitleAction }
  | { type: 'tabStatus'; action: TabStatusAction }
  | { type: 'sgr'; params: string }
  | { type: 'bell' }
  | { type: 'reset' }
  | { type: 'unknown'; sequence: string };
