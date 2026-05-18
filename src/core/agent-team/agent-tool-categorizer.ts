/**
 * Agent 工具分类器
 *
 * 将工具名称映射为展示分类，用于界面分组展示。
 *
 * @module core/agent-team
 */

import type { ToolCallCategory } from './types';

/** 工具分类映射条目 */
interface ToolCategoryEntry {
  category: ToolCallCategory;
  label: string;
}

/** 内置工具分类映射表 */
const TOOL_CATEGORIES: Record<string, ToolCategoryEntry> = {
  ReadFile: { category: 'read', label: 'Read' },
  Glob: { category: 'search', label: 'Search' },
  Grep: { category: 'search', label: 'Search' },
  WriteFile: { category: 'write', label: 'Write' },
  EditFile: { category: 'edit', label: 'Edit' },
  Exec: { category: 'exec', label: 'Exec' },
  Process: { category: 'exec', label: 'Process' },
  WebFetch: { category: 'web', label: 'WebFetch' },
  WebSearch: { category: 'web', label: 'WebSearch' },
  TaskManage: { category: 'task', label: 'Task' },
  Memory: { category: 'task', label: 'Memory' },
  AgentTool: { category: 'other', label: 'Spawn' },
};

/**
 * 对工具名称进行分类
 *
 * @param toolName - 工具名称
 * @returns 分类信息和展示标签
 */
export function categorizeTool(toolName: string): ToolCategoryEntry {
  return TOOL_CATEGORIES[toolName] ?? { category: 'other' as ToolCallCategory, label: toolName };
}
