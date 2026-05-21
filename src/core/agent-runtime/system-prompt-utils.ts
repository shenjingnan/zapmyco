/**
 * System Prompt 缓存工具函数
 *
 * 参照 Claude Code 的 System Prompt 缓存策略：
 * - splitSysPromptPrefix() → src/utils/api.ts
 * - buildSystemPromptBlocks() → src/services/api/claude.ts
 *
 * 职责：
 * 1. splitSystemPrompt() — 将原始文本数组按边界标记拆分为带缓存作用域的分段
 * 2. buildSystemPromptBlocks() — 将分段转换为 Anthropic TextBlockParam 数组
 *
 * @module core/agent-runtime/system-prompt-utils
 */

import type Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT_STATIC_BOUNDARY, type SystemPromptSegment } from './agent-types';

// ============ 身份前缀检测 ============

/**
 * 判断文本是否为 Agent 身份前缀
 *
 * 身份前缀不缓存（cacheScope=null），因为可能跨 session 变化。
 * 匹配规则：以"你是"开头且包含"一个专业的"。
 *
 * 参考 Claude Code: src/constants/system.ts CLI_SYSPROMPT_PREFIXES
 */
function isIdentityPrefix(text: string): boolean {
  return text.startsWith('你是') && text.includes('一个专业的');
}

// ============ 分段策略 ============

/**
 * 将 System Prompt 字符串数组按策略拆分为带缓存作用域的分段
 *
 * 三种策略：
 *
 * 1. Tool-based 模式（skipGlobalCache=true + enableGlobalScope=true）：
 *    MCP 工具存在时使用。身份前缀不缓存，其余 org 级别缓存。
 *    因为 MCP 工具变化会打破 global 缓存。
 *
 * 2. Global Scope 模式（enableGlobalScope=true）：
 *    找到边界标记时 — 身份前缀不缓存，静态内容 global，动态内容不缓存
 *    未找到边界标记时 — fallback 到 org 级别
 *
 * 3. Fallback 模式（默认）：
 *    身份前缀不缓存，其余 org 级别
 *
 * @param promptBlocks - System Prompt 原始文本数组
 * @param options - 分段选项
 * @returns SystemPromptSegment 数组
 *
 * 参考 Claude Code: src/utils/api.ts splitSysPromptPrefix()
 */
export function splitSystemPrompt(
  promptBlocks: string[],
  options?: {
    /** 跳过全局缓存（MCP 工具存在时使用工具级缓存） */
    skipGlobalCache?: boolean;
    /** 是否启用 global cache scope */
    enableGlobalScope?: boolean;
  }
): SystemPromptSegment[] {
  const enableGlobalScope = options?.enableGlobalScope ?? false;
  const skipGlobalCache = options?.skipGlobalCache ?? false;

  if (enableGlobalScope && skipGlobalCache) {
    return splitToolBasedMode(promptBlocks);
  }

  if (enableGlobalScope) {
    return splitGlobalScopeMode(promptBlocks);
  }

  return splitOrgFallbackMode(promptBlocks);
}

/**
 * 工具级缓存模式
 *
 * MCP 工具存在时，工具 schema 可能动态变化，不适合 global 缓存。
 * 身份前缀不缓存，其余全部 org 级别。
 */
function splitToolBasedMode(blocks: string[]): SystemPromptSegment[] {
  const segments: SystemPromptSegment[] = [];
  const rest: string[] = [];

  for (const block of blocks) {
    if (!block || block === SYSTEM_PROMPT_STATIC_BOUNDARY) continue;
    if (isIdentityPrefix(block)) {
      segments.push({ text: block, cacheScope: null });
    } else {
      rest.push(block);
    }
  }

  const restJoined = rest.join('\n\n');
  if (restJoined) {
    segments.push({ text: restJoined, cacheScope: 'org' });
  }

  return segments;
}

/**
 * Global Scope 缓存模式
 *
 * 找到边界标记时：
 * - 身份前缀 → cacheScope=null（不缓存）
 * - 边界前静态内容 → cacheScope='global'（跨组织共享）
 * - 边界后动态内容 → cacheScope=null（不缓存）
 *
 * 未找到边界标记 → fallback 到 org 级别
 */
function splitGlobalScopeMode(blocks: string[]): SystemPromptSegment[] {
  const boundaryIndex = blocks.findIndex((b) => b === SYSTEM_PROMPT_STATIC_BOUNDARY);

  if (boundaryIndex !== -1) {
    const segments: SystemPromptSegment[] = [];
    const staticBlocks: string[] = [];
    const dynamicBlocks: string[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block || block === SYSTEM_PROMPT_STATIC_BOUNDARY) continue;

      if (isIdentityPrefix(block)) {
        segments.push({ text: block, cacheScope: null });
      } else if (i < boundaryIndex) {
        staticBlocks.push(block);
      } else {
        dynamicBlocks.push(block);
      }
    }

    const staticJoined = staticBlocks.join('\n\n');
    if (staticJoined) {
      segments.push({ text: staticJoined, cacheScope: 'global' });
    }

    const dynamicJoined = dynamicBlocks.join('\n\n');
    if (dynamicJoined) {
      segments.push({ text: dynamicJoined, cacheScope: null });
    }

    return segments;
  }

  // 无边界标记 → fallback
  return splitOrgFallbackMode(blocks);
}

/**
 * Fallback 缓存模式
 *
 * 不支持 global scope 时，身份前缀不缓存，其余 org 级别。
 */
function splitOrgFallbackMode(blocks: string[]): SystemPromptSegment[] {
  const segments: SystemPromptSegment[] = [];
  const rest: string[] = [];

  for (const block of blocks) {
    if (!block || block === SYSTEM_PROMPT_STATIC_BOUNDARY) continue;
    if (isIdentityPrefix(block)) {
      segments.push({ text: block, cacheScope: null });
    } else {
      rest.push(block);
    }
  }

  const restJoined = rest.join('\n\n');
  if (restJoined) {
    segments.push({ text: restJoined, cacheScope: 'org' });
  }

  return segments;
}

// ============ TextBlockParam 构建 ============

/**
 * 将 System Prompt 分段数组转换为 Anthropic TextBlockParam 数组
 *
 * 根据 cacheScope 设置 cache_control：
 * - null → 不添加 cache_control（不缓存）
 * - 'org' → { type: 'ephemeral' }（组织级别缓存）
 * - 'global' → { type: 'ephemeral', scope: 'global' }（全局缓存）
 *
 * @param segments - 分段列表
 * @param enableCache - 是否启用缓存
 * @param cacheTtl - 缓存 TTL（'1h' 或 undefined=5min）
 * @returns Anthropic TextBlockParam 数组
 *
 * 参考 Claude Code: src/services/api/claude.ts buildSystemPromptBlocks()
 */
export function buildSystemPromptBlocks(
  segments: SystemPromptSegment[],
  enableCache: boolean,
  cacheTtl?: '1h'
): Anthropic.TextBlockParam[] {
  return segments.map((seg) => {
    const cacheControl: Record<string, unknown> = {};
    if (enableCache && seg.cacheScope !== null) {
      cacheControl.type = 'ephemeral';
      if (seg.cacheScope === 'global') {
        cacheControl.scope = 'global';
      }
      if (cacheTtl) {
        cacheControl.ttl = cacheTtl;
      }
    }
    return {
      type: 'text' as const,
      text: seg.text,
      ...(Object.keys(cacheControl).length > 0
        ? { cache_control: cacheControl as { type: 'ephemeral'; scope?: 'global'; ttl?: '1h' } }
        : {}),
    };
  });
}
