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
    let maxW = ansiCellWidth(headerText);
    for (const row of token.rows) {
      const cell = row[i];
      if (cell?.tokens) {
        const cellText = getCellText(cell.tokens);
        maxW = Math.max(maxW, ansiCellWidth(cellText));
      }
    }
    colWidths.push(Math.max(maxW, 3));
  }

  let output = '';

  // Top border
  output += '┌';
  for (let i = 0; i < columnCount; i++) {
    const cw = colWidths[i] ?? 3;
    output += `${'─'.repeat(cw + 2)}┬`;
  }
  output = `${output.slice(0, -1)}┐${EOL}`;

  // Header
  output += '│ ';
  for (let i = 0; i < columnCount; i++) {
    const cell = token.header[i];
    const content = cell?.tokens
      ? cell.tokens.map((t) => formatToken(t, colorEnabled, 0, null, null)).join('')
      : '';
    const displayLen = ansiCellWidth(content);
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
    output += `${left}${'─'.repeat(cw)}${right}┼`;
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
      const displayLen = ansiCellWidth(content);
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

  // Bottom border
  output += '└';
  for (let i = 0; i < columnCount; i++) {
    const cw = colWidths[i] ?? 3;
    output += `${'─'.repeat(cw + 2)}┴`;
  }
  output = `${output.slice(0, -1)}┘${EOL}`;

  return output + EOL;
}

/**
 * 计算字符串在终端中的可见宽度（考虑 CJK 和 emoji 占 2 列宽）
 *
 * ANSI 转义序列不计入宽度，中文字符/emoji 占 2 列，ASCII 占 1 列。
 */
function ansiCellWidth(str: string): number {
  // 先去除 ANSI 转义
  const ESC = String.fromCharCode(27);
  const plain = str.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
  let width = 0;
  for (const ch of plain) {
    const code = ch.codePointAt(0) ?? 0;
    if (isZeroWidthChar(code)) {
      continue; // 零宽字符不计入宽度
    }
    if (isWideChar(code)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 判断 Unicode 码点是否为零宽字符（不可见 / 组合用字符）
 *
 * 这些字符在终端中不占据任何列宽，无论是 CJK 字体还是等宽字体下。
 * 如果在宽度计算中按 1 或 2 计算，会导致表格列对齐错误。
 */
function isZeroWidthChar(code: number): boolean {
  return (
    // 零宽空格系列
    code === 0x200b || // ZERO WIDTH SPACE
    code === 0x200c || // ZERO WIDTH NON-JOINER
    code === 0x200d || // ZERO WIDTH JOINER
    code === 0x200e || // LEFT-TO-RIGHT MARK
    code === 0x200f || // RIGHT-TO-LEFT MARK
    code === 0x2060 || // WORD JOINER
    (code >= 0x2061 && code <= 0x2064) || // INVISIBLE OPERATORS
    // 变体选择符（用于切换 emoji/文字呈现形式，本身不占宽度）
    code === 0xfe0e || // VARIATION SELECTOR-15 (text presentation)
    code === 0xfe0f || // VARIATION SELECTOR-16 (emoji presentation)
    // 组合用附加符号
    (code >= 0x0300 && code <= 0x036f) || // Combining Diacritical Marks
    (code >= 0x1dc0 && code <= 0x1dff) || // Combining Diacritical Marks Supplement
    (code >= 0x20d0 && code <= 0x20ff) || // Combining Diacritical Marks for Symbols
    (code >= 0xfe20 && code <= 0xfe2f) // Combining Half Marks
  );
}

/** 判断 Unicode 码点是否为终端宽字符（CJK / 全角 / emoji） */
function isWideChar(code: number): boolean {
  return (
    // CJK 统一表意文字
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x2fff) || // CJK Radicals
    (code >= 0x3000 && code <= 0x33ff) || // CJK Symbols, Hiragana, Katakana, Bopomofo, Hangul
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility
    (code >= 0xfe10 && code <= 0xfe19) || // Vertical forms
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
    (code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms
    (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Signs
    // Emoji 关键范围
    (code >= 0x1f000 && code <= 0x1ffff) || // Emoticons / 扩展
    (code >= 0x20000 && code <= 0x2ffff) || // CJK Extension B/C/D/E/F
    (code >= 0x30000 && code <= 0x3ffff) || // CJK Extension G/H
    // 常用 emoji 单字符
    code === 0x00a9 ||
    code === 0x00ae || // © ®
    (code >= 0x2000 && code <= 0x206f) || // General Punctuation (en/em dash etc)
    (code >= 0x2100 && code <= 0x27bf) || // Letterlike Symbols, Arrows, Math, Misc
    (code >= 0x2b00 && code <= 0x2bff) || // Misc Symbols and Arrows
    (code >= 0x2900 && code <= 0x297f) || // Supplemental Arrows-B
    code === 0x3030 || // 〰
    code === 0x303d || // 〽
    code === 0x3297 || // ㊗
    code === 0x3298 || // ㊘
    code === 0x231a ||
    code === 0x231b || // ⌚ ⌛
    code === 0x23e9 ||
    code === 0x23ec || // ⏩ ⏬
    code === 0x23f0 ||
    code === 0x23f3 || // ⏰ ⏳
    code === 0x25fd ||
    code === 0x25fe || // ◽ ◾
    code === 0x2614 ||
    code === 0x2615 || // ☔ ☕
    code === 0x2648 ||
    code === 0x2653 || // ♈ ♓
    code === 0x267f || // ♿
    code === 0x2693 || // ⚓
    code === 0x26a1 || // ⚡
    code === 0x26aa ||
    code === 0x26ab || // ⚪ ⚫
    code === 0x26bd ||
    code === 0x26be || // ⚽ ⚾
    code === 0x26c4 ||
    code === 0x26c5 || // ⛄ ⛅
    code === 0x26ce || // ⛎
    code === 0x26d4 || // ⛔
    code === 0x26ea || // ⛪
    code === 0x26f2 ||
    code === 0x26f3 || // ⛲ ⛳
    code === 0x26f5 || // ⛵
    code === 0x26fa || // ⛺
    code === 0x26fd || // ⛽
    code === 0x2702 || // ✂
    code === 0x2705 || // ✅
    code === 0x2708 ||
    code === 0x2709 || // ✈ ✉
    code === 0x270a ||
    code === 0x270b || // ✊ ✋
    code === 0x270c ||
    code === 0x270d || // ✌ ✍
    code === 0x270f || // ✏
    code === 0x2712 || // ✒
    code === 0x2714 || // ✔
    code === 0x2716 || // ✖
    code === 0x271d || // ✝
    code === 0x2721 || // ✡
    code === 0x2728 || // ✨
    code === 0x2733 ||
    code === 0x2734 || // ✳ ✴
    code === 0x2744 || // ❄
    code === 0x2747 || // ❇
    code === 0x274c || // ❌
    code === 0x274e || // ❎
    code === 0x2753 ||
    code === 0x2754 ||
    code === 0x2755 || // ❓ ❔ ❕
    code === 0x2757 || // ❗
    code === 0x2763 ||
    code === 0x2764 || // ❣ ❤
    code === 0x2795 ||
    code === 0x2796 ||
    code === 0x2797 || // ➕ ➖ ➗
    code === 0x27a1 || // ➡
    code === 0x27b0 || // ➰
    code === 0x27bf || // ➿
    code === 0x2934 ||
    code === 0x2935 || // ⤴ ⤵
    code === 0x2b05 ||
    code === 0x2b06 ||
    code === 0x2b07 || // ⬅ ⬆ ⬇
    code === 0x2b1b ||
    code === 0x2b1c || // ⬛ ⬜
    code === 0x2b50 || // ⭐
    code === 0x2b55 || // ⭕
    code === 0x2bc3 ||
    code === 0x2bc4 // ⯃ ⯄
  );
}
