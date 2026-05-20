/**
 * 终端文本工具函数
 *
 * 自建 pi-tui 兼容的文本处理函数：
 * - visibleWidth: 计算字符串在终端中的可见宽度
 * - truncateToWidth: 按可见宽度截断字符串
 * - wrapTextWithAnsi: 按终端宽度换行，保留 ANSI 颜色
 */

import { eastAsianWidth } from 'get-east-asian-width';

/** ANSI 转义序列正则（匹配所有 CSI 序列） */
// biome-ignore lint/suspicious/noControlCharactersInRegex: \x1b (ESC) 是 ANSI 转义序列的起始标记
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** 零宽字符正则（组合变音符、零宽连接符、变体选择器等） */
const ZERO_WIDTH_RE_RAW =
  '[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u0901-\u0903\u093c\u093e-\u094d\u0951-\u0954\u0962\u0963\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a70\u0a71\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2\u0ae3\u0b01-\u0b03\u0b3c\u0b3e-\u0b43\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0c01-\u0c03\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c82\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0d02\u0d03\u0d3e-\u0d43\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d82\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0f18\u0f19\u0f35\u0f37\u0f39\u0f3e\u0f3f\u0f71-\u0f84\u0f86\u0f87\u0f90-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f\u109a-\u109d\u135f\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4-\u17d3\u17dd\u180b-\u180d\u18a9\u1920-\u192b\u1930-\u193b\u1a00-\u1a1b\u1dc0-\u1dca\u1dfe\u1dff\u200b-\u200f\u2028-\u202f\u2060-\u2063\u206a-\u206f\u20d0-\u20ef\u20f0\u20f1\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua66f-\ua672\ua67c\ua67d\ua802\ua806\ua80b\ua823-\ua827\ua880\ua881\ua8b4-\ua8c4\ua926-\ua92d\ua947-\ua953\uaa29-\uaa36\uaa43\uaa4c\uaa4d\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaaab\uaaac\uaaad\uaab5\uaab6\uaab9\uaaba\uaac1\uabe3-\uabea\ufb1e\ufe00-\ufe0f\ufe20-\ufe23\ufeff\ufff9-\ufffb]|\u200d|\u{1f3fb}-\u{1f3ff}';
// biome-ignore lint/suspicious/noMisleadingCharacterClass: 已知的 Unicode 零宽字符范围，包含组合字符是设计意图
const ZERO_WIDTH_RE = new RegExp(ZERO_WIDTH_RE_RAW, 'u');

/**
 * 计算字符串在终端中的可见宽度。
 *
 * - ANSI 转义序列不占宽度
 * - CJK 全角字符计为 2
 * - 零宽字符（组合变音符、变体选择器等）计为 0
 *
 * @param str - 输入字符串（可包含 ANSI 转义序列）
 * @returns 可见宽度
 */
export function visibleWidth(str: string): number {
  // 剥离 ANSI 转义序列
  const plain = str.replace(ANSI_RE, '');
  let width = 0;
  for (const char of plain) {
    // 跳过控制字符
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    if (cp < 32 || cp === 0x7f) continue;
    // 跳过零宽字符
    if (ZERO_WIDTH_RE.test(char)) continue;
    width += eastAsianWidth(cp);
  }
  return width;
}

/**
 * 按可见宽度截断字符串，保留 ANSI 颜色完整性。
 *
 * @param text - 输入文本（可包含 ANSI 转义序列）
 * @param maxWidth - 最大可见宽度
 * @param ellipsis - 省略号（默认 '...'）
 * @returns 截断后的字符串
 */
export function truncateToWidth(text: string, maxWidth: number, ellipsis: string = '...'): string {
  if (maxWidth <= 0) return '';
  if (maxWidth === Number.POSITIVE_INFINITY) return text;

  const textWidth = visibleWidth(text);
  if (textWidth <= maxWidth) return text;

  const ellipsisWidth = visibleWidth(ellipsis);
  const targetWidth = maxWidth - ellipsisWidth;

  if (targetWidth <= 0) return ellipsis;

  let result = '';
  let currentWidth = 0;
  let i = 0;

  while (i < text.length && currentWidth < targetWidth) {
    // 检查是否是 ANSI 序列 — 保留但不计宽度
    ANSI_RE.lastIndex = i;
    const ansiMatch = ANSI_RE.exec(text);
    if (ansiMatch && ansiMatch.index === i) {
      result += ansiMatch[0];
      i = ansiMatch.index + ansiMatch[0].length;
      continue;
    }

    // 获取当前字符的宽度
    const cp = text.codePointAt(i);
    if (cp === undefined) {
      i++;
      continue;
    }

    const charLen = cp > 0xffff ? 2 : 1;
    const char_ = cp > 0xffff ? String.fromCodePoint(cp) : text[i]!;

    // 跳过控制字符和零宽字符
    if (cp < 32 || cp === 0x7f || ZERO_WIDTH_RE.test(char_)) {
      result += char_;
      i += charLen;
      continue;
    }

    const charWidth = eastAsianWidth(cp);
    if (currentWidth + charWidth > targetWidth) break;

    result += char_;
    currentWidth += charWidth;
    i += charLen;
  }

  return result + ellipsis;
}

/**
 * 按终端宽度换行文本，识别并跳过 ANSI 转义序列。
 *
 * @param text - 输入文本（可包含 ANSI 转义序列）
 * @param width - 每行最大可见宽度
 * @returns 换行后的行数组
 */
export function wrapTextWithAnsi(text: string, width: number): string[] {
  if (width <= 0) return [];
  if (text.length === 0) return [''];

  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }

    let currentLine = '';
    let currentWidth = 0;
    // 当前活跃的 ANSI 序列（在新行开头恢复）
    let activeAnsi = '';
    let i = 0;

    while (i < paragraph.length) {
      // 检查 ANSI 序列
      ANSI_RE.lastIndex = i;
      const ansiMatch = ANSI_RE.exec(paragraph);
      if (ansiMatch && ansiMatch.index === i) {
        const seq = ansiMatch[0];
        currentLine += seq;
        activeAnsi = seq;
        i = ansiMatch.index + ansiMatch[0].length;
        continue;
      }

      // 获取当前字符
      const cp = paragraph.codePointAt(i);
      if (cp === undefined) {
        i++;
        continue;
      }

      const charLen = cp > 0xffff ? 2 : 1;
      const char_ = cp > 0xffff ? String.fromCodePoint(cp) : paragraph[i]!;

      // 控制字符 / 零宽字符不占宽度，直接追加
      if (cp < 32 || cp === 0x7f || ZERO_WIDTH_RE.test(char_)) {
        currentLine += char_;
        i += charLen;
        continue;
      }

      const charWidth = eastAsianWidth(cp);

      // 换行判断
      if (currentWidth + charWidth > width) {
        lines.push(currentLine);
        currentLine = activeAnsi; // 在新行开头恢复 ANSI 颜色
        currentWidth = 0;
      }

      currentLine += char_;
      currentWidth += charWidth;
      i += charLen;
    }

    // 刷新段落剩余内容
    lines.push(currentLine);
  }

  return lines;
}
