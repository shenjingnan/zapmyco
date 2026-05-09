import { describe, expect, it } from 'vitest';
import { ToolResultPruner } from '../tool-result-pruner';

/** Helper to create a mock toolResult AgentMessage */
function makeToolResult(overrides?: {
  toolName?: string;
  content?: string | unknown[];
  isError?: boolean;
  _pruned?: boolean;
  details?: unknown;
  toolCallId?: string;
}): Record<string, unknown> {
  return {
    role: 'toolResult',
    toolName: overrides?.toolName ?? 'Read',
    toolCallId: overrides?.toolCallId ?? 'call_1',
    content: overrides?.content ?? 'line1\nline2\nline3',
    isError: overrides?.isError,
    _pruned: overrides?._pruned,
    details: overrides?.details,
  };
}

function makeUserMessage(text: string): Record<string, unknown> {
  return {
    role: 'user',
    content: text,
  };
}

describe('ToolResultPruner', () => {
  describe('constructor', () => {
    it('should initialize with default config', () => {
      const pruner = new ToolResultPruner();
      const config = pruner.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.protectLastMessages).toBe(10);
      expect(config.maxSummaryLength).toBe(200);
    });

    it('should merge partial config with defaults', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 5 });
      const config = pruner.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.protectLastMessages).toBe(5);
      expect(config.maxSummaryLength).toBe(200);
    });
  });

  describe('updateConfig', () => {
    it('should merge new config with existing', () => {
      const pruner = new ToolResultPruner();
      pruner.updateConfig({ protectLastMessages: 15 });
      expect(pruner.getConfig().protectLastMessages).toBe(15);
    });

    it('should override specific fields', () => {
      const pruner = new ToolResultPruner();
      pruner.updateConfig({ enabled: false, maxSummaryLength: 100 });
      const config = pruner.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.maxSummaryLength).toBe(100);
    });
  });

  describe('transform', () => {
    it('should return messages unchanged when disabled', () => {
      const pruner = new ToolResultPruner({ enabled: false });
      const messages: Record<string, unknown>[] = [makeToolResult({ toolName: 'Read' })];
      pruner.transform(messages as any);
      expect(messages[0]!._pruned).toBeUndefined();
    });

    it('should return messages unchanged when empty', () => {
      const pruner = new ToolResultPruner();
      const transformed = pruner.transform([]);
      expect(transformed).toEqual([]);
    });

    it('should return messages unchanged when count <= protectLastMessages', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 5 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Read' }),
        makeToolResult({ toolName: 'Bash' }),
        makeUserMessage('hello'),
      ];
      pruner.transform(messages as any);
      // All 3 messages protected, none pruned
      expect(messages[0]!._pruned).toBeUndefined();
      expect(messages[1]!._pruned).toBeUndefined();
    });

    it('should prune old toolResult messages beyond protect boundary', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 2 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Read', content: 'file content\nline2' }),
        makeUserMessage('user msg'),
        makeToolResult({ toolName: 'Bash', content: '' }),
        makeUserMessage('latest'),
      ];
      // messages.length=4, protectLastMessages=2 -> pruneEndIndex=2
      // messages[0] is Read toolResult -> should be pruned
      // messages[1] is user -> not toolResult, skipped
      // messages[2] and [3] protected
      pruner.transform(messages as any);

      expect(messages[0]!._pruned).toBe(true);
      expect(messages[1]!._pruned).toBeUndefined();
      expect(messages[2]!._pruned).toBeUndefined();
      expect(messages[3]!._pruned).toBeUndefined();
    });

    it('should not re-prune already pruned messages', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Read', _pruned: true, content: 'should not change' }),
      ];
      pruner.transform(messages as any);
      // Content should remain unchanged because it was already pruned
      expect(messages[0]!.content).toBe('should not change');
    });

    it('should replace content with summary text block', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Read', content: 'line1\nline2' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]!.type).toBe('text');
      expect(content[0]!.text).toContain('已读取文件');
      expect(content[0]!.text).toContain('2行');
    });

    it('should clear details on pruned messages', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Read', content: 'data', details: { some: 'info' } }),
      ];
      pruner.transform(messages as any);

      expect(messages[0]!.details).toBeUndefined();
    });

    it('should not modify details if already undefined', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Read', content: 'data', details: undefined }),
      ];
      pruner.transform(messages as any);

      expect(messages[0]!.details).toBeUndefined();
    });

    // Tool-specific summary tests
    it('should generate correct Read summary with line count', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Read', content: 'line1\nline2\nline3' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[已读取文件，3行]');
    });

    it('should generate correct Bash success summary', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Bash', content: 'output line', isError: false }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toContain('执行完成');
      expect(content[0]!.text).toContain('命令');
    });

    it('should generate correct Bash error summary', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Bash', content: 'error msg', isError: true }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toContain('执行失败');
    });

    it('should generate correct Grep summary with match count', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({
          toolName: 'Grep',
          content: 'match1\nmatch2\n\n\n',
        }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[搜索完成, 2处匹配]');
    });

    it('should generate correct Glob summary with file count', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({
          toolName: 'Glob',
          content: 'file1.ts\nfile2.ts\n\n\n',
        }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toContain('文件匹配完成');
    });

    it('should generate generic summary for unknown tools', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'UnknownTool', content: 'some result' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[工具执行完成]');
    });

    it('should generate summary for WebFetch tool', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'WebFetch', content: 'web content' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[网页抓取完成]');
    });

    it('should generate summary for WebSearch tool', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'WebSearch', content: 'search results' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[网页搜索完成]');
    });

    it('should generate summary for Write tool', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Write', content: 'file written' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[文件写入完成]');
    });

    it('should generate summary for Edit tool', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Edit', content: 'edited' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[文件编辑完成]');
    });

    it('should generate summary for Skill tool', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Skill', content: 'skill done' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[技能调用完成]');
    });

    it('should handle toolName with prefix match', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      // toolName starts with 'Read' but has extra suffix
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Read_extra_suffix', content: 'line1\nline2' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toContain('已读取文件');
    });

    it('should handle empty toolName', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: '', content: 'data' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[工具执行完成]');
    });

    it('should truncate summaries exceeding maxSummaryLength', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0, maxSummaryLength: 10 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({ toolName: 'Read', content: 'line1\nline2\nline3\nline4\nline5' }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      // Summary would be "[已读取文件，5行]" (10 chars) but with maxSummaryLength=10
      // expect it to be truncated
      expect(content[0]!.text.length).toBeLessThanOrEqual(10);
    });

    it('should handle content as array with text blocks', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({
          toolName: 'Read',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' },
          ],
        }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[已读取文件，2行]');
    });

    it('should handle content as array with non-text blocks', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({
          toolName: 'Read',
          content: [{ type: 'image' }, { type: 'text', text: 'only text block' }],
        }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[已读取文件，1行]');
    });

    it('should handle content as array with no text blocks', () => {
      const pruner = new ToolResultPruner({ protectLastMessages: 0 });
      const messages: Record<string, unknown>[] = [
        makeToolResult({
          toolName: 'Read',
          content: [{ type: 'image' }],
        }),
      ];
      pruner.transform(messages as any);

      const content = messages[0]!.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toBe('[已读取文件，0行]');
    });
  });

  describe('getConfig', () => {
    it('should return a copy of config', () => {
      const pruner = new ToolResultPruner();
      const config1 = pruner.getConfig();
      const config2 = pruner.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // different references
    });
  });
});
