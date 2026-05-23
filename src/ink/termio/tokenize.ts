/**
 * 流式 ANSI 分词器
 *
 * 将终端输入流拆分为文本块和完整的转义序列。
 * 状态机跟踪当前解析状态，不完整的序列被缓冲。
 * 当更多数据到达时，缓冲的序列可以继续。
 *
 * 只在确定序列边界时发出 token，不解码序列含义
 * （含义解码是 Parser 的职责）。
 *
 * 参考 claude-code src/ink/termio/tokenize.ts
 */

import { C0, ESC_TYPE, isC0, isEscFinal } from './ansi.js';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type Token = { type: 'text'; value: string } | { type: 'sequence'; value: string };

type State = 'ground' | 'escape' | 'escapeIntermediate' | 'csi' | 'ss3' | 'osc' | 'dcs' | 'apc';

export type TokenizerOptions = {
  /** 是否启用 X10 鼠标事件检测（CSI M 后跟 3 字节载荷） */
  x10Mouse?: boolean;
};

export type Tokenizer = {
  feed(input: string): Token[];
  flush(): Token[];
  reset(): void;
  buffer(): string;
};

// ---------------------------------------------------------------------------
// createTokenizer
// ---------------------------------------------------------------------------

export function createTokenizer(options?: TokenizerOptions): Tokenizer {
  let state: State = 'ground';
  let incomplete = '';
  let x10MousePending = 0; // X10 mouse 待消费字节数

  function feed(input: string): Token[] {
    const tokens: Token[] = [];
    let textBuffer = '';

    function emitText() {
      if (textBuffer.length > 0) {
        tokens.push({ type: 'text', value: textBuffer });
        textBuffer = '';
      }
    }

    function emitSequence(seq: string) {
      emitText();
      tokens.push({ type: 'sequence', value: seq });
    }

    // 如果有不完整的序列，先处理它
    if (incomplete.length > 0) {
      const combined = incomplete + input;
      incomplete = '';

      // 只在 ground 状态下处理累积的文本
      if (state === 'ground') {
        // 重新处理合并后的数据
        const chars = [...combined];
        for (const ch of chars) {
          const code = ch.charCodeAt(0);

          if (state === 'ground') {
            if (code === C0.ESC) {
              emitText();
              state = 'escape';
              incomplete = ch;
            } else if (!isC0(code) || code === C0.HT || code === C0.LF || code === C0.CR) {
              textBuffer += ch;
            }
            // 其他 C0 控制符（NUL, BEL 等）在 text 中处理
          }
          // ... 继续解析状态机
        }
        // 如果没有处理完所有字符，回退到逐个处理
      }
    }

    const chars = [...input];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      const code = ch.charCodeAt(0);

      // X10 鼠标 pending 字节
      if (x10MousePending > 0) {
        incomplete += ch;
        x10MousePending--;
        if (x10MousePending === 0) {
          emitSequence(incomplete);
          incomplete = '';
        }
        continue;
      }

      switch (state) {
        case 'ground': {
          if (code === C0.ESC) {
            emitText();
            state = 'escape';
            incomplete = ch;
          } else if (code === C0.BEL && textBuffer.length > 0) {
            // BEL 中止文本块
            emitText();
            tokens.push({ type: 'text', value: '\x07' });
          } else if (!isC0(code) || code === C0.HT || code === C0.LF || code === C0.CR) {
            textBuffer += ch;
          }
          // 其他 C0（NUL, SOH 等）：静默忽略
          break;
        }

        case 'escape': {
          if (code === ESC_TYPE.CSI) {
            state = 'csi';
            incomplete += ch;
          } else if (code === ESC_TYPE.OSC) {
            state = 'osc';
            incomplete += ch;
          } else if (code === ESC_TYPE.DCS) {
            state = 'dcs';
            incomplete += ch;
          } else if (code === ESC_TYPE.APC) {
            state = 'apc';
            incomplete += ch;
          } else if (code === ESC_TYPE.PM) {
            state = 'apc'; // PM 同 APC
            incomplete += ch;
          } else if (code === ESC_TYPE.SOS) {
            state = 'dcs'; // SOS 同 DCS
            incomplete += ch;
          } else if (code === 0x4f) {
            // SS3 (ESC O)
            state = 'ss3';
            incomplete += ch;
          } else if (code >= 0x20 && code <= 0x2f) {
            // 中间字节
            state = 'escapeIntermediate';
            incomplete += ch;
          } else if (isEscFinal(code)) {
            // 2 字节 ESC 序列
            incomplete += ch;
            emitSequence(incomplete);
            incomplete = '';
            state = 'ground';
          } else {
            // 未识别的 ESC 后字节 — 作为文本
            incomplete += ch;
            emitSequence(incomplete);
            incomplete = '';
            state = 'ground';
          }
          break;
        }

        case 'escapeIntermediate': {
          incomplete += ch;
          if (isEscFinal(code)) {
            emitSequence(incomplete);
            incomplete = '';
            state = 'ground';
          } else if (code < 0x20 || code > 0x7e) {
            // 非法字节
            emitSequence(incomplete);
            incomplete = '';
            state = 'ground';
          }
          break;
        }

        case 'csi': {
          incomplete += ch;
          if (code >= 0x40 && code <= 0x7e) {
            // 终止字节
            // X10 mouse 特殊处理
            if (options?.x10Mouse && code === 0x4d && incomplete.length === 3) {
              // CSI M — 可能是 X10 mouse，需要 3 个额外字节
              x10MousePending = 3;
              continue;
            }
            emitSequence(incomplete);
            incomplete = '';
            state = 'ground';
          }
          // 参数/中间字节继续累积
          break;
        }

        case 'ss3': {
          incomplete += ch;
          if (code >= 0x40 && code <= 0x7e) {
            emitSequence(incomplete);
            incomplete = '';
            state = 'ground';
          } else {
            // SS3 只应跟一个终止字节
            emitSequence(incomplete);
            incomplete = '';
            state = 'ground';
          }
          break;
        }

        case 'osc':
        case 'dcs':
        case 'apc': {
          incomplete += ch;
          if (code === C0.BEL) {
            // BEL 终止
            emitSequence(incomplete);
            incomplete = '';
            state = 'ground';
          } else if (code === C0.ESC) {
            // 可能是 ST (ESC \) — 检查下一个字符
            // 但我们在循环中，所以先保存状态
            // 实际上 ST 是 ESC + \，两个字节
            if (chars.length > i + 1 && chars[i + 1] === '\\') {
              incomplete += '\\';
              i++; // 跳过一个字符
              emitSequence(incomplete);
              incomplete = '';
              state = 'ground';
            }
            // 否则先重置，处理新的 ESC
            else {
              incomplete += ch;
              emitSequence(incomplete);
              incomplete = '';
              state = 'ground';
            }
          }
          // 其他字符继续累积
          break;
        }
      }
    }

    // 刷新文本缓冲区
    emitText();

    return tokens;
  }

  function flush(): Token[] {
    const tokens: Token[] = [];
    if (incomplete.length > 0) {
      // 不完整序列作为文本或序列发出
      if (state === 'ground' || state === 'escape') {
        tokens.push({ type: 'text', value: incomplete });
      } else {
        tokens.push({ type: 'sequence', value: incomplete });
      }
      incomplete = '';
    }
    if (x10MousePending > 0) {
      if (incomplete.length > 0) {
        tokens.push({ type: 'text', value: incomplete });
        incomplete = '';
      }
      x10MousePending = 0;
    }
    state = 'ground';
    return tokens;
  }

  function reset(): void {
    state = 'ground';
    incomplete = '';
    x10MousePending = 0;
  }

  function buffer(): string {
    return incomplete;
  }

  return { feed, flush, reset, buffer };
}
