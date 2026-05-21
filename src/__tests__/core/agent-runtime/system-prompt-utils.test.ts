/**
 * System Prompt 缓存工具函数测试
 *
 * 测试覆盖：
 * - splitSystemPrompt() 三种策略模式
 * - buildSystemPromptBlocks() cache_control 构建
 * - 边界条件（空输入、只有标记等）
 */
import { describe, expect, it } from 'vitest';
import {
  SYSTEM_PROMPT_STATIC_BOUNDARY,
  type SystemPromptSegment,
} from '@/core/agent-runtime/agent-types';
import {
  buildSystemPromptBlocks,
  splitSystemPrompt,
} from '@/core/agent-runtime/system-prompt-utils';

// ============ splitSystemPrompt ============

describe('splitSystemPrompt', () => {
  describe('Fallback 模式（不启用 global scope）', () => {
    it('应返回 prefix:null + content:org', () => {
      const blocks = ['你是 TestAgent，一个专业的 AI 助手。你的能力包括：分析。', '## 静态内容'];
      const segments = splitSystemPrompt(blocks);
      expect(segments).toHaveLength(2);
      expect(segments[0]!.text).toContain('你是 TestAgent');
      expect(segments[0]!.cacheScope).toBeNull();
      expect(segments[1]!.text).toBe('## 静态内容');
      expect(segments[1]!.cacheScope).toBe('org');
    });

    it('应过滤掉边界标记，非前缀内容合并为一个 org 段', () => {
      const blocks = ['a', SYSTEM_PROMPT_STATIC_BOUNDARY, 'b'];
      const segments = splitSystemPrompt(blocks);
      expect(segments).toHaveLength(1);
      expect(segments[0]!.text).toBe('a\n\nb');
      expect(segments[0]!.cacheScope).toBe('org');
    });

    it('空输入应返回空数组', () => {
      expect(splitSystemPrompt([])).toHaveLength(0);
    });
  });

  describe('Global Scope 模式（有边界标记）', () => {
    it('应将静态内容标记为 global 缓存', () => {
      const blocks = [
        '你是 Agent，一个专业的助手。',
        '## 核心规则',
        SYSTEM_PROMPT_STATIC_BOUNDARY,
        '## 工作目录\n/tmp',
      ];
      const segments = splitSystemPrompt(blocks, { enableGlobalScope: true });
      expect(segments).toHaveLength(3);
      expect(segments[0]!.cacheScope).toBeNull(); // 身份前缀
      expect(segments[1]!).toEqual({
        text: '## 核心规则',
        cacheScope: 'global',
      });
      expect(segments[2]!).toEqual({
        text: '## 工作目录\n/tmp',
        cacheScope: null, // 动态内容不缓存
      });
    });
  });

  describe('Global Scope 模式（无边界标记 → fallback）', () => {
    it('应退化到 org 级别缓存', () => {
      const blocks = ['你是 Agent，一个专业的助手。', '## 内容'];
      const segments = splitSystemPrompt(blocks, { enableGlobalScope: true });
      expect(segments).toHaveLength(2);
      expect(segments[0]!.cacheScope).toBeNull();
      expect(segments[1]!.cacheScope).toBe('org');
    });
  });

  describe('Tool-based 模式', () => {
    it('应跳过 global，使用 org 级别', () => {
      const blocks = [
        '你是 Agent，一个专业的助手。',
        '## 内容',
        SYSTEM_PROMPT_STATIC_BOUNDARY,
        '## 动态',
      ];
      const segments = splitSystemPrompt(blocks, {
        enableGlobalScope: true,
        skipGlobalCache: true,
      });
      // 边界标记被过滤，identity prefix 不缓存，剩下合并为一个 org block
      expect(segments).toHaveLength(2);
      expect(segments[0]!.cacheScope).toBeNull();
      expect(segments[1]!.cacheScope).toBe('org');
      // 两个内容块应该被合并
      expect(segments[1]!.text).toContain('## 内容');
      expect(segments[1]!.text).toContain('## 动态');
    });
  });

  describe('身份前缀检测', () => {
    it('应以 "你是" 开头且包含 "一个专业的" 的文本标记为不缓存', () => {
      const blocks = ['你是 TestAgent，一个专业的 AI 助手。', '## 规则'];
      const segments = splitSystemPrompt(blocks, { enableGlobalScope: true });
      expect(segments[0]!.cacheScope).toBeNull();
    });

    it('不以 "你是" 开头的文本应合并为一个 org 段', () => {
      const blocks = ['## 标题', '内容'];
      const segments = splitSystemPrompt(blocks);
      expect(segments).toHaveLength(1);
      expect(segments[0]!.cacheScope).toBe('org');
      expect(segments[0]!.text).toBe('## 标题\n\n内容');
    });
  });
});

// ============ buildSystemPromptBlocks ============

describe('buildSystemPromptBlocks', () => {
  it('cacheScope=null → 不添加 cache_control', () => {
    const segments: SystemPromptSegment[] = [{ text: 'header', cacheScope: null }];
    const blocks = buildSystemPromptBlocks(segments, true);
    expect(blocks[0]!.cache_control).toBeUndefined();
  });

  it('cacheScope=org → 添加 type:ephemeral', () => {
    const segments: SystemPromptSegment[] = [{ text: 'body', cacheScope: 'org' }];
    const blocks = buildSystemPromptBlocks(segments, true);
    expect(blocks[0]!.cache_control).toBeDefined();
    expect(blocks[0]!.cache_control?.type).toBe('ephemeral');
    expect(
      (blocks[0]!.cache_control as { type: 'ephemeral'; scope?: string })?.scope
    ).toBeUndefined();
  });

  it('cacheScope=global → 添加 scope:global', () => {
    const segments: SystemPromptSegment[] = [{ text: 'body', cacheScope: 'global' }];
    const blocks = buildSystemPromptBlocks(segments, true);
    expect((blocks[0]!.cache_control as { type: 'ephemeral'; scope?: string })?.scope).toBe(
      'global'
    );
  });

  it('enableCache=false → 所有块无 cache_control', () => {
    const segments: SystemPromptSegment[] = [
      { text: 'a', cacheScope: 'org' },
      { text: 'b', cacheScope: 'global' },
    ];
    const blocks = buildSystemPromptBlocks(segments, false);
    for (const block of blocks) {
      expect(block.cache_control).toBeUndefined();
    }
  });

  it('cacheTtl=1h → 添加 ttl:1h', () => {
    const segments: SystemPromptSegment[] = [{ text: 'body', cacheScope: 'org' }];
    const blocks = buildSystemPromptBlocks(segments, true, '1h');
    expect((blocks[0]!.cache_control as { type: 'ephemeral'; ttl?: string })?.ttl).toBe('1h');
  });

  it('空数组 → 返回空数组', () => {
    expect(buildSystemPromptBlocks([], true)).toHaveLength(0);
  });

  it('多段 → TextBlockParam 长度一致', () => {
    const segments: SystemPromptSegment[] = [
      { text: 'a', cacheScope: null },
      { text: 'b', cacheScope: 'org' },
      { text: 'c', cacheScope: 'global' },
    ];
    const blocks = buildSystemPromptBlocks(segments, true);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.type).toBe('text');
    expect(blocks[1]!.type).toBe('text');
    expect(blocks[2]!.type).toBe('text');
    expect(blocks[0]!.text).toBe('a');
    expect(blocks[1]!.text).toBe('b');
    expect(blocks[2]!.text).toBe('c');
  });
});
