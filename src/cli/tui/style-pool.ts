/**
 * StylePool — 样式 ID 池
 *
 * 将 ANSI 样式码数组驻留为整数 ID，预计算转换序列。
 * 用于 Screen 渲染管线中的样式管理，避免重复生成 ANSI 序列。
 *
 * 工作原理：
 * 1. 样式集通过 intern() 注册，获得唯一整数 ID
 * 2. transition(fromId, toId) 返回从旧样式切换到新样式的 ANSI 转义序列
 * 3. ID 0 保留为默认无样式（none）
 */

import { CSI } from './dec';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** ANSI 样式码，如 '36'（青色前景）、'1'（加粗） */
export type AnsiCode = string;

// ---------------------------------------------------------------------------
// ANSI 解析辅助
// ---------------------------------------------------------------------------

/** ANSI SGR 序列正则 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列
const SGR_RE = /\x1b\[([\d;]*)m/g;

/**
 * 从 chalk 输出的字符串中提取 ANSI 码。
 *
 * chalk('x') 返回类似 '\x1b[36mx\x1b[39m'。
 * 去掉 'x' 后解析两端的 ANSI 序列，提取 SGR 码值。
 *
 * @example
 * chalkToCodes(chalk.cyan)  // → ['36']
 * chalkToCodes(chalk.green.bold)  // → ['1', '32']
 */
export function chalkToCodes(chalkFn: (s: string) => string): AnsiCode[] {
  const marker = '\u200b'; // 零宽字符，不影响显示但确保字符存在
  const result = chalkFn(marker);

  const codes: AnsiCode[] = [];
  const matches = result.matchAll(SGR_RE);
  for (const match of matches) {
    const codeStr = match[1] ?? '';
    if (codeStr === '' || codeStr === '0') {
      // 重置码 → 不加入池（用 ID 0 表示）
      continue;
    }
    // 拆解复合码如 '1;32' → ['1', '32']
    const parts = codeStr.split(';');
    for (const part of parts) {
      if (!codes.includes(part)) {
        codes.push(part);
      }
    }
  }

  return codes;
}

/** ANSI SGR 前缀 */
const SGR_PREFIX = `${CSI}`;

/**
 * 将 AnsiCode 数组序列化为 ANSI 转义序列字符串。
 * ['36'] → '\x1b[36m'
 */
function codesToAnsi(codes: AnsiCode[]): string {
  if (codes.length === 0) return '';
  return `${SGR_PREFIX}${codes.join(';')}m`;
}

// ---------------------------------------------------------------------------
// StylePool 类
// ---------------------------------------------------------------------------

export class StylePool {
  /** 序列化键 → ID */
  private lookup = new Map<string, number>();

  /** ID → AnsiCode[] */
  private codes: AnsiCode[][] = [];

  /** 转换序列缓存: key = fromId * MAX_ID + toId → ANSI string */
  private transitionCache = new Map<number, string>();

  /** 最大 ID 数量（用于转换缓存键计算） */
  private static readonly MAX_ID = 0x10000;

  /** 默认无样式（ID = 0） */
  readonly none = 0;

  /** 选中背景色 ANSI 码 */
  #selectionColor: AnsiCode = '48;2;38;79;120';

  /** withSelectionBg 缓存: key = "sel-{baseStyleId}" → styleId */
  #selCache = new Map<string, number>();

  constructor() {
    // 预注册 none 样式（ID 0）
    this.codes.push([]);
    this.lookup.set('', 0);
  }

  /**
   * 驻留一组 ANSI 码，返回 ID。
   * 若已存在相同码组，返回已有 ID。
   */
  intern(codes: AnsiCode[]): number {
    // 空数组 → ID 0
    if (codes.length === 0) return 0;

    const key = codes.join(',');
    const existing = this.lookup.get(key);
    if (existing !== undefined) return existing;

    const id = this.codes.length;
    this.codes.push([...codes]);
    this.lookup.set(key, id);
    return id;
  }

  /**
   * 从 chalk 链式函数计算并驻留样式 ID。
   *
   * @example
   * pool.internChalk(chalk.cyan)        // → 1
   * pool.internChalk(chalk.green.bold)  // → 2
   */
  internChalk(chalkFn: (s: string) => string): number {
    return this.intern(chalkToCodes(chalkFn));
  }

  /**
   * 获取样式的 ANSI 码数组。
   */
  getCodes(id: number): readonly AnsiCode[] {
    return this.codes[id] ?? [];
  }

  /**
   * 获取从 fromId 切换到 toId 所需的 ANSI 转义序列。
   *
   * @returns ANSI 转义序列字符串（空串表示无需变化）
   */
  transition(fromId: number, toId: number): string {
    if (fromId === toId) return '';

    const cacheKey = fromId * StylePool.MAX_ID + toId;
    const cached = this.transitionCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let result: string;

    if (toId === 0) {
      // 切换到无样式 → SGR 重置
      result = `${CSI}0m`;
    } else if (fromId === 0) {
      // 从无样式切换 → 直接设置新样式
      result = codesToAnsi(this.codes[toId] ?? []);
    } else {
      // 从一个样式切换到另一个 → 先重置再设置新样式
      const toCodes = this.codes[toId];
      if (toCodes && toCodes.length > 0) {
        result = `${CSI}0m${codesToAnsi(toCodes)}`;
      } else {
        result = `${CSI}0m`;
      }
    }

    this.transitionCache.set(cacheKey, result);
    return result;
  }

  /** 清空所有缓存（应对长时间运行的内存管理） */
  clearCaches(): void {
    this.transitionCache.clear();
  }

  /**
   * 设置选中背景色。
   * 修改后的颜色将在下次 withSelectionBg 调用时生效。
   */
  setSelectionColor(r: number, g: number, b: number): void {
    this.#selectionColor = `48;2;${r};${g};${b}`;
    this.#selCache.clear();
  }

  /**
   * 为指定 styleId 生成带选中背景的新 styleId。
   *
   * 实现逻辑：
   * 1. 获取 base 样式的 ANSI 码数组
   * 2. 过滤掉所有背景色相关码（48 系、49）
   * 3. 追加选中背景色
   * 4. 驻留为新样式并返回 ID
   */
  withSelectionBg(baseStyleId: number): number {
    const key = `sel-${baseStyleId}`;
    const cached = this.#selCache.get(key);
    if (cached !== undefined) return cached;

    const baseCodes = this.getCodes(baseStyleId);
    // 过滤背景色: 去掉 48;5;N / 48;2;R;G;B / 49 (默认背景)
    const filtered = baseCodes.filter((code) => code !== '49' && !code.startsWith('48;'));
    filtered.push(this.#selectionColor);

    const id = this.intern(filtered);
    this.#selCache.set(key, id);
    return id;
  }

  /** 当前注册的样式数 */
  get size(): number {
    return this.codes.length;
  }
}
