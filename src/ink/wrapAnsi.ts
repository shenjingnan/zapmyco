/**
 * wrapAnsi — ANSI 感知文本换行
 *
 * 优先使用 Bun.wrapAnsi（运行时检测），fallback 到 JS 实现。
 *
 * 参考 claude-code src/ink/wrapAnsi.ts
 */

import { stringWidth } from './stringWidth';

// ---------------------------------------------------------------------------
// Bun fast path
// ---------------------------------------------------------------------------

let bunWrapAnsi: ((s: string, cols: number, opts?: unknown) => string) | null = null;
try {
  const bun = (globalThis as Record<string, unknown>).Bun as
    | { wrapAnsi?: (s: string, cols: number, opts?: unknown) => string }
    | undefined;
  if (bun?.wrapAnsi) {
    bunWrapAnsi = bun.wrapAnsi.bind(bun);
  }
} catch {
  // 不在 Bun 环境中
}

// ---------------------------------------------------------------------------
// JS fallback
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC 是 ANSI 序列起始
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export interface WrapAnsiOptions {
  /** 硬换行（严格在 maxWidth 处截断，不尝试单词边界） */
  hard?: boolean;
  /** 单词换行（默认 true） */
  wordWrap?: boolean;
  /** 修剪行尾空格（默认 false） */
  trim?: boolean;
}

/**
 * ANSI 感知文本换行 — JS 实现。
 * 逐字遍历文本，在达到 maxWidth 时插入换行。
 */
function wrapAnsiJavaScript(input: string, columns: number, options: WrapAnsiOptions = {}): string {
  if (columns <= 0) return '';
  if (input.length === 0 || columns === Number.POSITIVE_INFINITY) return input;

  const { hard = false, wordWrap = true, trim = false } = options;
  const lines: string[] = [];
  let currentLine = '';
  let currentWidth = 0;
  let activeAnsi = ''; // 行尾的 ANSI 序列，用于续行恢复

  // 按段落（\n)）处理
  for (const paragraph of input.split('\n')) {
    currentLine = '';
    currentWidth = 0;
    activeAnsi = '';
    let i = 0;

    while (i < paragraph.length) {
      // 检查 ANSI 序列
      const rest = paragraph.slice(i);
      const ansiMatch = rest.match(ANSI_RE);
      if (ansiMatch && ansiMatch.index === 0) {
        const seq = ansiMatch[0];
        currentLine += seq;
        activeAnsi = seq; // 记录活跃 ANSI
        i += seq.length;
        continue;
      }

      const char = paragraph[i] as string;
      const cp = char.codePointAt(0) ?? 0;
      const charLen = cp > 0xffff ? 2 : 1;
      const charWidth = stringWidth(char);

      // 控制字符（不占宽度）
      if (cp < 32 || cp === 0x7f) {
        if (char !== '\t') {
          // 非 tab 控制字符直接追加
          currentLine += char;
          i += 1;
          continue;
        }
      }

      // 到达最大宽度
      if (currentWidth + charWidth > columns) {
        if (wordWrap && !hard && currentWidth > 0) {
          // 单词换行：尝试回退到上一个空格
          let lastSpace = -1;
          let searchPos = currentLine.length - 1;
          while (searchPos >= 0) {
            if (currentLine[searchPos] === ' ') {
              lastSpace = searchPos;
              break;
            }
            const cp1 = currentLine.codePointAt(searchPos);
            if (cp1 !== undefined && cp1 <= 0xffff) {
              searchPos -= 1;
            } else {
              searchPos -= 2;
            }
          }

          if (lastSpace >= 0) {
            // 在空格处换行
            const beforeSpace = currentLine.slice(0, lastSpace);
            lines.push(trim ? beforeSpace.trimEnd() : beforeSpace);
            currentLine = activeAnsi + currentLine.slice(lastSpace + 1);
            currentWidth = stringWidth(currentLine);
            continue;
          }
        }

        // 硬换行
        lines.push(trim ? currentLine.trimEnd() : currentLine);
        currentLine = activeAnsi;
        currentWidth = 0;
      }

      currentLine += char;
      currentWidth += charWidth;
      i += charLen;
    }

    lines.push(trim ? currentLine.trimEnd() : currentLine);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 主导出
// ---------------------------------------------------------------------------

/**
 * ANSI 感知换行。
 *
 * @param input   - 输入字符串（可含 ANSI 序列）
 * @param columns - 最大列宽
 * @param options - 换行选项
 * @returns 换行后的字符串
 */
export function wrapAnsi(input: string, columns: number, options: WrapAnsiOptions = {}): string {
  if (bunWrapAnsi) {
    return bunWrapAnsi(input, columns, options);
  }
  return wrapAnsiJavaScript(input, columns, options);
}
