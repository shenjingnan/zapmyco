/**
 * ANSI C0 控制字符常量和工具函数
 *
 * 供 tokenizer 和 parser 使用。
 * 使用数字字节值便于底层字节级比较。
 */

/** C0 控制字符 — 7-bit 控制码 (0x00–0x1f + 0x7f) */
export const C0 = {
  NUL: 0x00,
  SOH: 0x01,
  STX: 0x02,
  ETX: 0x03,
  EOT: 0x04,
  ENQ: 0x05,
  ACK: 0x06,
  BEL: 0x07,
  BS: 0x08,
  HT: 0x09,
  LF: 0x0a,
  VT: 0x0b,
  FF: 0x0c,
  CR: 0x0d,
  SO: 0x0e,
  SI: 0x0f,
  DLE: 0x10,
  DC1: 0x11,
  DC2: 0x12,
  DC3: 0x13,
  DC4: 0x14,
  NAK: 0x15,
  SYN: 0x16,
  ETB: 0x17,
  CAN: 0x18,
  EM: 0x19,
  SUB: 0x1a,
  ESC: 0x1b,
  FS: 0x1c,
  GS: 0x1d,
  RS: 0x1e,
  US: 0x1f,
  DEL: 0x7f,
} as const;

/** 字符串常量 */
export const ESC = '\x1b';
export const BEL = '\x07';
export const SEP = ';';

/**
 * ESC 序列类型引入符（ESC 后的第二个字节）。
 * 这些值标识后续序列的类型。
 */
export const ESC_TYPE = {
  CSI: 0x5b, // '[' — Control Sequence Introducer
  OSC: 0x5d, // ']' — Operating System Command
  DCS: 0x50, // 'P' — Device Control String
  APC: 0x5f, // '_' — Application Program Command
  PM: 0x5e, // '^' — Privacy Message
  SOS: 0x58, // 'X' — Start of String
  ST: 0x5c, // '\' — String Terminator
} as const;

/** 检查字节是否为 C0 控制字符 */
export function isC0(byte: number): boolean {
  return byte < 0x20 || byte === 0x7f;
}

/** 检查字节是否为 ESC 序列终止字节 */
export function isEscFinal(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x7e;
}
