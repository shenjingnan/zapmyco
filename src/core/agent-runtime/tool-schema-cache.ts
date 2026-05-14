/**
 * Tool Schema Cache — 会话级工具 Schema 缓存
 *
 * 缓存已渲染的工具定义，防止会话中因配置重载、MCP 工具更新等
 * 导致的 schema 变化使 Anthropic prompt cache 失效。
 *
 * 参考 claude-code 的 toolSchemaCache (src/utils/toolSchemaCache.ts)。
 *
 * @module core/agent-runtime/tool-schema-cache
 */

/** 缓存的工具定义 */
interface CachedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Schema 内容哈希（用于缓存断裂检测） */
  hash: string;
}

/** 工具 schema 计算函数 */
type ToolSchemaComputer = () => { description: string; parameters: Record<string, unknown> };

/**
 * 会话级工具 Schema 缓存
 *
 * 确保同名的工具在会话内始终返回相同的 schema 定义，
 * 避免因注册顺序、配置更新等因素导致的 byte-level 变化。
 */
export class ToolSchemaCache {
  private cache = new Map<string, CachedTool>();

  /**
   * 获取缓存的工具 schema，缓存未命中时通过 compute 计算并缓存
   */
  getOrCompute(name: string, compute: ToolSchemaComputer): CachedTool {
    const existing = this.cache.get(name);
    if (existing) return existing;

    const schema = compute();
    const cached: CachedTool = {
      name,
      description: schema.description,
      parameters: schema.parameters,
      hash: this.computeHash(schema.description, schema.parameters),
    };
    this.cache.set(name, cached);
    return cached;
  }

  /**
   * 检查工具 schema 是否已变化
   */
  hasChanged(
    name: string,
    current: { description: string; parameters: Record<string, unknown> }
  ): boolean {
    const existing = this.cache.get(name);
    if (!existing) return true;
    return existing.hash !== this.computeHash(current.description, current.parameters);
  }

  /**
   * 清空缓存（在 /clear 或 /compact 时调用）
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getStats(): { size: number; tools: string[] } {
    return {
      size: this.cache.size,
      tools: Array.from(this.cache.keys()),
    };
  }

  /**
   * 基于描述和参数生成内容哈希
   */
  private computeHash(description: string, parameters: Record<string, unknown>): string {
    const content = `${description}|${JSON.stringify(parameters)}`;
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const chr = content.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return hash.toString(36);
  }
}
