/**
 * Anthropic Beta 功能请求头常量
 *
 * 参考 Claude Code src/constants/betas.ts
 *
 * @module constants/betas
 */

/** Prompt Caching 作用域 — 允许 scope:'global' 跨组织共享缓存 */
export const PROMPT_CACHING_SCOPE_BETA_HEADER = 'prompt-caching-scope-2026-01-05';

/** 1M 上下文窗口 */
export const CONTEXT_1M_BETA_HEADER = 'context-1m-2025-08-07';

/** 上下文管理（压缩、编辑） */
export const CONTEXT_MANAGEMENT_BETA_HEADER = 'context-management-2025-06-27';

/** 结构化输出 */
export const STRUCTURED_OUTPUTS_BETA_HEADER = 'structured-outputs-2025-12-15';

/** 交错的思考过程 */
export const INTERLEAVED_THINKING_BETA_HEADER = 'interleaved-thinking-2025-05-14';
