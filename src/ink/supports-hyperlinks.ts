/**
 * supportsHyperlinks — 终端 OSC 8 超链接支持检测
 *
 * 基于 supports-hyperlinks 库扩展额外终端检测。
 */

import supportsHyperlinksLib from 'supports-hyperlinks';

const ADDITIONAL_HYPERLINK_TERMINALS = [
  'ghostty',
  'Hyper',
  'kitty',
  'alacritty',
  'iTerm.app',
  'iTerm2',
];

type EnvLike = Record<string, string | undefined>;

interface SupportsHyperlinksOptions {
  env?: EnvLike;
  stdoutSupported?: boolean;
}

/**
 * 检测当前终端是否支持 OSC 8 超链接。
 *
 * @param options - 可选覆盖（用于测试）
 */
export function supportsHyperlinks(options?: SupportsHyperlinksOptions): boolean {
  const stdoutSupported = options?.stdoutSupported ?? supportsHyperlinksLib.stdout;
  if (stdoutSupported) {
    return true;
  }

  const env = options?.env ?? process.env;

  const termProgram = env.TERM_PROGRAM;
  if (termProgram && ADDITIONAL_HYPERLINK_TERMINALS.includes(termProgram)) {
    return true;
  }

  const lcTerminal = env.LC_TERMINAL;
  if (lcTerminal && ADDITIONAL_HYPERLINK_TERMINALS.includes(lcTerminal)) {
    return true;
  }

  const term = env.TERM;
  if (term?.includes('kitty')) {
    return true;
  }

  return false;
}
