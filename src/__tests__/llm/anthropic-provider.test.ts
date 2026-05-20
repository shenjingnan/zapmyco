import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// 使用 vi.hoisted 定义 mock 函数，确保它们在 vi.mock 工厂被调用前已初始化
// ---------------------------------------------------------------------------
const { mockCreate, mockStreamFn, mockGetClient } = vi.hoisted(() => {
  const mockCreate = vi.fn();

  const mockStream: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: true, value: undefined };
        },
      };
    },
  };

  const mockStreamFn = vi.fn<(...args: any[]) => any>(() => mockStream);
  const mockGetClient = vi.fn(() => ({
    messages: { create: mockCreate, stream: mockStreamFn },
  }));

  return { mockCreate, mockStreamFn, mockGetClient };
});

// ---------------------------------------------------------------------------
// Mock client-manager
// ---------------------------------------------------------------------------
vi.mock('@/llm/client-manager', () => ({ getClient: mockGetClient }));

// ---------------------------------------------------------------------------
// 导入被测试模块
// ---------------------------------------------------------------------------
import { complete, streamComplete } from '@/llm/anthropic-provider';
import type { ResolvedModel } from '@/llm/provider-types';

// ---------------------------------------------------------------------------
// 测试数据
// ---------------------------------------------------------------------------
const mockModel: ResolvedModel = {
  id: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
  baseURL: 'https://api.anthropic.com',
  apiKey: 'sk-ant-xxx',
};

const mockParams = {
  messages: [{ role: 'user' as const, content: 'Hello' }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该用 model.baseURL 和 model.apiKey 获取客户端，并调用 messages.create', async () => {
    mockCreate.mockResolvedValue({ id: 'msg-1', content: [] });

    await complete(mockModel, mockParams);

    expect(mockGetClient).toHaveBeenCalledWith(mockModel.baseURL, mockModel.apiKey);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const [firstArg] = mockCreate.mock.calls[0]!;
    expect(firstArg).toMatchObject({
      model: mockModel.id,
      max_tokens: 4096,
      messages: mockParams.messages,
    });
  });

  it('传递 systemPrompt 时，create 参数应包含 system 字段', async () => {
    mockCreate.mockResolvedValue({ id: 'msg-2', content: [] });

    await complete(mockModel, { ...mockParams, systemPrompt: 'You are helpful.' });

    const [firstArg] = mockCreate.mock.calls[0]!;
    expect(firstArg).toHaveProperty('system', 'You are helpful.');
  });

  it('不传 systemPrompt 时，create 参数不应包含 system 字段', async () => {
    mockCreate.mockResolvedValue({ id: 'msg-3', content: [] });

    await complete(mockModel, mockParams);

    const [firstArg] = mockCreate.mock.calls[0]!;
    expect(firstArg).not.toHaveProperty('system');
  });

  it('传递 temperature 时，create 参数应包含 temperature', async () => {
    mockCreate.mockResolvedValue({ id: 'msg-4', content: [] });

    await complete(mockModel, mockParams, { temperature: 0.7 });

    const [firstArg] = mockCreate.mock.calls[0]!;
    expect(firstArg).toHaveProperty('temperature', 0.7);
  });

  it('不传 temperature 时，create 参数不应包含 temperature', async () => {
    mockCreate.mockResolvedValue({ id: 'msg-5', content: [] });

    await complete(mockModel, mockParams);

    const [firstArg] = mockCreate.mock.calls[0]!;
    expect(firstArg).not.toHaveProperty('temperature');
  });

  it('传递 signal 时，应作为第二个参数（options）传递', async () => {
    mockCreate.mockResolvedValue({ id: 'msg-6', content: [] });
    const controller = new AbortController();

    await complete(mockModel, mockParams, { signal: controller.signal });

    const [, secondArg] = mockCreate.mock.calls[0]!;
    expect(secondArg).toEqual({ signal: controller.signal });
  });

  it('自定义 maxTokens 时，应使用自定义值而非默认 4096', async () => {
    mockCreate.mockResolvedValue({ id: 'msg-7', content: [] });

    await complete(mockModel, mockParams, { maxTokens: 1024 });

    const [firstArg] = mockCreate.mock.calls[0]!;
    expect(firstArg).toHaveProperty('max_tokens', 1024);
  });

  it('应返回 client.messages.create() 的结果', async () => {
    const expected = { id: 'msg-8', content: [{ type: 'text', text: 'Hi!' }] };
    mockCreate.mockResolvedValue(expected);

    const result = await complete(mockModel, mockParams);

    expect(result).toBe(expected);
  });
});

describe('streamComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应调用 messages.stream() 而非 create()，传递 stream: true，并返回 stream 对象', () => {
    const result = streamComplete(mockModel, mockParams);

    // 验证 getClient 被调用
    expect(mockGetClient).toHaveBeenCalledWith(mockModel.baseURL, mockModel.apiKey);

    // 验证调用的是 stream 而非 create
    expect(mockStreamFn).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();

    // 验证 stream 参数
    const firstArg = mockStreamFn.mock.calls[0]?.[0];
    expect(firstArg).toMatchObject({
      model: mockModel.id,
      max_tokens: 4096,
      stream: true,
      messages: mockParams.messages,
    });

    // 验证返回 mockStream
    expect(result).toBe(mockStreamFn.mock.results[0]!.value);
  });
});
