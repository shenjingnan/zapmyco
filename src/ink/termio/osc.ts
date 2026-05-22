/**
 * OSC (Operating System Command) 序列生成器
 *
 * 用于超链接 (OSC 8)、剪贴板等操作。
 * 参考 claude-code src/ink/termio/osc.ts
 */

/** OSC 前缀: ESC ] */
export const OSC_PREFIX = '\x1b]';

/** OSC 字符串终止符 (ST): ESC \ */
export const OSC_ST = '\x1b\\';

/** BEL 替代终止符 */
export const BEL = '\x07';

// ---------------------------------------------------------------------------
// Hyperlink (OSC 8)
// ---------------------------------------------------------------------------

/** OSC 8 超链接结束序列 */
export const LINK_END = `${OSC_PREFIX}8;;${OSC_ST}`;

/**
 * 生成 OSC 8 超链接序列。
 *
 * @param uri  超链接 URI
 * @param text 显示文本
 * @returns 包含超链接的完整字符串
 */
export function link(uri: string, text: string): string {
  return `${OSC_PREFIX}8;;${uri}${OSC_ST}${text}${LINK_END}`;
}

/**
 * 仅生成 OSC 8 超链接开始序列（用于分段超链接）。
 *
 * @param uri 超链接 URI
 * @returns OSC 8 开始序列
 */
export function linkStart(uri: string): string {
  return `${OSC_PREFIX}8;;${uri}${OSC_ST}`;
}

// ---------------------------------------------------------------------------
// Clipboard (OSC 52)
// ---------------------------------------------------------------------------

/**
 * 生成 OSC 52 剪贴板写入序列。
 *
 * @param text 要写入剪贴板的文本（base64 编码前）
 * @returns OSC 52 序列
 */
export function clipboardWrite(text: string): string {
  const base64 = Buffer.from(text, 'utf-8').toString('base64');
  return `${OSC_PREFIX}52;c;${base64}${OSC_ST}`;
}
