/**
 * parse-keypress — 键盘输入解析器
 *
 * 将原始终端输入（Buffer/string）转换为结构化键事件、鼠标事件和终端响应。
 * 使用 termio tokenizer 进行转义序列边界检测。
 *
 * 主入口: parseMultipleKeypresses(prevState, input) → [ParsedInput[], KeyParseState]
 *
 * 参考 claude-code src/ink/parse-keypress.ts
 */

import { PASTE_END, PASTE_START } from './termio/csi.js';
import { createTokenizer, type Tokenizer } from './termio/tokenize.js';

// ---------------------------------------------------------------------------
// 输出类型
// ---------------------------------------------------------------------------

/** 状态 */
export type KeyParseState = {
  mode: 'NORMAL' | 'IN_PASTE';
  incomplete: string;
  pasteBuffer: string;
  _tokenizer?: Tokenizer;
};

/** 初始化状态 */
export const INITIAL_STATE: KeyParseState = {
  mode: 'NORMAL',
  incomplete: '',
  pasteBuffer: '',
};

/** 键事件 */
export type ParsedKey = {
  kind: 'key';
  fn: boolean;
  name: string | undefined;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  option: boolean;
  super: boolean;
  sequence: string;
  raw: string;
  code?: number;
  isPasted: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mkKey(overrides: { sequence: string; raw: string } & Record<string, any>): ParsedKey {
  return {
    kind: 'key',
    fn: false,
    name: undefined,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    isPasted: false,
    ...overrides,
  };
}

/** 终端响应 */
export type ParsedResponse = {
  kind: 'response';
  sequence: string;
  response: TerminalResponse;
};

/** 鼠标事件 */
export type ParsedMouse = {
  kind: 'mouse';
  button: number;
  action: 'press' | 'release';
  col: number;
  row: number;
  sequence: string;
};

/** 解析后的输入（三种类型的并集） */
export type ParsedInput = ParsedKey | ParsedMouse | ParsedResponse;

// ---------------------------------------------------------------------------
// 终端响应类型
// ---------------------------------------------------------------------------

export type DecrpmResponse = {
  kind: 'decrpm';
  mode: number;
  status: number;
};

export type Da1Response = {
  kind: 'da1';
  params: number[];
};

export type Da2Response = {
  kind: 'da2';
  params: number[];
};

export type KittyKeyboardResponse = {
  kind: 'kittyKeyboard';
  flags: number;
};

export type CursorPosResponse = {
  kind: 'cursorPosition';
  row: number;
  col: number;
};

export type OscResponse = {
  kind: 'osc';
  code: number;
  data: string;
};

export type XtversionResponse = {
  kind: 'xtversion';
  name: string;
};

export type TerminalResponse =
  | DecrpmResponse
  | Da1Response
  | Da2Response
  | KittyKeyboardResponse
  | CursorPosResponse
  | OscResponse
  | XtversionResponse;

// ---------------------------------------------------------------------------
// DECRPM 状态
// ---------------------------------------------------------------------------

export const DECRPM_STATUS = {
  NOT_RECOGNIZED: 0,
  SET: 1,
  RESET: 2,
  PERMANENTLY_SET: 3,
  PERMANENTLY_RESET: 4,
} as const;

// ---------------------------------------------------------------------------
// 正则表达式
// NOTE: 使用 \u001b 代替 \x1b 避免 biome lint 的控制字符警告
// ---------------------------------------------------------------------------

const E = '\u001b';

/** CSI u — Kitty 键盘协议: ESC [ codepoint [; modifier] u */
const CSI_U_RE = new RegExp(`^${E}\\[(\\d+)(?:;(\\d+))?u$`);

/** modifyOtherKeys — xterm: ESC [ 27 ; modifier ; keycode ~ */
const MODIFY_OTHER_KEYS_RE = new RegExp(`^${E}\\[27;(\\d+);(\\d+)~$`);

/** 功能键 — 各种遗留 CSI 序列 */
const FN_KEY_RE = new RegExp(`^${E}(?:\\[|O|\\[\\[)([\\d;]*)([A-DEFGHIJKL-MP-Z~^])?$`);

/** DECRPM: ESC [ ? mode ; status $ y */
const DECRPM_RE = new RegExp(`^${E}\\[\\?(\\d+);(\\d+)\\$y$`);

/** DA1: ESC [ ? digits c */
const DA1_RE = new RegExp(`^${E}\\[\\?(\\d+(?:;\\d+)*)c$`);

/** DA2: ESC [ > digits c */
const DA2_RE = new RegExp(`^${E}\\[>(\\d+(?:;\\d+)*)c$`);

/** Kitty 键盘标志: ESC [ ? flags u */
const KITTY_FLAGS_RE = new RegExp(`^${E}\\[\\?(\\d+)u$`);

/** 光标位置 DSR: ESC [ row ; col R */
const CURSOR_POSITION_RE = new RegExp(`^${E}\\[(\\d+);(\\d+)R$`);

/** SGR 鼠标: ESC [ < btn ; col ; row M/m */
const SGR_MOUSE_RE = new RegExp(`^${E}\\[<(\\d+);(\\d+);(\\d+)([Mm])$`);

/** XTVERSION: ESC [ > 0 q 的响应 — ESC [ ? name ; version Q */
const XTVERSION_RE = new RegExp(`^${E}\\[\\?([\\d.]+);(.+)Q$`);

/** OSC 响应: ESC ] code ; data ST */
const OSC_RESPONSE_RE = new RegExp(`^${E}\\](d+);(.+)(?:\\u001b\\\\)$`);

// ---------------------------------------------------------------------------
// 键名映射表
// ---------------------------------------------------------------------------

const keyName: Record<string, string> = {
  // 箭头键
  '[A': 'up',
  '[B': 'down',
  '[C': 'right',
  '[D': 'left',

  // SS3 箭头（应用键盘模式）
  OA: 'up',
  OB: 'down',
  OC: 'right',
  OD: 'left',

  // 功能键
  '[11~': 'f1',
  '[12~': 'f2',
  '[13~': 'f3',
  '[14~': 'f4',
  '[15~': 'f5',
  '[17~': 'f6',
  '[18~': 'f7',
  '[19~': 'f8',
  '[20~': 'f9',
  '[21~': 'f10',
  '[23~': 'f11',
  '[24~': 'f12',

  // 功能键（旧式 SS3）
  OP: 'f1',
  OQ: 'f2',
  OR: 'f3',
  OS: 'f4',

  // 功能键（xterm）
  '[[A': 'f1',
  '[[B': 'f2',
  '[[C': 'f3',
  '[[D': 'f4',
  '[[E': 'f5',

  // 导航键
  '[H': 'home',
  '[F': 'end',
  OH: 'home', // SS3
  OF: 'end', // SS3
  '[5~': 'pageup',
  '[6~': 'pagedown',
  '[2~': 'insert',
  '[3~': 'delete',

  // SS3 导航
  O2H: 'home',
  O2F: 'end',
  'O5~': 'pageup', // Ctrl+SS3
  'O6~': 'pagedown',

  // 数字键盘（标准 + App 模式）
  Op: '0',
  Oq: '1',
  Or: '2',
  Os: '3',
  Ot: '4',
  Ou: '5',
  Ov: '6',
  Ow: '7',
  Ox: '8',
  Oy: '9',
  Oj: '*',
  Ok: '+',
  Om: '-',
  Ol: ',',
  On: '.',
  Oo: '/',
  OM: 'enter',

  // 额外序列
  '[Z': 'tab', // reverse tab
};

// ---------------------------------------------------------------------------
// 非字母数字键名
// ---------------------------------------------------------------------------

/** 长度 > 1 的键名（用于过滤不可打印字符） */
export const nonAlphanumericKeys = [
  'escape',
  'backspace',
  'wheelup',
  'wheeldown',
  'mouse',
  ...Object.values(keyName).filter((n) => n.length > 1),
];

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function decodeModifier(modifier: number): {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  super: boolean;
} {
  const m = modifier - 1;
  return {
    shift: (m & 1) !== 0,
    alt: (m & 2) !== 0,
    ctrl: (m & 4) !== 0,
    meta: (m & 2) !== 0, // alt = meta in terminal context
    super: (m & 8) !== 0,
  };
}

function keycodeToName(keycode: number): string | undefined {
  if (keycode >= 32 && keycode <= 126) {
    return String.fromCharCode(keycode);
  }
  switch (keycode) {
    case 9:
      return 'tab';
    case 13:
      return 'return';
    case 27:
      return 'escape';
    case 32:
      return 'space';
    case 127:
      return 'backspace';
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// parseTerminalResponse
// ---------------------------------------------------------------------------

function parseTerminalResponse(sequence: string): TerminalResponse | null {
  // CSI 响应
  if (sequence.startsWith('\x1b[')) {
    let match: RegExpMatchArray | null;

    // DECRPM
    match = sequence.match(DECRPM_RE);
    if (match) {
      return {
        kind: 'decrpm',
        mode: Number(match[1]),
        status: Number(match[2]),
      };
    }

    // DA1 (Primary DA)
    match = sequence.match(DA1_RE);
    if (match) {
      return {
        kind: 'da1',
        params: match[1]!.split(';').map(Number),
      };
    }

    // DA2 (Secondary DA)
    match = sequence.match(DA2_RE);
    if (match) {
      return {
        kind: 'da2',
        params: match[1]!.split(';').map(Number),
      };
    }

    // Kitty 键盘标志
    match = sequence.match(KITTY_FLAGS_RE);
    if (match) {
      return { kind: 'kittyKeyboard', flags: Number(match[1]) };
    }

    // 光标位置
    match = sequence.match(CURSOR_POSITION_RE);
    if (match) {
      return {
        kind: 'cursorPosition',
        row: Number(match[1]),
        col: Number(match[2]),
      };
    }

    // XTVERSION
    match = sequence.match(XTVERSION_RE);
    if (match) {
      return { kind: 'xtversion', name: match[2]! };
    }
  }

  // OSC 响应
  if (sequence.startsWith('\x1b]')) {
    const match = sequence.match(OSC_RESPONSE_RE);
    if (match) {
      return {
        kind: 'osc',
        code: Number(match[1]),
        data: match[2]!,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// parseMouseEvent
// ---------------------------------------------------------------------------

function parseMouseEvent(sequence: string): ParsedMouse | null {
  const match = sequence.match(SGR_MOUSE_RE);
  if (!match) return null;

  const button = Number(match[1]);
  const col = Number(match[2]) - 1; // 1-based → 0-based
  const row = Number(match[3]) - 1;
  const isRelease = match[4] === 'm';

  // 滚轮事件（位 6 置位）作为键事件处理
  if (button & 0x40) {
    return null;
  }

  return {
    kind: 'mouse',
    button: button & 0x03,
    action: isRelease ? 'release' : 'press',
    col,
    row,
    sequence,
  };
}

// ---------------------------------------------------------------------------
// parseKeypress
// ---------------------------------------------------------------------------

function parseKeypress(sequence: string): ParsedKey | null {
  // CSI u — Kitty 键盘协议
  const csiUMatch = sequence.match(CSI_U_RE);
  if (csiUMatch) {
    const codepoint = Number(csiUMatch[1]);
    const modifier = csiUMatch[2] ? Number(csiUMatch[2]) : 1;
    const mod = decodeModifier(modifier);
    const name = keycodeToName(codepoint);
    return mkKey({
      name: name && name.length > 1 ? name : undefined,
      ctrl: mod.ctrl,
      meta: mod.meta,
      shift: mod.shift,
      option: mod.alt,
      super: mod.super,
      sequence,
      raw: sequence,
    });
  }

  // modifyOtherKeys — xterm
  const modifyMatch = sequence.match(MODIFY_OTHER_KEYS_RE);
  if (modifyMatch) {
    const modifier = Number(modifyMatch[1]);
    const keycode = Number(modifyMatch[2]);
    const mod = decodeModifier(modifier);
    const name = keycodeToName(keycode);
    return mkKey({
      name: name && name.length > 1 ? name : undefined,
      ctrl: mod.ctrl,
      meta: mod.meta,
      shift: mod.shift,
      option: mod.alt,
      super: mod.super,
      sequence,
      raw: sequence,
    });
  }

  // 简单字面量匹配
  if (sequence === '\r' || sequence === '\n')
    return mkKey({ name: 'return', sequence, raw: sequence });
  if (sequence === '\t') return mkKey({ name: 'tab', sequence, raw: sequence });
  if (sequence === '\b' || sequence === '\x7f')
    return mkKey({ name: 'backspace', sequence, raw: sequence });
  if (sequence === '\x1b') return mkKey({ name: 'escape', sequence, raw: sequence });
  if (sequence === ' ') return mkKey({ name: 'space', sequence, raw: sequence });

  // Ctrl+letter (0x01–0x1a)
  if (sequence.length === 1) {
    const code = sequence.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      const letter = String.fromCharCode(96 + code); // 1→a, 2→b, ...
      return mkKey({ name: letter, ctrl: true, sequence, raw: sequence });
    }
  }

  // 普通可打印字符
  if (sequence.length === 1) {
    const code = sequence.charCodeAt(0);
    const isUpper = code >= 0x41 && code <= 0x5a;
    const isLower = code >= 0x61 && code <= 0x7a;
    return mkKey({
      name: isLower ? sequence : sequence.toLowerCase(),
      shift: isUpper,
      sequence,
      raw: sequence,
    });
  }

  // Meta 键 (ESC + char)
  if (sequence.startsWith('\x1b') && sequence.length === 2) {
    const char = sequence[1]!;
    return mkKey({
      name: char.toLowerCase(),
      meta: true,
      option: true,
      shift: char >= 'A' && char <= 'Z',
      sequence,
      raw: sequence,
    });
  }

  // 功能键匹配
  const fnMatch = sequence.match(FN_KEY_RE);
  if (fnMatch) {
    const suffix = sequence.startsWith('\x1b[') ? sequence.slice(2) : sequence.slice(1);

    // 从 keyName 查找
    const name = keyName[suffix];
    if (name) {
      return mkKey({ name, fn: name.startsWith('f'), sequence, raw: sequence });
    }
  }

  return mkKey({ sequence, raw: sequence });
}

// ---------------------------------------------------------------------------
// inputToString — 将 Buffer 安全转换为 string
// ---------------------------------------------------------------------------

function inputToString(input: Buffer | string): string {
  if (typeof input === 'string') return input;
  // 处理字节 > 127 作为 meta 前缀
  let result = '';
  for (const byte of input) {
    if (byte <= 127) {
      result += String.fromCharCode(byte);
    } else {
      // 高位字节：ESC + 字节 & 0x7f
      result += '\x1b' + String.fromCharCode(byte & 0x7f);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// createPasteKey
// ---------------------------------------------------------------------------

function createPasteKey(content: string): ParsedKey {
  return mkKey({ name: undefined, sequence: content, raw: content, isPasted: true });
}

// ---------------------------------------------------------------------------
// parseMultipleKeypresses — 主入口
// ---------------------------------------------------------------------------

/**
 * 将原始输入解析为 ParsedInput 数组。
 * 有状态解析器：接受前一个状态和新输入，返回解析结果和新状态。
 *
 * @param prevState 前一个状态
 * @param input 输入数据（Buffer | string | null）。null 表示 flush
 * @returns [ParsedInput[], KeyParseState]
 */
export function parseMultipleKeypresses(
  prevState: KeyParseState,
  input: Buffer | string | null
): [ParsedInput[], KeyParseState] {
  const results: ParsedInput[] = [];
  const state: KeyParseState = { ...prevState };

  // 将输入转换为字符串
  const strInput = input === null ? null : inputToString(input);

  // 获取或创建 tokenizer
  if (!state._tokenizer) {
    state._tokenizer = createTokenizer();
  }
  const tokenizer = state._tokenizer;

  // 处理 flush
  if (strInput === null) {
    const flushTokens = tokenizer.flush();
    if (state.mode === 'IN_PASTE' && state.pasteBuffer.length > 0) {
      results.push(createPasteKey(state.pasteBuffer));
      state.pasteBuffer = '';
    }
    state.mode = 'NORMAL';

    for (const token of flushTokens) {
      if (token.type === 'text') {
        results.push(createPasteKey(token.value));
      } else {
        // 尝试解析为键事件
        const key = parseKeypress(token.value);
        if (key) results.push(key);
      }
    }

    // 刷新不完整序列
    if (state.incomplete) {
      results.push(createPasteKey(state.incomplete));
      state.incomplete = '';
    }

    return [results, state];
  }

  // 处理新输入
  const tokens = tokenizer.feed(strInput);

  for (const token of tokens) {
    if (token.type === 'text') {
      // 检查是否有 orphaned mouse tail
      if (
        state.incomplete &&
        token.value.length >= 3 &&
        token.value.startsWith(';') &&
        /^\d+[Mm]$/.test(token.value.slice(1))
      ) {
        // 恢复转义序列前缀
        const reconstructed = state.incomplete + '\x1b[<' + token.value;
        state.incomplete = '';

        // 尝试解析为鼠标事件
        const mouse = parseMouseEvent(reconstructed);
        if (mouse) {
          results.push(mouse);
          continue;
        }
      }

      if (state.mode === 'IN_PASTE') {
        state.pasteBuffer += token.value;
      } else {
        // 文本按字符解析
        for (const ch of token.value) {
          if (state.incomplete) {
            // 之前有未完成的转义前缀
            const key = parseKeypress(state.incomplete + ch);
            state.incomplete = '';
            if (key) results.push(key);
          } else {
            const key = parseKeypress(ch);
            if (key) results.push(key);
          }
        }
      }
    } else {
      // 序列 token
      if (token.value === PASTE_START) {
        state.mode = 'IN_PASTE';
        state.pasteBuffer = '';
        continue;
      }

      if (token.value === PASTE_END) {
        state.mode = 'NORMAL';
        if (state.pasteBuffer.length > 0) {
          results.push(createPasteKey(state.pasteBuffer));
          state.pasteBuffer = '';
        }
        continue;
      }

      if (state.mode === 'IN_PASTE') {
        state.pasteBuffer += token.value;
        continue;
      }

      // 尝试终端响应
      const response = parseTerminalResponse(token.value);
      if (response) {
        results.push({ kind: 'response', sequence: token.value, response });
        continue;
      }

      // 尝试鼠标事件
      const mouse = parseMouseEvent(token.value);
      if (mouse) {
        results.push(mouse);
        continue;
      }

      // 处理孤立的 ESC 序列（在文本中后面跟了 & 等后缀）
      if (token.value === '\x1b') {
        state.incomplete = '\x1b';
        continue;
      }

      // 按键
      const key = parseKeypress(token.value);
      if (key) {
        results.push(key);
      }
    }
  }

  return [results, state];
}
