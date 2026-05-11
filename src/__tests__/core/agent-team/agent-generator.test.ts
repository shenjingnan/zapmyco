/**
 * agent-generator 单元测试
 *
 * 测试生成器的错误处理、参数验证和提示词构建。
 * 不包含实际 LLM 调用（需要真实的 API Key）。
 */

import { describe, expect, it } from 'vitest';
import type { AgentGeneratorResult } from '@/core/agent-team/agent-generator';

describe('agent-generator', () => {
  describe('AgentGeneratorResult type', () => {
    it('should allow constructing error result', () => {
      const result: AgentGeneratorResult = {
        rawOutput: '',
        errors: ['Something went wrong'],
      };
      expect(result.definition).toBeUndefined();
      expect(result.errors).toHaveLength(1);
    });

    it('should allow constructing success result with optional fields', () => {
      const result: AgentGeneratorResult = {
        rawOutput: 'some markdown',
        errors: [],
      };
      result.tokenUsage = { inputTokens: 100, outputTokens: 50 };
      expect(result.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });
  });

  describe('generateAgentType error paths', () => {
    it('should reject empty description', async () => {
      // We can test the validation logic without LLM
      // The function validates description before calling LLM
      const { generateAgentType } = await import('@/core/agent-team/agent-generator');

      // Without a valid LLM facade, we verify the empty description check
      const result = await generateAgentType('', null as never);
      expect(result.errors).toContain('描述不能为空');
      expect(result.rawOutput).toBe('');
    });

    it('should reject whitespace-only description', async () => {
      const { generateAgentType } = await import('@/core/agent-team/agent-generator');

      const result = await generateAgentType('   ', null as never);
      expect(result.errors).toContain('描述不能为空');
    });
  });
});
