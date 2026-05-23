/**
 * colorize — chalk 色彩集成
 *
 * 统一处理 xterm.js truecolor boost、tmux clamp 和颜色格式化。
 * 参考 claude-code src/ink/colorize.ts
 */

import chalk from 'chalk';
import type { Color, TextStyles } from './styles';

/**
 * xterm.js (VS Code, Cursor, code-server) 自 2017 年起支持 truecolor，
 * 但 code-server/Coder 容器通常不设置 COLORTERM=truecolor。
 * chalk 的 supports-color 不识别 TERM_PROGRAM=vscode，降级到 level 2。
 * 在 level 2 下 chalk.rgb() 使用 6×6×6 立方体颜色，导致色彩失真。
 *
 * 仅在 level === 2 时提升（不是 < 3），以尊重 NO_COLOR/FORCE_COLOR=0。
 * 必须运行在 tmux clamp 之前。
 */
function boostChalkLevelForXtermJs(): boolean {
  if (process.env.TERM_PROGRAM === 'vscode' && chalk.level === 2) {
    chalk.level = 3;
    return true;
  }
  return false;
}

/**
 * tmux 正确解析 truecolor SGR，但客户端发射器仅在外部终端
 * 宣告 Tc/RGB 能力时才重新发射 truecolor。默认 tmux 配置不设置此选项。
 * 钳制到 level 2 使 chalk 发射 256 色，tmux 可透传。
 *
 * CLAUDE_CODE_TMUX_TRUECOLOR 环境变量可跳过钳制。
 */
function clampChalkLevelForTmux(): boolean {
  if (process.env.CLAUDE_CODE_TMUX_TRUECOLOR) return false;
  if (process.env.TMUX && chalk.level > 2) {
    chalk.level = 2;
    return true;
  }
  return false;
}

// 在模块加载时执行一次
export const CHALK_BOOSTED_FOR_XTERMJS = boostChalkLevelForXtermJs();
export const CHALK_CLAMPED_FOR_TMUX = clampChalkLevelForTmux();

export type ColorType = 'foreground' | 'background';

const RGB_REGEX = /^rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)$/;
const ANSI_REGEX = /^ansi256\(\s?(\d+)\s?\)$/;

/**
 * 使用 chalk 为字符串应用颜色。
 */
export function colorize(str: string, color: string | undefined, type: ColorType): string {
  if (!color) return str;

  if (color.startsWith('ansi:')) {
    const value = color.slice('ansi:'.length);
    switch (value) {
      case 'black':
        return type === 'foreground' ? chalk.black(str) : chalk.bgBlack(str);
      case 'red':
        return type === 'foreground' ? chalk.red(str) : chalk.bgRed(str);
      case 'green':
        return type === 'foreground' ? chalk.green(str) : chalk.bgGreen(str);
      case 'yellow':
        return type === 'foreground' ? chalk.yellow(str) : chalk.bgYellow(str);
      case 'blue':
        return type === 'foreground' ? chalk.blue(str) : chalk.bgBlue(str);
      case 'magenta':
        return type === 'foreground' ? chalk.magenta(str) : chalk.bgMagenta(str);
      case 'cyan':
        return type === 'foreground' ? chalk.cyan(str) : chalk.bgCyan(str);
      case 'white':
        return type === 'foreground' ? chalk.white(str) : chalk.bgWhite(str);
      case 'blackBright':
        return type === 'foreground' ? chalk.blackBright(str) : chalk.bgBlackBright(str);
      case 'redBright':
        return type === 'foreground' ? chalk.redBright(str) : chalk.bgRedBright(str);
      case 'greenBright':
        return type === 'foreground' ? chalk.greenBright(str) : chalk.bgGreenBright(str);
      case 'yellowBright':
        return type === 'foreground' ? chalk.yellowBright(str) : chalk.bgYellowBright(str);
      case 'blueBright':
        return type === 'foreground' ? chalk.blueBright(str) : chalk.bgBlueBright(str);
      case 'magentaBright':
        return type === 'foreground' ? chalk.magentaBright(str) : chalk.bgMagentaBright(str);
      case 'cyanBright':
        return type === 'foreground' ? chalk.cyanBright(str) : chalk.bgCyanBright(str);
      case 'whiteBright':
        return type === 'foreground' ? chalk.whiteBright(str) : chalk.bgWhiteBright(str);
    }
  }

  if (color.startsWith('#')) {
    return type === 'foreground' ? chalk.hex(color)(str) : chalk.bgHex(color)(str);
  }

  if (color.startsWith('ansi256')) {
    const matches = ANSI_REGEX.exec(color);
    if (!matches) return str;
    const value = Number(matches[1]);
    return type === 'foreground' ? chalk.ansi256(value)(str) : chalk.bgAnsi256(value)(str);
  }

  if (color.startsWith('rgb')) {
    const matches = RGB_REGEX.exec(color);
    if (!matches) return str;
    const first = Number(matches[1]);
    const second = Number(matches[2]);
    const third = Number(matches[3]);
    return type === 'foreground'
      ? chalk.rgb(first, second, third)(str)
      : chalk.bgRgb(first, second, third)(str);
  }

  return str;
}

/**
 * 使用 chalk 应用 TextStyles 到字符串。
 * 样式从内到外应用：文本修饰符 → 前景色 → 背景色。
 */
export function applyTextStyles(text: string, styles: TextStyles): string {
  let result = text;

  if (styles.inverse) result = chalk.inverse(result);
  if (styles.strikethrough) result = chalk.strikethrough(result);
  if (styles.underline) result = chalk.underline(result);
  if (styles.italic) result = chalk.italic(result);
  if (styles.bold) result = chalk.bold(result);
  if (styles.dim) result = chalk.dim(result);
  if (styles.color) result = colorize(result, styles.color, 'foreground');
  if (styles.backgroundColor) result = colorize(result, styles.backgroundColor, 'background');

  return result;
}

/**
 * 应用原始颜色值到字符串。
 */
export function applyColor(text: string, color: Color | undefined): string {
  if (!color) return text;
  return colorize(text, color, 'foreground');
}
