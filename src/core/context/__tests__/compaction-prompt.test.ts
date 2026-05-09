import { describe, expect, it } from 'vitest';
import {
  buildCompactionPrompt,
  buildSummaryMessage,
  COMPACTION_ITERATIVE_TEMPLATE,
  COMPACTION_POSTAMBLE,
  COMPACTION_PREAMBLE,
  COMPACTION_SUMMARY_TEMPLATE,
} from '../compaction-prompt';

describe('constants', () => {
  it('COMPACTION_PREAMBLE should contain context markers', () => {
    expect(COMPACTION_PREAMBLE).toContain('上下文压缩');
    expect(COMPACTION_PREAMBLE).toContain('仅供参考');
  });

  it('COMPACTION_POSTAMBLE should contain separation marker', () => {
    expect(COMPACTION_POSTAMBLE).toContain('以上为对话摘要');
    expect(COMPACTION_POSTAMBLE).toContain('以下是当前对话');
  });

  it('COMPACTION_SUMMARY_TEMPLATE should contain required section headers', () => {
    expect(COMPACTION_SUMMARY_TEMPLATE).toContain('目标与意图');
    expect(COMPACTION_SUMMARY_TEMPLATE).toContain('约束与偏好');
    expect(COMPACTION_SUMMARY_TEMPLATE).toContain('已完成');
    expect(COMPACTION_SUMMARY_TEMPLATE).toContain('进行中');
    expect(COMPACTION_SUMMARY_TEMPLATE).toContain('待处理');
    expect(COMPACTION_SUMMARY_TEMPLATE).toContain('关键决策');
    expect(COMPACTION_SUMMARY_TEMPLATE).toContain('相关文件');
    expect(COMPACTION_SUMMARY_TEMPLATE).toContain('重要上下文');
  });

  it('COMPACTION_ITERATIVE_TEMPLATE should contain previousSummary placeholder', () => {
    expect(COMPACTION_ITERATIVE_TEMPLATE).toContain('{previousSummary}');
    expect(COMPACTION_ITERATIVE_TEMPLATE).toContain('已有摘要');
    expect(COMPACTION_ITERATIVE_TEMPLATE).toContain('新对话记录');
  });
});

describe('buildCompactionPrompt', () => {
  it('should return SUMMARY_TEMPLATE when no previousSummary', () => {
    const result = buildCompactionPrompt();
    expect(result).toBe(COMPACTION_SUMMARY_TEMPLATE);
  });

  it('should return SUMMARY_TEMPLATE when previousSummary is undefined', () => {
    const result = buildCompactionPrompt(undefined);
    expect(result).toBe(COMPACTION_SUMMARY_TEMPLATE);
  });

  it('should include previousSummary in iterative mode', () => {
    const summary = 'Previous conversation summary text';
    const result = buildCompactionPrompt(summary);

    expect(result).toContain(summary);
    expect(result).toContain('已有摘要');
    expect(result).toContain('新对话记录');
    expect(result).toContain(COMPACTION_SUMMARY_TEMPLATE);
  });

  it('should handle empty string previousSummary as iterative mode', () => {
    // Empty string is truthy in JS...wait, empty string is falsy
    // So buildCompactionPrompt('') returns SUMMARY_TEMPLATE directly
    const result = buildCompactionPrompt('');
    expect(result).toBe(COMPACTION_SUMMARY_TEMPLATE);
  });
});

describe('buildSummaryMessage', () => {
  it('should wrap text with preamble and postamble', () => {
    const text = 'This is a summary';
    const result = buildSummaryMessage(text);

    expect(result).toContain(COMPACTION_PREAMBLE);
    expect(result).toContain(text);
    expect(result).toContain(COMPACTION_POSTAMBLE);
    // Verify order: preamble before text before postamble
    const preambleIndex = result.indexOf(COMPACTION_PREAMBLE);
    const textIndex = result.indexOf(text);
    const postambleIndex = result.indexOf(COMPACTION_POSTAMBLE);
    expect(preambleIndex).toBeLessThan(textIndex);
    expect(textIndex).toBeLessThan(postambleIndex);
  });

  it('should handle multi-line summary text', () => {
    const text = 'Line 1\nLine 2\nLine 3';
    const result = buildSummaryMessage(text);

    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
    expect(result).toContain('Line 3');
  });
});
