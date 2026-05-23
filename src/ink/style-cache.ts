/**
 * style-cache — 轻量级样式 ID 管理
 *
 * 将 ANSI SGR 码数组映射为数字 styleId，用于 Cell 级存储。
 * 支持按代清理（generational GC），避免长时间运行时无限增长。
 *
 * PR6 从 render-node-to-output.ts 提取为独立模块。
 */

// ---------------------------------------------------------------------------
// 内部状态
// ---------------------------------------------------------------------------

let nextStyleId = 1; // 0 = 默认无样式
const styleIdCache = new Map<string, number>();
const styleCodesCache: string[][] = [];

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
  const existing = styleIdCache.get(key);
  if (existing !== undefined) return existing;
  const id = nextStyleId++;
  styleIdCache.set(key, id);
  styleCodesCache[id] = codes;
  return id;
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
}

/**
 * 当前缓存的样式数量（用于调试和监控）。
 */
export function getCachedStyleCount(): number {
  return styleIdCache.size;
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
