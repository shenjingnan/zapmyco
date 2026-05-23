/**
 * Ansi — ANSI 解析组件
 *
 * 解析 ANSI 转义码并使用 Text/Link 组件渲染。
 * 用于渲染来自外部工具（如 cli-highlight）的预格式化 ANSI 字符串。
 *
 * 参考 claude-code src/ink/Ansi.tsx
 */

import React from 'react';
import { Link } from './components/Link';
import { Text } from './components/Text';
import type { Color } from './styles';
import { Parser } from './termio/parser';
import type { NamedColor, Color as TermioColor, TextStyle } from './termio/types';

type Props = {
  children: string;
  /** 为 true 时强制所有文本使用 dim 样式 */
  dimColor?: boolean;
};

type SpanProps = {
  color: Color | undefined;
  backgroundColor: Color | undefined;
  dim: boolean | undefined;
  bold: boolean | undefined;
  italic: boolean | undefined;
  underline: boolean | undefined;
  strikethrough: boolean | undefined;
  inverse: boolean | undefined;
  hyperlink?: string;
};

type Span = {
  text: string;
  props: SpanProps;
};

/**
 * 解析 ANSI 字符串为 Span 数组。
 */
function parseToSpans(input: string): Span[] {
  const parser = new Parser();
  const actions = parser.feed(input);
  const spans: Span[] = [];
  let currentHyperlink: string | undefined;

  for (const action of actions) {
    if (action.type === 'link') {
      if (action.action.type === 'start') {
        currentHyperlink = action.action.url;
      } else {
        currentHyperlink = undefined;
      }
      continue;
    }

    if (action.type === 'text') {
      const text = action.graphemes.map((g: { value: string }) => g.value).join('');
      if (!text) continue;
      const props = textStyleToSpanProps(action.style);
      if (currentHyperlink) {
        props.hyperlink = currentHyperlink;
      }

      // 尝试与前一 span 合并（props 相同时）
      const lastSpan = spans[spans.length - 1];
      if (lastSpan && propsEqual(lastSpan.props, props)) {
        lastSpan.text += text;
      } else {
        spans.push({ text, props });
      }
    }
  }

  return spans;
}

/** 将 termio TextStyle 转换为 SpanProps */
function textStyleToSpanProps(style: TextStyle): SpanProps {
  const props: SpanProps = {
    color: undefined,
    backgroundColor: undefined,
    dim: undefined,
    bold: undefined,
    italic: undefined,
    underline: undefined,
    strikethrough: undefined,
    inverse: undefined,
  };
  if (style.bold) props.bold = true;
  if (style.dim) props.dim = true;
  if (style.italic) props.italic = true;
  if (style.underline !== 'none') props.underline = true;
  if (style.strikethrough) props.strikethrough = true;
  if (style.reverse) props.inverse = true;
  const fgColor = colorToString(style.fg);
  if (fgColor) props.color = fgColor;
  const bgColor = colorToString(style.bg);
  if (bgColor) props.backgroundColor = bgColor;
  return props;
}

/** 命名颜色映射表 */
const NAMED_COLOR_MAP: Record<NamedColor, string> = {
  black: 'ansi:black',
  red: 'ansi:red',
  green: 'ansi:green',
  yellow: 'ansi:yellow',
  blue: 'ansi:blue',
  magenta: 'ansi:magenta',
  cyan: 'ansi:cyan',
  white: 'ansi:white',
  brightBlack: 'ansi:blackBright',
  brightRed: 'ansi:redBright',
  brightGreen: 'ansi:greenBright',
  brightYellow: 'ansi:yellowBright',
  brightBlue: 'ansi:blueBright',
  brightMagenta: 'ansi:magentaBright',
  brightCyan: 'ansi:cyanBright',
  brightWhite: 'ansi:whiteBright',
};

/** 将 termio Color 转换为 Ink 字符串格式 */
function colorToString(color: TermioColor): Color | undefined {
  switch (color.type) {
    case 'named':
      return NAMED_COLOR_MAP[color.name] as Color;
    case 'indexed':
      return `ansi256(${color.index})` as Color;
    case 'rgb':
      return `rgb(${color.r},${color.g},${color.b})` as Color;
    case 'default':
      return undefined;
  }
}

/** 比较两个 SpanProps 是否相等（用于合并） */
function propsEqual(a: SpanProps, b: SpanProps): boolean {
  return (
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.inverse === b.inverse &&
    a.hyperlink === b.hyperlink
  );
}

function hasAnyProps(props: SpanProps): boolean {
  return (
    props.color !== undefined ||
    props.backgroundColor !== undefined ||
    props.dim === true ||
    props.bold === true ||
    props.italic === true ||
    props.underline === true ||
    props.strikethrough === true ||
    props.inverse === true ||
    props.hyperlink !== undefined
  );
}

function hasAnyTextProps(props: SpanProps): boolean {
  return (
    props.color !== undefined ||
    props.backgroundColor !== undefined ||
    props.dim === true ||
    props.bold === true ||
    props.italic === true ||
    props.underline === true ||
    props.strikethrough === true ||
    props.inverse === true
  );
}

/**
 * StyledText — 处理 bold/dim 互斥性的包装组件。
 * dim 优先级高于 bold（终端将二者视为互斥）。
 */
function StyledText({
  bold,
  dim,
  color,
  backgroundColor,
  italic,
  underline,
  strikethrough,
  inverse,
  children,
}: SpanProps & { children: string }): React.ReactNode {
  // 构建传递给 Text 的 props，跳过 undefined 值（exactOptionalPropertyTypes 需要）
  const textColor = color || undefined;
  const textBg = backgroundColor || undefined;
  const textItalic = italic || undefined;
  const textUnderline = underline || undefined;
  const textStrike = strikethrough || undefined;
  const textInverse = inverse || undefined;

  if (dim) {
    return (
      <Text
        color={textColor as string}
        backgroundColor={textBg as string}
        italic={textItalic as boolean}
        underline={textUnderline as boolean}
        strikethrough={textStrike as boolean}
        inverse={textInverse as boolean}
        dim
      >
        {children}
      </Text>
    );
  }
  if (bold) {
    return (
      <Text
        color={textColor as string}
        backgroundColor={textBg as string}
        italic={textItalic as boolean}
        underline={textUnderline as boolean}
        strikethrough={textStrike as boolean}
        inverse={textInverse as boolean}
        bold
      >
        {children}
      </Text>
    );
  }
  return (
    <Text
      color={textColor as string}
      backgroundColor={textBg as string}
      italic={textItalic as boolean}
      underline={textUnderline as boolean}
      strikethrough={textStrike as boolean}
      inverse={textInverse as boolean}
    >
      {children}
    </Text>
  );
}

/**
 * Ansi 组件 — 解析 ANSI 转义码并使用 Ink 组件渲染。
 * 使用 React.memo 避免 children 未变时的重渲染。
 */
export const Ansi = React.memo(function Ansi({ children, dimColor }: Props) {
  if (typeof children !== 'string') {
    return dimColor ? <Text dim>{String(children)}</Text> : <Text>{String(children)}</Text>;
  }

  if (children === '') return null;

  const spans = parseToSpans(children);
  if (spans.length === 0) return null;

  if (spans.length === 1 && !hasAnyProps(spans[0]!.props)) {
    return dimColor ? <Text dim>{spans[0]!.text}</Text> : <Text>{spans[0]!.text}</Text>;
  }

  const content = spans.map((span, i) => {
    const hyperlink = span.props.hyperlink;
    if (dimColor) span.props.dim = true;
    const hasTextProps = hasAnyTextProps(span.props);

    if (hyperlink) {
      return hasTextProps ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: text spans have no stable id
        <Link key={i} url={hyperlink}>
          <StyledText
            color={span.props.color}
            backgroundColor={span.props.backgroundColor}
            dim={span.props.dim}
            bold={span.props.bold}
            italic={span.props.italic}
            underline={span.props.underline}
            strikethrough={span.props.strikethrough}
            inverse={span.props.inverse}
          >
            {span.text}
          </StyledText>
        </Link>
      ) : (
        // biome-ignore lint/suspicious/noArrayIndexKey: text spans have no stable id
        <Link key={i} url={hyperlink}>
          {span.text}
        </Link>
      );
    }

    return hasTextProps ? (
      <StyledText
        // biome-ignore lint/suspicious/noArrayIndexKey: text spans have no stable id
        key={i}
        color={span.props.color}
        backgroundColor={span.props.backgroundColor}
        dim={span.props.dim}
        bold={span.props.bold}
        italic={span.props.italic}
        underline={span.props.underline}
        strikethrough={span.props.strikethrough}
        inverse={span.props.inverse}
      >
        {span.text}
      </StyledText>
    ) : (
      span.text
    );
  });

  return dimColor ? <Text dim>{content}</Text> : <Text>{content}</Text>;
});
