/**
 * 权限配置加载与规则合并
 *
 * 负责：
 * 1. 解析 SecurityConfig → ResolvedPermissionConfig（合并 mode 策略 + 默认值）
 * 2. 工具 ID 模式匹配（glob 风格：* 通配符）
 * 3. 参数模式匹配
 *
 * @module security/permission-config
 */

import { MODE_STRATEGIES } from './constants';
import type { PermissionMode, PermissionRule, SecurityAction, SecurityConfig } from './types';

// ============ 解析后的配置 ============

/** 解析后的权限配置（所有可选字段已填充默认值） */
export interface ResolvedPermissionConfig {
  enabled: boolean;
  mode: PermissionMode;
  /** mode 对应的行为策略 */
  modeStrategy: { defaultAction: SecurityAction; maxAutoAllow: string };
  /** 用户 deny 规则（优先级最高） */
  denyRules: PermissionRule[];
  /** 用户 allow 规则 */
  allowRules: PermissionRule[];
  /** 默认动作 */
  defaultAction: SecurityAction;
  /** 持久化配置 */
  persistence: {
    enabled: boolean;
    maxEntries: number;
    expireAfterDays: number;
  };
}

// ============ 默认值 ============

const DEFAULT_PERSISTENCE = {
  enabled: true,
  maxEntries: 500,
  expireAfterDays: 30,
} as const;

// ============ resolveConfig ============

/**
 * 解析 SecurityConfig 为 ResolvedPermissionConfig
 *
 * 合并 mode 策略、填充默认值、归一化规则列表。
 */
export function resolveConfig(config: SecurityConfig = {}): ResolvedPermissionConfig {
  const mode = config.mode ?? 'normal';
  const modeStrategy = MODE_STRATEGIES[mode];

  return {
    enabled: config.enabled ?? true,
    mode,
    modeStrategy,
    denyRules: config.denyRules ?? [],
    allowRules: config.allowRules ?? [],
    defaultAction: config.defaultAction ?? modeStrategy.defaultAction,
    persistence: {
      enabled: config.persistence?.enabled ?? DEFAULT_PERSISTENCE.enabled,
      maxEntries: config.persistence?.maxEntries ?? DEFAULT_PERSISTENCE.maxEntries,
      expireAfterDays: config.persistence?.expireAfterDays ?? DEFAULT_PERSISTENCE.expireAfterDays,
    },
  };
}

// ============ 模式匹配 ============

/**
 * 工具 ID 模式匹配（glob 风格）
 *
 * 支持 * 通配符（匹配任意字符序列）。
 * 示例：
 *   'Read*' 匹配 'ReadFile'
 *   '*' 匹配所有
 *   'Web*' 匹配 'WebFetch', 'WebSearch'
 *   'GetCurrentTime' 精确匹配 'GetCurrentTime'
 */
export function matchToolPattern(pattern: string, toolId: string): boolean {
  // 精确匹配
  if (pattern === toolId) return true;

  // 全通配符
  if (pattern === '*') return true;

  // glob 风格：将 * 替换为正则 .*
  const regex = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
  );
  return regex.test(toolId);
}

/**
 * 参数模式匹配
 *
 * 所有指定的键值对必须匹配才返回 true。
 * 值为字符串时与 String(params[key]) 比较。
 * 如果 paramPatterns 为空则直接返回 true（不限制参数）。
 */
export function matchParamPatterns(
  paramPatterns: Record<string, string> | undefined,
  actualParams: Record<string, unknown>
): boolean {
  if (!paramPatterns || Object.keys(paramPatterns).length === 0) return true;

  return Object.entries(paramPatterns).every(([key, expectedValue]) => {
    const actualValue = actualParams[key];
    if (actualValue === undefined || actualValue === null) return false;
    return String(actualValue) === expectedValue;
  });
}

// ============ Agent 级别覆盖（Phase 2）============

/**
 * 解析 SecurityConfig 并根据 agentId 应用 per-agent 覆盖
 *
 * 合并顺序：mode 策略 → 用户配置 → agentOverrides（最高优先级）
 * agentOverrides 中的 denyRules/allowRules 追加到全局规则，
 * agent allowRules 排在全局 allowRules 之后（优先匹配）。
 */
export function resolveConfigWithAgent(
  config: SecurityConfig,
  agentId?: string
): ResolvedPermissionConfig {
  const base = resolveConfig(config);

  if (!agentId || !config.agentOverrides?.[agentId]) {
    return base;
  }

  const override = config.agentOverrides[agentId];

  const overriddenMode = override.mode ?? base.mode;

  return {
    ...base,
    mode: overriddenMode,
    modeStrategy: override.mode ? MODE_STRATEGIES[override.mode] : base.modeStrategy,
    denyRules: [...base.denyRules, ...(override.denyRules ?? [])],
    // agent allowRules 优先级高于全局 allowRules（排在后面优先匹配）
    allowRules: [...(override.allowRules ?? []), ...base.allowRules],
    defaultAction: override.defaultAction ?? base.defaultAction,
  };
}

/**
 * 从 SecurityConfig 中提取 Agent 安全覆盖配置
 *
 * 返回应用于特定 agent 的合并后配置，去除了 agentOverrides 本身。
 */
export function extractAgentConfig(
  config: SecurityConfig,
  agentId: string | undefined
): ResolvedPermissionConfig {
  return resolveConfigWithAgent(config, agentId);
}
