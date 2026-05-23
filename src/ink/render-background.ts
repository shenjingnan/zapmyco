/**
 * render-background — 背景渲染
 *
 * 在 Box 区域中填充背景色空格。
 * 使用 backgroundColor 样式属性生成 SGR 序列。
 *
 * 参考 claude-code src/ink/render-background.ts
 */

import type { Output } from './output';
import { getStyleId } from './style-cache';
import type { Color } from './styles';

/**
 * 在指区域渲染背景色。
 *
 * @param x      - 起始列
 * @param y      - 起始行
 * @param width  - 区域宽度
 * @param height - 区域高度
 * @param bgColor - 背景色
 * @param output  - Output 实例
 */
export function renderBackground(
  x: number,
  y: number,
  width: number,
  height: number,
  bgColor: Color | undefined,
  output: Output
): void {
  if (!bgColor || width <= 0 || height <= 0) return;

  // 构建背景色 ANSI 码
  const ansiCodes = colorToBackgroundAnsi(bgColor);
  if (ansiCodes.length === 0) return;

  const key = ansiCodes.join(',');
  const styleId = getStyleId(key, ansiCodes);

  // 逐行填充背景色空格
  const bgLine = ' '.repeat(width);
  for (let row = 0; row < height; row++) {
    output.write(x, y + row, bgLine, styleId);
  }
}

/** 将颜色值转换为 ANSI 背景色 SGR 码 */
function colorToBackgroundAnsi(color: string): string[] {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = Number.parseInt(hex.charAt(0) + hex.charAt(0), 16);
      const g = Number.parseInt(hex.charAt(1) + hex.charAt(1), 16);
      const b = Number.parseInt(hex.charAt(2) + hex.charAt(2), 16);
      return [`48;2;${r};${g};${b}`];
    }
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return [`48;2;${r};${g};${b}`];
    }
  }

  // 命名色映射
  const namedColor = color.toLowerCase();
  const colorMap: Record<string, string> = {
    black: '40',
    red: '41',
    green: '42',
    yellow: '43',
    blue: '44',
    magenta: '45',
    cyan: '46',
    white: '47',
    gray: '100',
    grey: '100',
    'bright-red': '101',
    'bright-green': '102',
    'bright-yellow': '103',
    'bright-blue': '104',
    'bright-magenta': '105',
    'bright-cyan': '106',
    'bright-white': '107',
  };

  const code = colorMap[namedColor];
  return code ? [code] : [];
}
