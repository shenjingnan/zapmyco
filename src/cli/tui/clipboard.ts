/**
 * 剪贴板管理 — OSC 52 剪贴板写入
 *
 * 通过终端支持的 OSC 52 转义序列将文本写入系统剪贴板。
 * 支持普通终端和 tmux 两种环境。
 *
 * @module cli/tui/clipboard
 */

/**
 * 生成 OSC 52 剪贴板写入序列。
 *
 * @param text - 要复制的纯文本
 * @returns OSC 52 序列字符串（调用方写入 stdout），text 为空时返回 null
 */
export function setClipboard(text: string): string | null {
  if (!text) return null;
  const base64 = Buffer.from(text, 'utf-8').toString('base64');
  let seq = `\x1b]52;c;${base64}\x07`; // OSC 52 + ST (BEL)
  // tmux DCS passthrough
  if (process.env.TMUX) {
    seq = `\x1bPtmux;\x1b${seq}\x1b\\`;
  }
  return seq;
}
