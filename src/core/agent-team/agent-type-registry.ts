/**
 * Agent 类型注册中心
 *
 * 管理所有 Agent 类型定义的生命周期：加载、注册、查询、匹配。
 * 启动时加载内置类型，运行时支持动态注册自定义类型。
 *
 * @module core/agent-team
 */

import { BUILTIN_AGENT_TYPES } from '@/core/agent-team/builtin-types';
import type { AgentTypeDefinition } from '@/core/agent-team/types';
import { logger } from '@/infra/logger';

const log = logger.child('agent-type-registry');

/**
 * Agent 类型注册中心
 *
 * 单例模式，全局唯一实例。
 * 提供类型注册、查询和能力匹配功能。
 */
export class AgentTypeRegistry {
  /** 已注册的类型（按 typeId 索引） */
  private types: Map<string, AgentTypeDefinition> = new Map();

  /** 非隐藏的类型 ID 缓存 */
  private visibleTypeIds: string[] = [];

  constructor() {
    this.loadBuiltinTypes();
  }

  // ============ 注册 ============

  /**
   * 注册 Agent 类型
   *
   * 如果 typeId 已存在则覆盖（允许用户自定义覆盖内置类型）。
   *
   * @param definition - Agent 类型定义
   */
  register(definition: AgentTypeDefinition): void {
    const existing = this.types.get(definition.typeId);
    if (existing) {
      log.info('覆盖已注册的 Agent 类型', {
        typeId: definition.typeId,
        oldSource: existing.source,
        newSource: definition.source,
      });
    }

    this.types.set(definition.typeId, definition);
    this.refreshCache();
    log.debug('注册 Agent 类型', { typeId: definition.typeId, source: definition.source });
  }

  /**
   * 批量注册 Agent 类型
   *
   * @param definitions - Agent 类型定义列表
   */
  registerAll(definitions: AgentTypeDefinition[]): void {
    for (const def of definitions) {
      this.types.set(def.typeId, def);
    }
    this.refreshCache();
    log.info('批量注册 Agent 类型', { count: definitions.length });
  }

  /**
   * 注销 Agent 类型
   *
   * @param typeId - 类型 ID
   * @returns 是否成功注销
   */
  unregister(typeId: string): boolean {
    const result = this.types.delete(typeId);
    if (result) {
      this.refreshCache();
      log.debug('注销 Agent 类型', { typeId });
    }
    return result;
  }

  // ============ 查询 ============

  /**
   * 获取指定类型定义
   *
   * @param typeId - 类型 ID
   * @returns Agent 类型定义，不存在时返回 undefined
   */
  get(typeId: string): AgentTypeDefinition | undefined {
    return this.types.get(typeId);
  }

  /**
   * 列出所有非隐藏的 Agent 类型
   *
   * @returns Agent 类型定义列表
   */
  list(): AgentTypeDefinition[] {
    return this.visibleTypeIds
      .map((id) => this.types.get(id))
      .filter((def): def is AgentTypeDefinition => def != null);
  }

  /**
   * 列出所有 Agent 类型（包含隐藏类型）
   *
   * @returns Agent 类型定义列表
   */
  listAll(): AgentTypeDefinition[] {
    return Array.from(this.types.values());
  }

  /**
   * 按角色筛选 Agent 类型
   *
   * @param role - Agent 角色
   * @returns 匹配的 Agent 类型定义列表
   */
  listByRole(role: AgentTypeDefinition['role']): AgentTypeDefinition[] {
    return this.list().filter((t) => t.role === role || t.role === 'universal');
  }

  /**
   * 检查类型是否已注册
   *
   * @param typeId - 类型 ID
   */
  has(typeId: string): boolean {
    return this.types.has(typeId);
  }

  // ============ 能力匹配 ============

  /**
   * 根据任务需求匹配最合适的 Agent 类型
   *
   * 匹配优先级：
   * 1. 能力类别精确匹配（category 完全一致）→ 权重最高
   * 2. 能力 ID 匹配（capability.id 在需求列表中）→ 权重中
   * 3. 通用类型（role === 'universal'）→ 作为兜底
   *
   * @param requiredCapabilities - 需要的 Capability ID 列表
   * @returns 按匹配度排序的 Agent 类型列表（最佳在前）
   */
  match(requiredCapabilities: string[]): AgentTypeDefinition[] {
    if (requiredCapabilities.length === 0) {
      // 无特殊要求时返回通用类型
      return this.listByRole('universal');
    }

    const scored = this.list()
      .filter((t) => t.role !== 'coordinator') // coordinator 不参与能力匹配
      .map((type) => {
        let score = 0;
        for (const cap of type.capabilities) {
          if (requiredCapabilities.includes(cap.id)) {
            score += 2;
          }
          if (requiredCapabilities.includes(cap.category)) {
            score += 1;
          }
        }
        return { type, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      // 没有任何匹配时回退到通用类型
      return this.listByRole('universal');
    }

    return scored.map(({ type }) => type);
  }

  /**
   * 获取默认 Agent 类型（general-purpose）
   */
  getDefault(): AgentTypeDefinition {
    const defaultType = this.types.get('general-purpose');
    if (!defaultType) {
      throw new Error('general-purpose agent type not registered');
    }
    return defaultType;
  }

  // ============ 内部方法 ============

  /**
   * 加载内置 Agent 类型
   */
  private loadBuiltinTypes(): void {
    for (const def of BUILTIN_AGENT_TYPES) {
      this.types.set(def.typeId, def);
    }
    this.refreshCache();
    log.info('加载内置 Agent 类型', { count: BUILTIN_AGENT_TYPES.length });
  }

  /**
   * 刷新可见类型缓存
   */
  private refreshCache(): void {
    this.visibleTypeIds = Array.from(this.types.entries())
      .filter(([, def]) => !def.hidden)
      .map(([id]) => id);
  }

  /** 已注册的类型数量 */
  get size(): number {
    return this.types.size;
  }
}

/**
 * 全局单例
 *
 * 整个进程生命周期中只有一个 AgentTypeRegistry 实例。
 */
let globalRegistry: AgentTypeRegistry | null = null;

/** 获取全局 AgentTypeRegistry 实例 */
export function getAgentTypeRegistry(): AgentTypeRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentTypeRegistry();
  }
  return globalRegistry;
}

/** 重置全局实例（仅用于测试） */
export function resetAgentTypeRegistry(): void {
  globalRegistry = null;
}
