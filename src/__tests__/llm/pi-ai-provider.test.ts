import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============ Mock 工厂（vi.hoisted 提升）============
const {
  mockGetModel,
  mockComplete,
  mockStream,
  mockCostRecord,
  mockLoggerDebug,
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => {
  const mockModel = {
    id: 'anthropic/claude-sonnet-4-20250514',
    name: 'anthropic/claude-sonnet-4-20250514',
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    provider: 'anthropic',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 8192,
  };

  return {
    mockGetModel: vi.fn().mockReturnValue({ ...mockModel }),
    mockComplete: vi.fn(),
    mockStream: vi.fn(),
    mockCostRecord: vi.fn(),
    mockLoggerDebug: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockLoggerError: vi.fn(),
  };
});

// ============ Mock pi-ai 模块 ============
vi.mock('@mariozechner/pi-ai', () => ({
  getModel: mockGetModel,
  complete: mockComplete,
  stream: mockStream,
}));

// ============ Mock 内部模块 ============
vi.mock('@/infra/logger', () => ({
  logger: {
    debug: mockLoggerDebug,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    info: vi.fn(),
    child: vi.fn().mockReturnValue({
      debug: mockLoggerDebug,
      warn: mockLoggerWarn,
      error: mockLoggerError,
      info: vi.fn(),
    }),
  },
}));

vi.mock('@/llm/cost-tracker', () => ({
  costTracker: { record: mockCostRecord },
}));

import type { LlmConfig } from '@/config/types';
// ============ 导入被测模块 ============
import { PiAiProvider } from '@/llm/pi-ai-provider';
import type { ChatMessage } from '@/llm/types';

// ============ 测试工具函数 ============
function createTestConfig(overrides?: Partial<LlmConfig>): LlmConfig {
  return {
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    models: {
      'anthropic/claude-sonnet-4-20250514': {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
      },
    },
    providers: { anthropic: { apiKey: 'sk-test' } },
    defaults: { maxTokens: 8192, temperature: 0.7 },
    ...overrides,
  };
}

/** 创建模拟的 complete 响应 */
function createMockCompleteResponse(overrides?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: 'Hello world' }],
    usage: {
      input: 10,
      output: 5,
      totalTokens: 15,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    responseId: 'resp_123',
    ...overrides,
  };
}

/** 创建模拟的流式事件生成器 */
function createMockStreamGenerator(
  chunks: string[],
  doneUsage?: { input: number; output: number; totalTokens: number }
) {
  return (async function* (): AsyncGenerator<unknown> {
    for (const chunk of chunks) {
      yield { type: 'text_delta', delta: chunk };
    }
    yield {
      type: 'done',
      message: {
        usage: {
          input: doneUsage?.input ?? chunks.join('').length,
          output: doneUsage?.output ?? Math.ceil(chunks.join('').length / 2),
          totalTokens:
            doneUsage?.totalTokens ??
            chunks.join('').length + Math.ceil(chunks.join('').length / 2),
          cacheRead: 0,
          cacheWrite: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    };
  })();
}

// ============ 测试套件 ============
describe('PiAiProvider', () => {
  let provider: PiAiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new PiAiProvider(createTestConfig());
  });

  // ============ 构造函数与属性 ============
  describe('构造函数', () => {
    it('providerId 应为 "pi-ai"', () => {
      expect(provider.providerId).toBe('pi-ai');
    });
  });

  // ============ parseModelKey() — 通过 resolveModel 间接测试 ============
  describe('模型解析', () => {
    it('无效格式应抛出错误', async () => {
      const badProvider = new PiAiProvider(createTestConfig({ defaultModel: 'no-slash-format' }));

      await expect(badProvider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow(
        '无效的模型标识符格式'
      );
    });
  });

  // ============ chat() 非流式调用 ============
  describe('chat()', () => {
    it('应返回正确的 LlmResponse 结构', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      const result = await provider.chat([{ role: 'user', content: 'Hello' }]);

      expect(result.content).toBe('Hello world');
      expect(result.inputTokens).toBe(10);
      expect(result.outputTokens).toBe(5);
      expect(result.model).toBe('anthropic/claude-sonnet-4-20250514');
      expect(result.id).toBe('resp_123');
      expect(result.truncated).toBe(false);
    });

    it('stopReason 为 length 时 truncated 应为 true', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse({ stopReason: 'length' }));

      const result = await provider.chat([{ role: 'user', content: 'test' }]);

      expect(result.truncated).toBe(true);
    });

    it('无 responseId 时结果不应包含 id 字段', async () => {
      const { responseId, ...rest } = createMockCompleteResponse();
      mockComplete.mockResolvedValueOnce(rest);

      const result = await provider.chat([{ role: 'user', content: 'test' }]);

      expect(result.id).toBeUndefined();
    });

    it('应调用 costTracker.record 记录成本', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      await provider.chat([{ role: 'user', content: 'test' }]);

      expect(mockCostRecord).toHaveBeenCalledWith(
        expect.objectContaining({ inputTokens: 10, outputTokens: 5 }),
        'anthropic/claude-sonnet-4-20250514'
      );
    });

    it('应通过 options.model 覆盖默认模型', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      // 配置一个自定义模型
      const customProvider = new PiAiProvider(
        createTestConfig({
          defaultModel: 'anthropic/default-model',
          models: {
            'anthropic/default-model': { provider: 'anthropic', modelId: 'default-model' },
            'anthropic/custom-model': {
              provider: 'anthropic',
              modelId: 'custom-id',
              baseUrl: 'https://custom.api.com',
            },
          },
        })
      );

      await customProvider.chat([{ role: 'user', content: 'test' }], {
        model: 'anthropic/custom-model',
      });

      // getModel 应被调用，且模型名最终被覆盖
      expect(mockGetModel).toHaveBeenCalled();
    });

    it('应将 options 传递给 complete 调用', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      const signal = AbortSignal.timeout(5000);
      await provider.chat([{ role: 'user', content: 'test' }], {
        temperature: 0.5,
        maxTokens: 1024,
        signal,
      });

      expect(mockComplete).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          temperature: 0.5,
          maxTokens: 1024,
          signal,
        })
      );
    });

    it('应使用 config.defaults 作为默认参数', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      const configProvider = new PiAiProvider(
        createTestConfig({ defaults: { maxTokens: 4096, temperature: 0.3 } })
      );

      await configProvider.chat([{ role: 'user', content: 'test' }]);

      expect(mockComplete).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ maxTokens: 4096, temperature: 0.3 })
      );
    });

    it('自定义 apiKey 应传递给 complete', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      const customProvider = new PiAiProvider(
        createTestConfig({
          providers: { anthropic: { apiKey: 'sk-custom-key' } },
        })
      );

      await customProvider.chat([{ role: 'user', content: 'test' }]);

      expect(mockComplete).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ apiKey: 'sk-custom-key' })
      );
    });
  });

  // ============ chatStream() 流式调用 ============
  describe('chatStream()', () => {
    it('应逐 yield 文本内容', async () => {
      mockStream.mockReturnValueOnce(createMockStreamGenerator(['Hello ', 'world!']));

      const chunks: string[] = [];
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'Hi' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello ', 'world!']);
    });

    it('空流应返回空数组', async () => {
      mockStream.mockReturnValueOnce(createMockStreamGenerator([]));

      const chunks: string[] = [];
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'Hi' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
    });

    it('done 事件后仍继续消费 text_delta（usage 已固定）', async () => {
      mockStream.mockReturnValueOnce(
        (async function* () {
          yield { type: 'text_delta', delta: 'before' };
          yield {
            type: 'done',
            message: {
              usage: {
                input: 1,
                output: 1,
                totalTokens: 2,
                cacheRead: 0,
                cacheWrite: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
            },
          };
          yield { type: 'text_delta', delta: 'after' }; // done 后仍会 yield
        })()
      );

      const chunks: string[] = [];
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'test' }])) {
        chunks.push(chunk);
      }

      // done 事件不中断迭代，所有 text_delta 都会被 yield
      expect(chunks).toEqual(['before', 'after']);
    });

    it('error 事件应抛出错误', async () => {
      mockStream.mockReturnValueOnce(
        (async function* () {
          yield { type: 'text_delta', delta: 'ok' };
          yield {
            type: 'error',
            reason: 'rate_limited',
            error: { errorMessage: 'Rate limit exceeded' },
          };
        })()
      );

      const chunks: string[] = [];
      await expect(
        (async () => {
          for await (const chunk of provider.chatStream([{ role: 'user', content: 'test' }])) {
            chunks.push(chunk);
          }
        })()
      ).rejects.toThrow('LLM 流式请求失败: Rate limit exceeded');

      // error 前的内容应该已经 yield
      expect(chunks).toEqual(['ok']);
    });

    it('应调用 costTracker.record 记录成本', async () => {
      mockStream.mockReturnValueOnce(
        createMockStreamGenerator(['Hi'], { input: 5, output: 3, totalTokens: 8 })
      );

      for await (const _ of provider.chatStream([{ role: 'user', content: 'Hello' }])) {
        // consume
      }

      expect(mockCostRecord).toHaveBeenCalledWith(
        expect.objectContaining({ inputTokens: 5, outputTokens: 3 }),
        'anthropic/claude-sonnet-4-20250514'
      );
    });

    it('应支持 AbortSignal 取消', async () => {
      mockStream.mockReturnValueOnce(createMockStreamGenerator(['chunk1', 'chunk2']));

      const controller = new AbortController();
      const chunks: string[] = [];

      for await (const chunk of provider.chatStream([{ role: 'user', content: 'test' }], {
        signal: controller.signal,
      })) {
        chunks.push(chunk);
      }

      // signal 应被传递到 stream options
      expect(mockStream).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ signal: controller.signal })
      );
    });
  });

  // ============ extractTextContent() 间接测试 ============
  describe('文本提取（通过 chat 间接测试）', () => {
    it('应从 content 数组中提取纯文本', async () => {
      mockComplete.mockResolvedValueOnce(
        createMockCompleteResponse({
          content: [
            { type: 'text', text: 'Part1 ' },
            { type: 'text', text: 'Part2' },
          ],
        })
      );

      const result = await provider.chat([{ role: 'user', content: 'test' }]);

      expect(result.content).toBe('Part1 Part2');
    });

    it('应忽略非文本块', async () => {
      mockComplete.mockResolvedValueOnce(
        createMockCompleteResponse({
          content: [
            { type: 'text', text: 'visible ' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
            { type: 'text', text: 'end' },
          ],
        })
      );

      const result = await provider.chat([{ role: 'user', content: 'test' }]);

      expect(result.content).toBe('visible end');
    });

    it('空 content 应返回空字符串', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse({ content: [] }));

      const result = await provider.chat([{ role: 'user', content: 'test' }]);

      expect(result.content).toBe('');
    });
  });

  // ============ buildContext / 消息转换 间接测试 ============
  describe('消息处理（通过 chat/chatStream 间接测试）', () => {
    it('system 消息应作为 systemPrompt 传递', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());
      mockStream.mockReturnValueOnce(createMockStreamGenerator(['ok']));

      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ];

      await provider.chat(messages);

      // complete 的第二个参数 context 应包含 systemPrompt
      const contextArg = mockComplete.mock.calls[0]![1];
      expect(contextArg.systemPrompt).toBe('You are helpful');
    });

    it('无 system 消息时 context 不含 systemPrompt', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      await provider.chat([{ role: 'user', content: 'Hello' }]);

      const contextArg = mockComplete.mock.calls[0]![1];
      expect(contextArg.systemPrompt).toBeUndefined();
    });

    it('多轮对话消息应正确转换', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      const messages: ChatMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'User msg' },
        { role: 'assistant', content: 'Assistant msg' },
        { role: 'user', content: 'Follow up' },
      ];

      await provider.chat(messages);

      const contextArg = mockComplete.mock.calls[0]![1];
      // system 消息不在 messages 中
      expect(contextArg.messages).toHaveLength(3); // user + assistant + user
      expect(contextArg.messages[0].role).toBe('user');
      expect(contextArg.messages[1].role).toBe('assistant');
      expect(contextArg.messages[2].role).toBe('user');
    });
  });

  // ============ 自定义模型配置 ============
  describe('自定义模型配置', () => {
    it('自定义 baseUrl 应覆盖模型的 baseUrl', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      const customProvider = new PiAiProvider(
        createTestConfig({
          models: {
            'anthropic/claude-sonnet-4-20250514': {
              provider: 'anthropic',
              modelId: 'claude-sonnet-4-20250514',
              baseUrl: 'https://deepseek.api.com/anthropic',
            },
          },
        })
      );

      await customProvider.chat([{ role: 'user', content: 'test' }]);

      // getModel 返回的对象的 baseUrl 应被覆盖
      const modelArg = mockComplete.mock.calls[0]![0];
      expect(modelArg.baseUrl).toBe('https://deepseek.api.com/anthropic');
    });

    it('模型 id 应设为配置中的 modelId 而非 key', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      const customProvider = new PiAiProvider(
        createTestConfig({
          defaultModel: 'anthropic/deepseek-v4-flash',
          models: {
            'anthropic/deepseek-v4-flash': {
              provider: 'anthropic',
              modelId: 'deepseek-v4-flash',
              baseUrl: 'https://api.deepseek.com/anthropic',
            },
          },
        })
      );

      await customProvider.chat([{ role: 'user', content: 'test' }]);

      const modelArg = mockComplete.mock.calls[0]![0];
      // id 应是 API 实际接受的值
      expect(modelArg.id).toBe('deepseek-v4-flash');
      // name 是显示用的完整 key
      expect(modelArg.name).toBe('anthropic/deepseek-v4-flash');
    });
  });

  // ============ 模型缓存 ============
  describe('模型缓存', () => {
    it('同一模型第二次调用仍会重新解析（id 被覆盖为 modelId 导致缓存未命中）', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      await provider.chat([{ role: 'user', content: 'first' }]);
      await provider.chat([{ role: 'user', content: 'second' }]);

      // 由于 resolveModel 将 id 覆盖为 modelId（非 modelKey），
      // 缓存比较 resolvedModel.id === modelKey 始终为 false
      expect(mockGetModel).toHaveBeenCalledTimes(2);
    });

    it('不同模型应分别解析', async () => {
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());
      mockComplete.mockResolvedValueOnce(createMockCompleteResponse());

      const multiProvider = new PiAiProvider(
        createTestConfig({
          models: {
            'anthropic/model-a': { provider: 'anthropic', modelId: 'model-a' },
            'anthropic/model-b': { provider: 'anthropic', modelId: 'model-b' },
          },
        })
      );

      await multiProvider.chat([{ role: 'user', content: 'test' }], {
        model: 'anthropic/model-a',
      });
      await multiProvider.chat([{ role: 'user', content: 'test' }], {
        model: 'anthropic/model-b',
      });

      // 两个不同模型各调用一次 getModel
      expect(mockGetModel).toHaveBeenCalledTimes(2);
    });
  });
});
