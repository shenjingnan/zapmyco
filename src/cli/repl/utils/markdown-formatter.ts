/**
 * Markdown → ANSI 格式化器
 *
 * 将 LLM 返回的 Markdown 文本解析并应用 ANSI 样式（颜色、加粗、斜体等），
 * 使终端输出更易读。参考 Claude Code 的 formatToken 实现。
 *
 * 使用方式:
 *   import { formatMarkdown } from '@/cli/repl/utils/markdown-formatter';
 *   console.log(formatMarkdown('**hello** world'));
 */

import chalk from 'chalk';
import { marked, type Token, type Tokens } from 'marked';

// 禁用删除线解析（~100 中的 ~ 常被误解析为删除线）
let markedConfigured = false;
function configureMarked(): void {
  if (markedConfigured) return;
  markedConfigured = true;
  marked.use({
    tokenizer: {
      del() {
        return undefined;
      },
    },
  });
}

const EOL = '\n';
const LIST_ITEM_MARKER = '-';
const BLOCKQUOTE_BAR = '│';

/**
 * 格式化 Markdown 文本为 ANSI 样式字符串
 *
 * @param text - 原始 Markdown 文本
 * @param colorEnabled - 是否启用颜色（false 时仅保留结构格式化）
 * @returns 格式化后的字符串
 */
export function formatMarkdown(text: string, colorEnabled = true): string {
  if (!text) return '';

  configureMarked();

  const tokens = marked.lexer(text);
  const parts: string[] = [];

  for (const token of tokens) {
    parts.push(formatToken(token, colorEnabled, 0, null, null));
  }

  return parts.join('').trimEnd();
}

function c(colorEnabled: boolean): typeof chalk {
  if (colorEnabled) return chalk;
  // 颜色禁用时复制 chalk 实例并关闭颜色级别
  const noColor = Object.create(chalk);
  noColor.level = 0;
  return noColor;
}

function formatToken(
  token: Token,
  colorEnabled: boolean,
  listDepth: number,
  orderedListNumber: number | null,
  parent: Token | null
): string {
  const ch = c(colorEnabled);

  switch (token.type) {
    case 'blockquote': {
      const inner = token.tokens
        ? token.tokens.map((t) => formatToken(t, colorEnabled, 0, null, null)).join('')
        : '';
      const bar = ch.dim(BLOCKQUOTE_BAR);
      return inner
        .split(EOL)
        .map((line) => (line.trim() ? `${bar} ${ch.italic(line)}` : line))
        .join(EOL);
    }

    case 'code': {
      // 代码块：用 dim 背景色包裹（模拟代码块区域感）
      const lang = token.lang ? `${ch.dim(` ${token.lang}`)}` : '';
      const header = token.lang ? `${ch.dim('```')}${lang}${EOL}` : '';
      const footer = token.lang ? `${EOL}${ch.dim('```')}` : '';
      return `${header}${ch.dim(token.text)}${footer}${EOL}`;
    }

    case 'codespan': {
      // 行内代码
      return ch.cyan(token.text);
    }

    case 'em': {
      const inner = token.tokens
        ? token.tokens.map((t) => formatToken(t, colorEnabled, 0, null, token)).join('')
        : '';
      return ch.italic(inner);
    }

    case 'strong': {
      const inner = token.tokens
        ? token.tokens.map((t) => formatToken(t, colorEnabled, 0, null, token)).join('')
        : '';
      return ch.bold(inner);
    }

    case 'heading': {
      const inner = token.tokens
        ? token.tokens.map((t) => formatToken(t, colorEnabled, 0, null, null)).join('')
        : '';

      if (token.depth === 1) {
        return `${ch.bold.italic.underline(inner)}${EOL}${EOL}`;
      }
      // h2+：加粗
      return `${ch.bold(inner)}${EOL}${EOL}`;
    }

    case 'hr': {
      return ch.dim('─'.repeat(50)) + EOL;
    }

    case 'image': {
      return token.href;
    }

    case 'link': {
      const linkText = token.tokens
        ? token.tokens.map((t) => formatToken(t, colorEnabled, 0, null, token)).join('')
        : '';
      if (linkText && linkText !== token.href) {
        return `${linkText} ${ch.dim(`(${token.href})`)}`;
      }
      return ch.dim(token.href);
    }

    case 'list': {
      return token.items
        .map((item: Token, index: number) =>
          formatToken(
            item,
            colorEnabled,
            listDepth,
            token.ordered ? (token.start ?? 1) + index : null,
            token
          )
        )
        .join('');
    }

    case 'list_item': {
      const marker = orderedListNumber !== null ? `${orderedListNumber}.` : LIST_ITEM_MARKER;

      const indent = '  '.repeat(listDepth);
      const content = token.tokens
        ? token.tokens
            .map((t) => formatToken(t, colorEnabled, listDepth + 1, orderedListNumber, token))
            .join('')
        : '';

      return `${indent}${marker} ${content.trimStart()}`;
    }

    case 'paragraph': {
      const inner = token.tokens
        ? token.tokens.map((t) => formatToken(t, colorEnabled, 0, null, null)).join('')
        : '';
      return inner + EOL;
    }

    case 'space': {
      return EOL;
    }

    case 'br': {
      return EOL;
    }

    case 'text': {
      if (parent?.type === 'list_item') {
        const marker = orderedListNumber !== null ? `${orderedListNumber}.` : LIST_ITEM_MARKER;
        const indent = '  '.repeat(listDepth);
        const content = token.tokens
          ? token.tokens
              .map((t) => formatToken(t, colorEnabled, listDepth, orderedListNumber, token))
              .join('')
          : token.text;
        return `${indent}${marker} ${content}${EOL}`;
      }
      return token.text;
    }

    case 'table': {
      return formatTable(token as Tokens.Table, colorEnabled);
    }

    case 'escape': {
      return token.text;
    }

    case 'def':
    case 'html':
    case 'del':
      return '';

    default:
      return '';
  }
}

/**
 * 格式化表格为对齐的 ASCII 表格
 */
function formatTable(token: Tokens.Table, colorEnabled: boolean): string {
  const ch = c(colorEnabled);

  // 获取每个单元格的显示文本（strip ANSI codes 后计算宽度）
  function getCellText(cellTokens: Tokens.TableCell['tokens'] | undefined): string {
    if (!cellTokens) return '';
    return cellTokens.map((t) => formatToken(t, colorEnabled, 0, null, null)).join('');
  }

  // 计算每列最大宽度
  const columnCount = token.header.length;
  const colWidths: number[] = [];

  for (let i = 0; i < columnCount; i++) {
    const headerCell = token.header[i];
    const headerText = headerCell ? getCellText(headerCell.tokens) : '';
    let maxW = stripAnsiLength(headerText);
    for (const row of token.rows) {
      const cell = row[i];
      if (cell?.tokens) {
        const cellText = getCellText(cell.tokens);
        maxW = Math.max(maxW, stripAnsiLength(cellText));
      }
    }
    colWidths.push(Math.max(maxW, 3));
  }

  let output = '';

  // Header
  output += '│ ';
  for (let i = 0; i < columnCount; i++) {
    const cell = token.header[i];
    const content = cell?.tokens
      ? cell.tokens.map((t) => formatToken(t, colorEnabled, 0, null, null)).join('')
      : '';
    const displayLen = stripAnsiLength(content);
    const cw = colWidths[i] ?? 3;
    const pad = cw - displayLen;
    const align = token.align?.[i];
    output +=
      align === 'right'
        ? ' '.repeat(pad) + ch.bold(content)
        : align === 'center'
          ? ' '.repeat(Math.floor(pad / 2)) + ch.bold(content) + ' '.repeat(Math.ceil(pad / 2))
          : ch.bold(content) + ' '.repeat(pad);
    output += ' │ ';
  }
  output = output.trimEnd() + EOL;

  // Separator
  output += '├';
  for (let i = 0; i < columnCount; i++) {
    const align = token.align?.[i];
    const left = align === 'center' || align === 'right' ? ':' : '─';
    const right = align === 'center' || align === 'left' ? ':' : '─';
    const cw = colWidths[i] ?? 3;
    output += `${ch.dim(`${left}${'─'.repeat(cw)}${right}`)}┼`;
  }
  output = `${output.slice(0, -1)}┤${EOL}`;

  // Rows
  for (const row of token.rows) {
    output += '│ ';
    for (let i = 0; i < columnCount; i++) {
      const cell = row[i];
      const content = cell?.tokens
        ? cell.tokens.map((t) => formatToken(t, colorEnabled, 0, null, null)).join('')
        : '';
      const displayLen = stripAnsiLength(content);
      const cw = colWidths[i] ?? 3;
      const pad = cw - displayLen;
      const align = token.align?.[i];
      output +=
        align === 'right'
          ? ' '.repeat(pad) + content
          : align === 'center'
            ? ' '.repeat(Math.floor(pad / 2)) + content + ' '.repeat(Math.ceil(pad / 2))
            : content + ' '.repeat(pad);
      output += ' │ ';
    }
    output = output.trimEnd() + EOL;
  }

  return output + EOL;
}

/**
 * 计算字符串的"可见"长度（去除 ANSI 转义序列）
 *
 * \x1B 是 ESC 控制字符的开始，后用 `[` + 数字 + `m` 组成 ANSI 转义。
 * 使用 Unicode 代码点构建正则以通过 lint 检查。
 */
function stripAnsiLength(str: string): number {
  // eslint-disable-next-line no-control-regex
  const ESC = String.fromCharCode(27);
  return str.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '').length;
}
