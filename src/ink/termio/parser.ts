/**
 * 流式 ANSI 语义解析器
 *
 * 维护内部 Tokenizer 和 TextStyle 状态。
 * feed() 接受输入字符串，返回语义 Action 数组。
 *
 * SGR 序列由 applySGR() 解析，更新内部 this.style，
 * 不发射为单独 action。
 *
 * 参考 claude-code src/ink/termio/parser.ts
 */

import { BEL, ESC } from './ansi.js';
import { parseEsc } from './esc.js';
import { applySGR } from './sgr.js';
import { createTokenizer, type Tokenizer } from './tokenize.js';
import type { Action, Grapheme } from './types.js';
import { defaultStyle, type TextStyle } from './types.js';

// ---------------------------------------------------------------------------
// 字素工具函数
// ---------------------------------------------------------------------------

/** 检查是否为 East Asian Wide 字符 */
function isEastAsianWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x4dbf) || // CJK Radicals 等
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
    (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
    (code >= 0xff01 && code <= 0xff60) || // 全角 ASCII
    (code >= 0xffe0 && code <= 0xffe6) || // 全角符号
    (code >= 0x1f300 && code <= 0x1f9ff) // 杂项符号和表情符号
  );
}

/** 检查是否为 Emoji */
function isEmoji(code: number): boolean {
  return (
    (code >= 0x2600 && code <= 0x27bf) || // 杂项符号
    (code >= 0x1f300 && code <= 0x1f9ff) || // 杂项符号和表情符号
    code >= 0x200d // ZWJ 序列起始
  );
}

/** 计算字素宽度 */
function graphemeWidth(grapheme: string): 1 | 2 {
  const code = grapheme.codePointAt(0) ?? 0;
  if (isEmoji(code) || isEastAsianWide(code)) {
    return 2;
  }
  return 1;
}

/** 分割字素簇 */
function* segmentGraphemes(str: string): Generator<Grapheme> {
  if (typeof Intl?.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const seg of segmenter.segment(str)) {
      const value = seg.segment;
      yield { value, width: graphemeWidth(value) };
    }
  } else {
    // 回退：按字符分割
    for (const ch of str) {
      yield { value: ch, width: graphemeWidth(ch) };
    }
  }
}

// ---------------------------------------------------------------------------
// CSI 参数解析
// ---------------------------------------------------------------------------

/** 解析 CSI 参数字符串 */
function parseCSIParams(paramStr: string): number[] {
  if (!paramStr || paramStr.length === 0) return [0];
  return paramStr.split(/[;:]/).map((s) => {
    const n = Number(s);
    return Number.isNaN(n) ? 0 : n;
  });
}

// ---------------------------------------------------------------------------
// 序列识别
// ---------------------------------------------------------------------------

function identifySequence(seq: string): 'csi' | 'osc' | 'esc' | 'ss3' | 'unknown' {
  if (!seq.startsWith(ESC)) return 'unknown';
  const second = seq[1];
  if (second === '[') return 'csi';
  if (second === ']') return 'osc';
  if (second === 'O') return 'ss3';
  if (second === '(' || second === ')') {
    // 字符集选择 — 2-3 字节
    return 'esc';
  }
  // 2 字节 ESC 序列
  return 'esc';
}

// ---------------------------------------------------------------------------
// CSI 解析
// ---------------------------------------------------------------------------

function parseCSI(rawSequence: string): Action | null {
  // 提取 CSI 后的内容（去掉 ESC[）
  const content = rawSequence.slice(2);

  // 提取参数和终止字节
  const finalMatch = content.match(/^(.*?)([@-~])$/);
  if (!finalMatch) {
    return { type: 'unknown', sequence: rawSequence };
  }

  const paramStr = finalMatch[1] ?? '';
  const finalByte = finalMatch[2]!.charCodeAt(0);
  const params = parseCSIParams(paramStr);
  const p1 = params[0] ?? 0;

  switch (finalByte) {
    // ---- 光标移动 ----
    case 0x41: // CUU
      return { type: 'cursor', action: { type: 'move', direction: 'up', n: p1 || 1 } };
    case 0x42: // CUD
      return { type: 'cursor', action: { type: 'move', direction: 'down', n: p1 || 1 } };
    case 0x43: // CUF
      return { type: 'cursor', action: { type: 'move', direction: 'forward', n: p1 || 1 } };
    case 0x44: // CUB
      return { type: 'cursor', action: { type: 'move', direction: 'back', n: p1 || 1 } };
    case 0x45: // CNL
      return { type: 'cursor', action: { type: 'nextLine', n: p1 || 1 } };
    case 0x46: // CPL
      return { type: 'cursor', action: { type: 'prevLine', n: p1 || 1 } };
    case 0x47: // CHA
      return { type: 'cursor', action: { type: 'column', col: p1 || 1 } };
    case 0x48: // CUP
      return {
        type: 'cursor',
        action: { type: 'position', row: params[0] ?? 1, col: params[1] ?? 1 },
      };
    case 0x66: // HVP (same as CUP)
      return {
        type: 'cursor',
        action: { type: 'position', row: params[0] ?? 1, col: params[1] ?? 1 },
      };

    // ---- 擦除 ----
    case 0x4a: // ED
      return { type: 'erase', action: { type: 'display', n: p1 || 0 } };
    case 0x4b: // EL
      return { type: 'erase', action: { type: 'line', n: p1 || 0 } };
    case 0x58: // ECH
      return { type: 'erase', action: { type: 'chars', n: p1 || 1 } };

    // ---- 滚动 ----
    case 0x53: // SU
      return { type: 'scroll', action: { type: 'up', n: p1 || 1 } };
    case 0x54: // SD
      return { type: 'scroll', action: { type: 'down', n: p1 || 1 } };
    case 0x72: // DECSTBM
      return {
        type: 'scroll',
        action: { type: 'setRegion', top: params[0] ?? 1, bottom: params[1] ?? 0 },
      };

    // ---- 光标保存/恢复 ----
    case 0x73: // SCOSC
      return { type: 'cursor', action: { type: 'save' } };
    case 0x75: // SCORC
      return { type: 'cursor', action: { type: 'restore' } };

    // ---- 光标样式 ----
    case 0x71: // DECSCUSR
      return { type: 'cursor', action: { type: 'style', n: p1 || 0 } };

    // ---- 模式设置 ----
    case 0x68: {
      // SM / DECSET
      if (paramStr.startsWith('?')) {
        const mode = params[0] ?? 0;
        switch (mode) {
          case 1047:
          case 1049:
            return { type: 'mode', action: { type: 'alternateScreen', enable: true } };
          case 2004:
            return { type: 'mode', action: { type: 'bracketedPaste', enable: true } };
          case 1000:
          case 1002:
          case 1003:
            return { type: 'mode', action: { type: 'mouseTracking', enable: true, mode } };
          case 1004:
            return { type: 'mode', action: { type: 'focusEvents', enable: true } };
        }
      }
      return null;
    }
    case 0x6c: {
      // RM / DECRST
      if (paramStr.startsWith('?')) {
        const mode = params[0] ?? 0;
        switch (mode) {
          case 1047:
          case 1049:
            return { type: 'mode', action: { type: 'alternateScreen', enable: false } };
          case 2004:
            return { type: 'mode', action: { type: 'bracketedPaste', enable: false } };
          case 1000:
          case 1002:
          case 1003:
            return { type: 'mode', action: { type: 'mouseTracking', enable: false, mode } };
          case 1004:
            return { type: 'mode', action: { type: 'focusEvents', enable: false } };
        }
      }
      return null;
    }

    // ---- SGR ----
    case 0x6d: // SGR
      return { type: 'sgr', params: paramStr || '0' };

    default:
      return { type: 'unknown', sequence: rawSequence };
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export class Parser {
  tokenizer: Tokenizer;
  style: TextStyle;
  inLink = false;
  linkUrl: string | undefined;

  constructor() {
    this.tokenizer = createTokenizer();
    this.style = defaultStyle();
  }

  /** 重置解析器状态 */
  reset(): void {
    this.tokenizer.reset();
    this.style = defaultStyle();
    this.inLink = false;
    this.linkUrl = undefined;
  }

  /** 解析输入，产生语义动作 */
  feed(input: string): Action[] {
    const tokens = this.tokenizer.feed(input);
    const actions: Action[] = [];

    for (const token of tokens) {
      if (token.type === 'text') {
        actions.push(...this.processText(token.value));
      } else {
        const action = this.processSequence(token.value);
        if (action) {
          actions.push(action);
        }
      }
    }

    return actions;
  }

  /** 处理文本块：分割字素，应用当前样式 */
  private processText(text: string): Action[] {
    const actions: Action[] = [];

    // 处理嵌入的 BEL
    const parts = text.split(BEL);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]!.length > 0) {
        const graphemes: Grapheme[] = [];
        for (const g of segmentGraphemes(parts[i]!)) {
          graphemes.push(g);
        }
        if (graphemes.length > 0) {
          actions.push({ type: 'text', graphemes, style: { ...this.style } });
        }
      }
      if (i < parts.length - 1) {
        actions.push({ type: 'bell' });
      }
    }

    return actions;
  }

  /** 处理转义序列 */
  private processSequence(seq: string): Action | null {
    const type = identifySequence(seq);

    switch (type) {
      case 'csi': {
        const action = parseCSI(seq);
        // SGR 特殊处理：更新内部样式，不发射
        if (action && action.type === 'sgr') {
          this.style = applySGR(action.params, this.style);
          return null;
        }
        return action;
      }

      case 'osc': {
        // OSC 解析 — 从简（完整解析在后续 PR 中扩展）
        const content = seq.slice(2, -1); // 去掉 ESC] 和 ST/BEL
        if (content.startsWith('8;')) {
          // OSC 8 — 超链接
          const rest = content.slice(2);
          const semiIdx = rest.indexOf(';');
          if (semiIdx >= 0) {
            const params = rest.slice(0, semiIdx);
            const url = rest.slice(semiIdx + 1);
            if (url) {
              this.inLink = true;
              this.linkUrl = url;
              return { type: 'link', action: { type: 'start', url, params } };
            }
            // url 为空表示链接结束
            this.inLink = false;
            this.linkUrl = undefined;
            return { type: 'link', action: { type: 'end' } };
          }
        }
        return { type: 'unknown', sequence: seq };
      }

      case 'esc': {
        const chars = seq.slice(1); // 去掉 ESC
        return parseEsc(chars);
      }

      case 'ss3':
        return { type: 'unknown', sequence: seq };

      default:
        return { type: 'unknown', sequence: seq };
    }
  }
}
