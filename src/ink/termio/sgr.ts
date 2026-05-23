/**
 * SGR (Select Graphic Rendition) 解析器
 *
 * 将 SGR 参数字符串应用于 TextStyle。
 * 同时支持分号分隔（旧式）和冒号分隔（新式）语法。
 * 处理所有标准 SGR 代码（0-107），包括扩展颜色。
 *
 * 参考 claude-code src/ink/termio/sgr.ts
 */

import type { Color, NamedColor, TextStyle, UnderlineStyle } from './types.js';
import { defaultStyle } from './types.js';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const NAMED_COLORS: NamedColor[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
];

const UNDERLINE_STYLES: UnderlineStyle[] = [
  'none',
  'single',
  'double',
  'curly',
  'dotted',
  'dashed',
];

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

type Param = {
  value: number | null;
  subparams: number[];
  colon: boolean;
};

/**
 * 解析 SGR 参数字符串。
 * 处理分号和冒号两种分隔符。
 */
function parseParams(str: string): Param[] {
  const params: Param[] = [];
  const segments = str.split(';');

  for (const segment of segments) {
    if (segment.includes(':')) {
      const parts = segment.split(':');
      const first = parts[0] ?? '';
      const rest = parts.slice(1).map(Number);
      params.push({
        value: first === '' ? null : Number(first),
        subparams: rest,
        colon: true,
      });
    } else {
      params.push({
        value: segment === '' ? null : Number(segment),
        subparams: [],
        colon: false,
      });
    }
  }

  return params;
}

// ---------------------------------------------------------------------------
// 扩展颜色解析
// ---------------------------------------------------------------------------

function parseExtendedColor(params: Param[], idx: number): [Color | undefined, number] {
  const param = params[idx];
  if (!param) return [undefined, 1];

  const values = param.colon
    ? [param.value, ...param.subparams]
    : [param.value, ...params.slice(idx + 1).map((p) => p.value)];

  // 冒号格式: 38:5:N → 索引色, 38:2:R:G:B → RGB
  if (param.colon) {
    const sub0 = param.subparams[0];
    if (sub0 !== undefined) {
      if (sub0 === 5) {
        // 索引色: 38:5:N
        const index = param.subparams[1];
        if (index !== undefined) {
          return [{ type: 'indexed', index }, 1];
        }
      }
      if (sub0 === 2) {
        // RGB: 38:2:R:G:B
        const [r, g, b] = param.subparams.slice(1, 4);
        if (r !== undefined && g !== undefined && b !== undefined) {
          return [{ type: 'rgb', r, g, b }, 1];
        }
      }
    }
    return [undefined, 1];
  }

  // 分号格式: 38;5;N 或 38;2;R;G;B
  const first = values[0];
  if (first === null) return [undefined, 1];

  if (first === 5) {
    const indexVal = values[1];
    if (indexVal !== null && indexVal !== undefined) {
      return [{ type: 'indexed', index: indexVal }, 3];
    }
  }

  if (first === 2) {
    const [rVal, gVal, bVal] = values.slice(1, 4);
    if (
      rVal !== null &&
      rVal !== undefined &&
      gVal !== null &&
      gVal !== undefined &&
      bVal !== null &&
      bVal !== undefined
    ) {
      return [{ type: 'rgb', r: rVal, g: gVal, b: bVal }, 5];
    }
  }

  return [undefined, 1];
}

// ---------------------------------------------------------------------------
// applySGR
// ---------------------------------------------------------------------------

/**
 * 应用 SGR 参数到 TextStyle。
 * 返回修改后的新 TextStyle（不可变）。
 */
export function applySGR(paramStr: string, style: TextStyle): TextStyle {
  const params = parseParams(paramStr);
  const result: TextStyle = { ...style };

  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (!p) continue;
    const v = p.value;
    if (v === null) continue;

    switch (v) {
      case 0:
        return defaultStyle();
      case 1:
        result.bold = true;
        break;
      case 2:
        result.dim = true;
        break;
      case 3:
        result.italic = true;
        break;
      case 4: {
        // 下划线样式
        const sub0 = p.subparams[0];
        if (sub0 !== undefined && sub0 >= 0 && sub0 < UNDERLINE_STYLES.length) {
          result.underline = UNDERLINE_STYLES[sub0]!;
        } else {
          result.underline = 'single';
        }
        break;
      }
      case 5:
        result.blink = true;
        break;
      case 6:
        result.blink = true; // 快速闪烁 → blink
        break;
      case 7:
        result.reverse = true;
        break;
      case 8:
        result.hidden = true;
        break;
      case 9:
        result.strikethrough = true;
        break;
      case 10:
        // 默认字体（忽略）
        break;
      case 21:
        result.underline = 'double';
        break;
      case 22:
        result.bold = false;
        result.dim = false;
        break;
      case 23:
        result.italic = false;
        break;
      case 24:
        result.underline = 'none';
        break;
      case 25:
        result.blink = false;
        break;
      case 27:
        result.reverse = false;
        break;
      case 28:
        result.hidden = false;
        break;
      case 29:
        result.strikethrough = false;
        break;
      case 30:
      case 31:
      case 32:
      case 33:
      case 34:
      case 35:
      case 36:
      case 37:
        result.fg = { type: 'named', name: NAMED_COLORS[v - 30]! };
        break;
      case 38: {
        const [color, skip] = parseExtendedColor(params, i);
        if (color) {
          result.fg = color;
        }
        // 如果用了分号格式，需要跳过额外参数
        if (!p.colon && skip > 1) {
          i += skip - 1;
        }
        break;
      }
      case 39:
        result.fg = { type: 'default' };
        break;
      case 40:
      case 41:
      case 42:
      case 43:
      case 44:
      case 45:
      case 46:
      case 47:
        result.bg = { type: 'named', name: NAMED_COLORS[v - 40]! };
        break;
      case 48: {
        const [color, skip] = parseExtendedColor(params, i);
        if (color) {
          result.bg = color;
        }
        if (!p.colon && skip > 1) {
          i += skip - 1;
        }
        break;
      }
      case 49:
        result.bg = { type: 'default' };
        break;
      case 53:
        result.overline = true;
        break;
      case 55:
        result.overline = false;
        break;
      case 58: {
        const [color, skip] = parseExtendedColor(params, i);
        if (color) {
          result.underlineColor = color;
        }
        if (!p.colon && skip > 1) {
          i += skip - 1;
        }
        break;
      }
      case 59:
        result.underlineColor = { type: 'default' };
        break;
      case 90:
      case 91:
      case 92:
      case 93:
      case 94:
      case 95:
      case 96:
      case 97:
        result.fg = { type: 'named', name: NAMED_COLORS[v - 82]! };
        break;
      case 100:
      case 101:
      case 102:
      case 103:
      case 104:
      case 105:
      case 106:
      case 107:
        result.bg = { type: 'named', name: NAMED_COLORS[v - 92]! };
        break;
    }
  }

  return result;
}
