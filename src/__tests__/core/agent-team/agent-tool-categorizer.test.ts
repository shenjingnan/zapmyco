/**
 * Agent 工具分类器测试
 */

import { describe, expect, it } from 'vitest';
import { categorizeTool } from '@/core/agent-team/agent-tool-categorizer';

describe('categorizeTool', () => {
  it('应该将 ReadFile 分类为 read', () => {
    const result = categorizeTool('ReadFile');
    expect(result).toEqual({ category: 'read', label: 'Read' });
  });

  it('应该将 Glob 和 Grep 分类为 search', () => {
    expect(categorizeTool('Glob')).toEqual({ category: 'search', label: 'Search' });
    expect(categorizeTool('Grep')).toEqual({ category: 'search', label: 'Search' });
  });

  it('应该将 WriteFile 分类为 write', () => {
    expect(categorizeTool('WriteFile')).toEqual({ category: 'write', label: 'Write' });
  });

  it('应该将 Exec 和 Process 分类为 exec', () => {
    expect(categorizeTool('Exec')).toEqual({ category: 'exec', label: 'Exec' });
    expect(categorizeTool('Process')).toEqual({ category: 'exec', label: 'Process' });
  });

  it('应该将 WebFetch 和 WebSearch 分类为 web', () => {
    expect(categorizeTool('WebFetch')).toEqual({ category: 'web', label: 'WebFetch' });
    expect(categorizeTool('WebSearch')).toEqual({ category: 'web', label: 'WebSearch' });
  });

  it('应该将 TaskManage 和 Memory 分类为 task', () => {
    expect(categorizeTool('TaskManage')).toEqual({ category: 'task', label: 'Task' });
    expect(categorizeTool('Memory')).toEqual({ category: 'task', label: 'Memory' });
  });

  it('应该将 AgentTool 分类为 other/Spawn', () => {
    expect(categorizeTool('AgentTool')).toEqual({ category: 'other', label: 'Spawn' });
  });

  it('未知工具应分类为 other 并使用原始名称作为标签', () => {
    const result = categorizeTool('UnknownTool');
    expect(result.category).toBe('other');
    expect(result.label).toBe('UnknownTool');
  });
});
