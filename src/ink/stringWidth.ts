/**
 * stringWidth — 字符串在终端中的显示宽度
 *
 * 双路径实现：
 *   1. Bun.stringWidth（运行时检测，Bun 环境优先）
 *   2. JavaScript 纯实现 fallback（Node.js）
 *
 * 参考 claude-code src/ink/stringWidth.ts
 */

import { eastAsianWidth } from 'get-east-asian-width';

// ---------------------------------------------------------------------------
// Bun fast path（运行时检测）
// ---------------------------------------------------------------------------

// 惰性检测 Bun.stringWidth 是否可用
let bunStringWidth: ((s: string) => number) | null = null;
try {
  const bun = (globalThis as Record<string, unknown>).Bun as
    | { stringWidth?: (s: string) => number }
    | undefined;
  if (bun?.stringWidth) {
    bunStringWidth = bun.stringWidth.bind(bun);
  }
} catch {
  // 不在 Bun 环境中，使用 JS fallback
}

// ---------------------------------------------------------------------------
// 零宽字符检测
// ---------------------------------------------------------------------------

// 仅包含常用零宽字符类（组合变音符、零宽连接符、变体选择器等）
// 使用 Character 类而非完整 Unicode 数据库
const VARIATION_SELECTOR_START = 0xfe00;
const VARIATION_SELECTOR_END = 0xfe0f;
const COMBINING_START = 0x0300;
const COMBINING_END = 0x036f;

/** 判断字符是否为零宽（组合标记、变体选择器、ZWJ 等） */
function isZeroWidth(char: string): boolean {
  const cp = char.codePointAt(0);
  if (cp === undefined) return false;

  // 零宽空格 / ZWNJ / ZWJ / BOM / 连接符 / 方向标记
  if (
    cp === 0x200b || // ZERO WIDTH SPACE
    cp === 0x200c || // ZWNJ
    cp === 0x200d || // ZWJ
    cp === 0xfeff || // BOM/ZWNBS
    cp === 0x00ad || // 软连字符
    cp === 0x2060 || // WORD JOINER
    cp === 0x202a || // LRE
    cp === 0x202b || // RLE
    cp === 0x202c || // PDF
    cp === 0x202d || // LRM
    cp === 0x202e || // RLM
    cp === 0x2066 || // LRI
    cp === 0x2067 || // RLI
    cp === 0x2068 || // FSI
    cp === 0x2069 // PDI
  ) {
    return true;
  }

  // 组合变音符
  if (cp >= COMBINING_START && cp <= COMBINING_END) return true;

  // 变体选择器
  if (cp >= VARIATION_SELECTOR_START && cp <= VARIATION_SELECTOR_END) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Emoji 宽度
// ---------------------------------------------------------------------------

/** 判断是否为 Emoji（基础 Emoji 或肤色修饰符序列） */
function isEmoji(cp: number): boolean {
  // 基础 Emoji 区块
  if (cp >= 0x1f300 && cp <= 0x1f9ff) return true;
  // 补充符号
  if (cp >= 0x1fa00 && cp <= 0x1fa6f) return true;
  if (cp >= 0x1fa70 && cp <= 0x1faff) return true;
  // 杂项符号
  if (cp >= 0x2600 && cp <= 0x27bf) return true;
  // Dingbats
  if (cp >= 0x2700 && cp <= 0x27bf) return true;
  // 交通地图符号
  if (cp >= 0x1f680 && cp <= 0x1f6ff) return true;
  return false;
}

/** 计算 Emoji 片段的显示宽度 */
function emojiSegmentWidth(segment: string): number {
  // 国旗序列（两个 regional indicator）→ 2
  if (segment.length >= 4) {
    const first = segment.codePointAt(0);
    const second = segment.codePointAt(2);
    if (
      first !== undefined &&
      second !== undefined &&
      first >= 0x1f1e6 &&
      first <= 0x1f1ff &&
      second >= 0x1f1e6 &&
      second <= 0x1f1ff
    ) {
      return 2;
    }
  }
  // 单个 Emoji → 2
  return 2;
}

// ---------------------------------------------------------------------------
// JS Fallback 实现
// ---------------------------------------------------------------------------

/** JS 实现的字符串宽度计算 */
function stringWidthJavaScript(input: string): number {
  if (input.length === 0) return 0;

  // ASCII fast path — 如果字符串仅含 ASCII 可打印字符
  let allAscii = true;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c > 0x7f || c === 0x1b) {
      // 非 ASCII 或 ESC
      allAscii = false;
      break;
    }
  }
  if (allAscii) {
    // 仅计算可打印字符（> 0x1f 且非 DEL）
    let count = 0;
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      if (c > 0x1f && c !== 0x7f) count++;
    }
    return count;
  }

  // 剥离 ANSI 转义序列
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC 是 ANSI 序列起始
  const stripped = input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  // Unicode 路径 — 使用 Intl.Segmenter 处理 grapheme clusters
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const segments = segmenter.segment(stripped);
    let width = 0;

    for (const { segment } of segments) {
      if (segment === '\n' || segment === '\r' || segment === '\t') {
        width += 1; // 控制字符计为 1
        continue;
      }

      const firstCP = segment.codePointAt(0);
      if (firstCP === undefined) continue;

      // 零宽字符
      if (isZeroWidth(segment)) continue;

      // Emoji 处理
      if (isEmoji(firstCP)) {
        width += emojiSegmentWidth(segment);
        continue;
      }

      // 常规字符 — 使用 eastAsianWidth
      width += eastAsianWidth(firstCP);
    }

    return width;
  } catch {
    // Intl.Segmenter 不可用时的 fallback（旧 Node.js）
    let width = 0;
    for (const char of stripped) {
      if (char === '\n' || char === '\r' || char === '\t') {
        width += 1;
        continue;
      }
      const cp = char.codePointAt(0);
      if (cp === undefined) continue;
      if (cp < 32 || cp === 0x7f) continue;
      if (isZeroWidth(char)) continue;
      width += eastAsianWidth(cp);
    }
    return width;
  }
}

// ---------------------------------------------------------------------------
// 主导出
// ---------------------------------------------------------------------------

/**
 * 计算字符串在终端中的显示宽度。
 *
 * - ANSI 转义序列不计入宽度
 * - CJK 全角字符计为 2
 * - Emoji 计为 2
 * - 零宽字符（组合变音符等）计为 0
 *
 * @param input - 输入字符串
 * @returns 显示宽度
 */
export function stringWidth(input: string): number {
  if (bunStringWidth) {
    return bunStringWidth(input);
  }
  return stringWidthJavaScript(input);
}
