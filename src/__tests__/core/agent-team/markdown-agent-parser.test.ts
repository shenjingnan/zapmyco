/**
 * markdown-agent-parser 单元测试
 */

import { describe, expect, it } from 'vitest';
import {
  parseAgentMarkdown,
  parseAgentMarkdownBatch,
} from '@/core/agent-team/markdown-agent-parser';

describe('markdown-agent-parser', () => {
  const validMarkdown = `---
typeId: test-expert
displayName: 测试专家
whenToUse: 当需要测试特定功能时
role: worker
tools: safe
maxSpawnDepth: 0
maxTurns: 25
permissionMode: restricted
capabilities:
  - id: testing
    name: 测试能力
    description: 执行测试任务
    category: testing
---

# 测试专家系统提示词

你是测试专家，负责执行测试任务。

工作目录: \${workdir}
任务: \${taskDescription}
`;

  describe('parseAgentMarkdown', () => {
    it('should parse valid markdown with all required fields', () => {
      const result = parseAgentMarkdown('/path/to/test-expert.md', validMarkdown, 'user');

      expect(result.errors).toHaveLength(0);
      expect(result.definition).toBeDefined();
      expect(result.filePath).toBe('/path/to/test-expert.md');

      // biome-ignore lint/style/noNonNullAssertion: verified by errors.length check above
      const def = result.definition!;
      expect(def.typeId).toBe('test-expert');
      expect(def.displayName).toBe('测试专家');
      expect(def.whenToUse).toBe('当需要测试特定功能时');
      expect(def.role).toBe('worker');
      expect(def.toolPolicy).toEqual({ mode: 'safe' });
      expect(def.maxSpawnDepth).toBe(0);
      expect(def.maxTurns).toBe(25);
      expect(def.permissionMode).toBe('restricted');
      expect(def.source).toBe('user');
      expect(def.baseDir).toBe('/path/to');
      expect(def.hidden).not.toBe(true);
      expect(def.capabilities).toHaveLength(1);
      expect(def.capabilities[0]?.id).toBe('testing');
      expect(def.capabilities[0]?.category).toBe('testing');
    });

    it('should generate system prompt from markdown body', () => {
      const result = parseAgentMarkdown('/test.md', validMarkdown, 'project');
      // biome-ignore lint/style/noNonNullAssertion: verified by errors.length check above
      const def = result.definition!;

      const prompt = def.getSystemPrompt({
        taskDescription: '运行测试',
        workdir: '/test/dir',
      });

      expect(prompt).toContain('你是测试专家');
      expect(prompt).toContain('/test/dir');
      expect(prompt).toContain('运行测试');
    });

    it('should support variable interpolation in system prompt', () => {
      const md = `---
typeId: my-agent
displayName: My Agent
whenToUse: for testing
role: worker
tools: standard
maxSpawnDepth: 0
maxTurns: 10
---

Task: \${taskDescription}
Workdir: \${workdir}
Context: \${context}
Memory: \${memorySnapshot}
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      // biome-ignore lint/style/noNonNullAssertion: verified by errors.length check above
      const def = result.definition!;

      const prompt = def.getSystemPrompt({
        taskDescription: 'do something',
        workdir: '/home/user/project',
        context: 'some context',
        memorySnapshot: 'some memory',
      });

      expect(prompt).toContain('Task: do something');
      expect(prompt).toContain('Workdir: /home/user/project');
      expect(prompt).toContain('Context: some context');
      expect(prompt).toContain('Memory: some memory');
    });

    it('should reject invalid typeId format', () => {
      const md = `---
typeId: Invalid-Name!
displayName: Bad Agent
whenToUse: test
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('typeId'))).toBe(true);
    });

    it('should return errors for missing required fields', () => {
      const md = `---
role: worker
---

Some content
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('typeId'))).toBe(true);
      expect(result.errors.some((e) => e.includes('displayName'))).toBe(true);
      expect(result.errors.some((e) => e.includes('whenToUse'))).toBe(true);
    });

    it('should use default values for optional fields', () => {
      const md = `---
typeId: minimal-agent
displayName: Minimal
whenToUse: for minimal testing
---

Just a minimal agent.
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      expect(result.errors).toHaveLength(0);
      expect(result.definition).toBeDefined();

      // biome-ignore lint/style/noNonNullAssertion: verified by errors.length check above
      const def = result.definition!;
      expect(def.role).toBe('worker');
      expect(def.toolPolicy).toEqual({ mode: 'safe' });
      expect(def.maxTurns).toBe(30);
      expect(def.maxSpawnDepth).toBe(0);
      expect(def.permissionMode).toBe('restricted');
      expect(def.capabilities).toHaveLength(1);
      expect(def.capabilities[0]?.category).toBe('generic');
    });

    it('should parse custom tool list', () => {
      const md = `---
typeId: custom-tools
displayName: Custom Tools
whenToUse: for testing
tools:
  - ReadFile
  - WriteFile
  - Grep
---

Custom tools agent.
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      expect(result.errors).toHaveLength(0);
      expect(result.definition?.toolPolicy).toEqual({
        mode: 'custom',
        tools: ['ReadFile', 'WriteFile', 'Grep'],
      });
    });

    it('should parse coordinator role', () => {
      const md = `---
typeId: my-coordinator
displayName: My Coordinator
whenToUse: for coordinating tasks
role: coordinator
tools: full
maxSpawnDepth: 2
---

Coordinator prompt.
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      expect(result.errors).toHaveLength(0);
      expect(result.definition?.role).toBe('coordinator');
      expect(result.definition?.toolPolicy).toEqual({ mode: 'full' });
      expect(result.definition?.maxSpawnDepth).toBe(2);
    });

    it('should validate role values', () => {
      const md = `---
typeId: bad-role
displayName: Bad Role
whenToUse: test
role: invalid_role
---

Test
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      expect(result.errors.some((e) => e.includes('role'))).toBe(true);
    });

    it('should validate permissionMode values', () => {
      const md = `---
typeId: bad-perm
displayName: Bad Permission
whenToUse: test
permissionMode: invalid_mode
---

Test
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      expect(result.errors.some((e) => e.includes('permissionMode'))).toBe(true);
    });

    it('should skip disabled agents', () => {
      const md = `---
typeId: disabled-agent
displayName: Disabled Agent
whenToUse: should be skipped
disabled: true
---

This agent should not be loaded.
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      expect(result.errors).toHaveLength(0);
      expect(result.definition).toBeUndefined();
    });

    it('should handle missing capabilities with default', () => {
      const md = `---
typeId: no-caps
displayName: No Capabilities
whenToUse: testing
---

No explicit capabilities.
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      expect(result.errors).toHaveLength(0);
      expect(result.definition?.capabilities).toHaveLength(1);
      expect(result.definition?.capabilities[0]?.id).toBe('general');
    });

    it('should handle empty body gracefully', () => {
      const md = `---
typeId: empty-body
displayName: Empty Body
whenToUse: testing
---
`;

      const result = parseAgentMarkdown('/test.md', md, 'user');
      expect(result.errors).toHaveLength(0);
      // biome-ignore lint/style/noNonNullAssertion: verified by errors.length check above
      const def = result.definition!;
      const prompt = def.getSystemPrompt({ taskDescription: 'test', workdir: '/' });
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should return error for unparsable frontmatter', () => {
      const result = parseAgentMarkdown('/test.md', 'not valid --- markdown', 'user');
      // gray-matter may still parse this without frontmatter, but required fields will be missing
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should set correct source', () => {
      const result = parseAgentMarkdown('/test.md', validMarkdown, 'project');
      expect(result.definition?.source).toBe('project');

      const result2 = parseAgentMarkdown('/test.md', validMarkdown, 'user');
      expect(result2.definition?.source).toBe('user');
    });
  });

  describe('parseAgentMarkdownBatch', () => {
    it('should batch parse multiple files', () => {
      const files = [
        {
          filePath: '/agents/agent-a.md',
          content: `---
typeId: agent-a
displayName: Agent A
whenToUse: for task A
---

Agent A body.
`,
        },
        {
          filePath: '/agents/agent-b.md',
          content: `---
typeId: agent-b
displayName: Agent B
whenToUse: for task B
tools:
  - ReadFile
  - WriteFile
---

Agent B body.
`,
        },
        {
          filePath: '/agents/bad.md',
          content: `---
role: worker
---

Bad agent without required fields.
`,
        },
      ];

      const result = parseAgentMarkdownBatch(files, 'user');

      expect(result.definitions).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.definitions[0]?.typeId).toBe('agent-a');
      expect(result.definitions[1]?.typeId).toBe('agent-b');
      expect(result.errors[0]?.filePath).toBe('/agents/bad.md');
    });

    it('should return empty arrays for empty input', () => {
      const result = parseAgentMarkdownBatch([], 'user');
      expect(result.definitions).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});
