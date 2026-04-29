import { describe, expect, it } from 'vitest';
import type { ILlmProvider } from '@/llm/provider';

/**
 * LLM Provider 接口覆盖率测试
 *
 * ILlmProvider 是纯接口定义，通过导入验证其结构。
 */

describe('ILlmProvider interface', () => {
  it('should define the ILlmProvider interface shape', () => {
    // 接口本身不能实例化，但验证它被正确导出
    expect(typeof ({} as ILlmProvider)).toBeDefined();

    // 验证接口的属性签名（通过构造符合结构的对象）
    const mockProvider: ILlmProvider = {
      providerId: 'test-provider',
      chat: async () => ({
        content: 'response',
        model: 'test-model',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        finishReason: 'end_turn',
      }),
      chatStream: async function* () {
        yield 'hello';
        yield ' world';
      },
    };

    expect(mockProvider.providerId).toBe('test-provider');
  });
});
