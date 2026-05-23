/**
 * style-cache — 轻量级样式 ID 管理
 *
 * 将 ANSI SGR 码数组映射为数字 styleId，用于 Cell 级存储。
 * 支持按代清理（generational GC），避免长时间运行时无限增长。
 *
 * PR6 从 render-node-to-output.ts 提取为独立模块。
 * PR10 增强：新增 withInverse、withSelectionBg、withCurrentMatch。
 */

// ---------------------------------------------------------------------------
// 内部状态
// ---------------------------------------------------------------------------

let nextStyleId = 1; // 0 = 默认无样式
const styleIdCache = new Map<string, number>();
const styleCodesCache: string[][] = [];

// ---------------------------------------------------------------------------
// SGR 码判定辅助
// ---------------------------------------------------------------------------

/** SGR 参数：反转 (inverse) */
const SGR_INVERSE = '7';
/** SGR 参数：加粗 */
const SGR_BOLD = '1';
/** SGR 参数：下划线 */
const SGR_UNDERLINE = '4';
/** SGR 参数：黄色前景 (yellow fg) */
const SGR_YELLOW_FG = '33';
/** SGR 参数：默认背景 (default bg) */
const SGR_DEFAULT_BG = '49';
/** SGR 参数：默认前景 (default fg) */
const SGR_DEFAULT_FG = '39';

/**
 * 判断 SGR 参数是否为前景色码。
 * 30-37 标准色，38 扩展色，90-97 亮色。
 */
function isFgCode(code: string): boolean {
  if (code === SGR_DEFAULT_FG) return true;
  if (code === '38') return true; // 扩展前景（后面跟随 ;5;N 或 ;2;R;G;B）
  const n = Number.parseInt(code, 10);
  return (n >= 30 && n <= 37) || (n >= 90 && n <= 97);
}

/**
 * 判断 SGR 参数是否为背景色码。
 * 40-47 标准色，48 扩展色，100-107 亮色。
 */
function isBgCode(code: string): boolean {
  if (code === SGR_DEFAULT_BG) return true;
  if (code === '48') return true; // 扩展背景（后面跟随 ;5;N 或 ;2;R;G;B）
  const n = Number.parseInt(code, 10);
  return (n >= 40 && n <= 47) || (n >= 100 && n <= 107);
}

/**
 * 判断 SGR 参数是否为反转码。
 */
function isInverseCode(code: string): boolean {
  return code === SGR_INVERSE;
}

// ---------------------------------------------------------------------------
// 扩展样式缓存
// ---------------------------------------------------------------------------

/** withInverse 缓存: baseId → newId */
const inverseCache = new Map<number, number>();

/** 选中背景色 SGR 参数（如 '48;2;38;79;120'），null = 用 inverse 回退 */
let selectionBgCode: string | null = null;

/** withSelectionBg 缓存: baseId → newId */
const selectionBgCache = new Map<number, number>();

/** withCurrentMatch 缓存: baseId → newId */
const currentMatchCache = new Map<number, number>();

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/**
 * 驻留一组 ANSI SGR 码，返回 ID。
 * 若已存在相同的码组，返回已有 ID。
 */
function internCodes(codes: string[]): number {
  if (codes.length === 0) return 0;
  const key = codes.join(',');
  const existing = styleIdCache.get(key);
  if (existing !== undefined) return existing;
  const id = nextStyleId++;
  styleIdCache.set(key, id);
  styleCodesCache[id] = codes;
  return id;
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 从 ANSI 码数组获取或创建 styleId。
 * @param key  缓存的键（ANSI 码 join 后的字符串）
 * @param codes ANSI SGR 码数组（不含 \x1b[ 和 m）
 * @returns styleId（0 = 默认样式）
 */
export function getStyleId(key: string, codes: string[]): number {
  if (key === '' || codes.length === 0) return 0;
  return internCodes(codes);
}

/**
 * 从 styleId 获取 ANSI 码数组。
 * @param id styleId
 * @returns ANSI SGR 码数组（只读）
 */
export function getStyleCodes(id: number): readonly string[] {
  return styleCodesCache[id] ?? [];
}

/**
 * 获取从 fromId 切换到 toId 的 ANSI 序列。
 * @param fromId 当前样式 ID
 * @param toId   目标样式 ID
 * @returns ANSI 转义序列
 */
export function transitionStyle(fromId: number, toId: number): string {
  if (fromId === toId) return '';
  if (toId === 0) return '\x1b[0m';
  if (fromId === 0) {
    const codes = styleCodesCache[toId];
    if (!codes || codes.length === 0) return '';
    return `\x1b[${codes.join(';')}m`;
  }
  const toCodes = styleCodesCache[toId];
  if (!toCodes || toCodes.length === 0) return '\x1b[0m';
  return `\x1b[0m\x1b[${toCodes.join(';')}m`;
}

/**
 * 清空所有样式缓存。
 * 下次 getStyleId 将重新注册。
 */
export function clearStyleCaches(): void {
  styleIdCache.clear();
  styleCodesCache.length = 0;
  nextStyleId = 1;
  inverseCache.clear();
  selectionBgCache.clear();
  currentMatchCache.clear();
}

/**
 * 当前缓存的样式数量（用于调试和监控）。
 */
export function getCachedStyleCount(): number {
  return styleIdCache.size;
}

// ---------------------------------------------------------------------------
// 扩展样式 API（PR10 新增）
// ---------------------------------------------------------------------------

/**
 * 为指定 styleId 生成带反转（SGR 7）的新 styleId。
 * 用于搜索高亮，使匹配文本以反转色显示。
 *
 * @param baseId - 基础样式 ID
 * @returns 带反转的新样式 ID
 */
export function withInverse(baseId: number): number {
  let id = inverseCache.get(baseId);
  if (id === undefined) {
    const baseCodes = [...getStyleCodes(baseId)];
    // 如果已有反转，复用（避免 SGR 7 叠加）
    const hasInverse = baseCodes.some(isInverseCode);
    if (hasInverse) {
      id = baseId;
    } else {
      baseCodes.push(SGR_INVERSE);
      id = internCodes(baseCodes);
    }
    inverseCache.set(baseId, id);
  }
  return id;
}

/**
 * 设置选中背景色。
 * 修改后的颜色将在下次 withSelectionBg 调用时生效。
 *
 * @param color - SGR 背景色参数（如 '48;2;100;100;200'），null = 回退到 withInverse
 */
export function setSelectionColor(color: string | null): void {
  selectionBgCode = color;
  selectionBgCache.clear();
}

/**
 * 为指定 styleId 生成带选中背景的新 styleId。
 * 替换背景色为选中色，保留前景色和其他样式。
 * 未设置选中色时回退到 withInverse。
 *
 * @param baseId - 基础样式 ID
 * @returns 选中高亮样式 ID
 */
export function withSelectionBg(baseId: number): number {
  const bg = selectionBgCode;
  if (bg === null) return withInverse(baseId);

  let id = selectionBgCache.get(baseId);
  if (id === undefined) {
    const baseCodes = [...getStyleCodes(baseId)];
    // 过滤背景色和反转（保留前景、加粗、斜体等）
    const filtered = baseCodes.filter((code) => !isBgCode(code) && !isInverseCode(code));
    filtered.push(bg);
    id = internCodes(filtered);
    selectionBgCache.set(baseId, id);
  }
  return id;
}

/**
 * 为指定 styleId 生成"当前匹配"高亮样式。
 * 反转 + 加粗 + 黄色背景（通过前景+反转交换实现）+ 下划线。
 * 用于搜索功能中标记当前选中的匹配项。
 *
 * @param baseId - 基础样式 ID
 * @returns 当前匹配高亮样式 ID
 */
export function withCurrentMatch(baseId: number): number {
  let id = currentMatchCache.get(baseId);
  if (id === undefined) {
    const baseCodes = [...getStyleCodes(baseId)];
    // 过滤前景和背景色（使黄色反转后无歧义）
    const codes = baseCodes.filter((code) => !isFgCode(code) && !isBgCode(code));
    // 黄色前景（反转后变为黄色背景）
    codes.push(SGR_YELLOW_FG);
    // 反转
    if (!codes.some(isInverseCode)) codes.push(SGR_INVERSE);
    // 加粗
    if (!codes.some((c) => c === SGR_BOLD)) codes.push(SGR_BOLD);
    // 下划线（作为无歧义标记）
    if (!codes.some((c) => c === SGR_UNDERLINE)) codes.push(SGR_UNDERLINE);
    id = internCodes(codes);
    currentMatchCache.set(baseId, id);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Generational GC
// ---------------------------------------------------------------------------

let generation = 0;
const MAX_GENERATION = 300; // ~5 分钟（60fps 下每帧递增，约 300 帧 = 5 秒 × 60 = 5分钟）

/**
 * 递增代际计数器，到达阈值时触发 GC。
 * 应在每次帧渲染完成后调用。
 *
 * @returns true 如果本次发生了 GC
 */
export function bumpGeneration(): boolean {
  generation++;
  if (generation >= MAX_GENERATION) {
    generation = 0;
    clearStyleCaches();
    return true;
  }
  return false;
}

/**
 * 重置代际计数器（用于测试）。
 */
export function resetGeneration(): void {
  generation = 0;
}

/**
 * 获取当前代际计数（用于测试/调试）。
 */
export function getGeneration(): number {
  return generation;
}
