/**
 * 内置 Agent 类型聚合导出
 *
 * @module core/agent-team/builtin-types
 */

export { coderType } from './coder';
export { generalPurposeType } from './general-purpose';
export { plannerType } from './planner';
export { researcherType } from './researcher';
export { reviewerType } from './reviewer';

import type { AgentTypeDefinition } from '@/core/agent-team/types';
import { coderType } from './coder';
import { generalPurposeType } from './general-purpose';
import { plannerType } from './planner';
import { researcherType } from './researcher';
import { reviewerType } from './reviewer';

/**
 * 所有内置 Agent 类型列表（按注册顺序）
 */
export const BUILTIN_AGENT_TYPES: AgentTypeDefinition[] = [
  researcherType,
  coderType,
  reviewerType,
  plannerType,
  generalPurposeType,
];
