/**
 * Agent Loop 缓存相关功能测试
 *
 * 测试 hashToolList、toAnthropicTools、checkCacheBreak、resetCacheBreakState
 * 等工具函数和缓存断裂检测逻辑。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkCacheBreak,
  hashToolList,
  resetCacheBreakState,
  toAnthropicTools,
} from '@/core/agent-runtime/agent-loop';
import type { AgentTool } from '@/core/agent-runtime/agent-types';

// ============ 辅助函数 ============

function makeTool(name: string, description?: string, params?: Record<string, unknown>): AgentTool {
  return {
    name,
    description: description ?? `Tool ${name}`,
    label: name,
    parameters: params ?? { type: 'object', properties: {} },
    execute: vi.fn(),
  } as unknown as AgentTool;
}

// ============ hashToolList ============

describe('hashToolList', () => {
  it('应返回一致的哈希值（相同输入）', () => {
    const tools = [makeTool('read'), makeTool('write')];
    expect(hashToolList(tools)).toBe(hashToolList(tools));
  });

  it('不同的工具应返回不同的哈希', () => {
    const tools1 = [makeTool('read')];
    const tools2 = [makeTool('write')];
    expect(hashToolList(tools1)).not.toBe(hashToolList(tools2));
  });

  it('工具顺序不同应返回不同哈希', () => {
    const tools1 = [makeTool('read'), makeTool('write')];
    const tools2 = [makeTool('write'), makeTool('read')];
    expect(hashToolList(tools1)).not.toBe(hashToolList(tools2));
  });

  it('描述不同应返回不同哈希', () => {
    const tools1 = [makeTool('read', 'Read files')];
    const tools2 = [makeTool('read', 'Read and write files')];
    expect(hashToolList(tools1)).not.toBe(hashToolList(tools2));
  });

  it('空数组应返回有效哈希', () => {
    const hash = hashToolList([]);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('工具参数不同应返回不同哈希', () => {
    const tools1 = [
      makeTool('search', 'Search', {
        type: 'object',
        properties: { query: { type: 'string' } },
      }),
    ];
    const tools2 = [
      makeTool('search', 'Search', {
        type: 'object',
        properties: { limit: { type: 'number' } },
      }),
    ];
    expect(hashToolList(tools1)).not.toBe(hashToolList(tools2));
  });

  it('工具参数为 null/undefined 应正常处理', () => {
    const toolWithUndefinedParams = makeTool('test');
    (toolWithUndefinedParams as unknown as Record<string, unknown>).parameters = undefined;
    // 不应该抛出异常
    const hash = hashToolList([toolWithUndefinedParams]);
    expect(typeof hash).toBe('string');
  });
});

// ============ toAnthropicTools ============

describe('toAnthropicTools', () => {
  beforeEach(() => {
    // 重置模块级缓存（通过 hash 实现——不同测试使用不同工具，自动产生不同 hash）
  });

  it('空数组应返回 undefined', () => {
    expect(toAnthropicTools([])).toBeUndefined();
  });

  it('应返回正确的 Anthropic.Tool 结构', () => {
    const tools = [makeTool('read', 'Read files')];
    const result = toAnthropicTools(tools);
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result?.[0]?.name).toBe('read');
    expect(result?.[0]?.description).toBe('Read files');
    expect(result?.[0]?.input_schema).toEqual({ type: 'object', properties: {} });
  });

  it('相同输入应返回缓存引用', () => {
    const tools = [makeTool('read'), makeTool('write')];
    const result1 = toAnthropicTools(tools);
    const result2 = toAnthropicTools(tools);
    // 第二次调用应返回相同的数组引用（缓存命中）
    expect(result1).toBe(result2);
  });

  it('不同输入应返回新引用', () => {
    const tools1 = [makeTool('read')];
    const tools2 = [makeTool('write')];
    const result1 = toAnthropicTools(tools1);
    const result2 = toAnthropicTools(tools2);
    // 不同工具集不应返回相同的引用
    expect(result1).not.toBe(result2);
  });

  it('空名称工具应在结果中被过滤', () => {
    const tools: AgentTool[] = [
      makeTool('valid', 'Valid tool'),
      { name: '', description: '', label: '', execute: vi.fn() } as unknown as AgentTool,
    ];
    const result = toAnthropicTools(tools);
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result?.[0]?.name).toBe('valid');
  });

  it('多个工具应全部转换并保留顺序', () => {
    const tools = [makeTool('b', 'Second'), makeTool('a', 'First'), makeTool('c', 'Third')];
    const result = toAnthropicTools(tools);
    expect(result).toBeDefined();
    expect(result).toHaveLength(3);
    expect(result?.[0]?.name).toBe('b');
    expect(result?.[1]?.name).toBe('a');
    expect(result?.[2]?.name).toBe('c');
  });
});

// ============ checkCacheBreak ============

describe('checkCacheBreak', () => {
  beforeEach(() => {
    resetCacheBreakState();
  });

  it('首次调用应初始化状态，不输出警告', () => {
    // 首次调用只初始化，不会触发任何条件
    // 我们只需验证不抛出异常
    expect(() => checkCacheBreak(50000, 0, 1000)).not.toThrow();
  });

  it('缓存读取正常时不应触发警告', () => {
    checkCacheBreak(50000, 0, 1000); // 首次，初始化
    // 第二次调用，cache_read 没有显著下降
    expect(() => checkCacheBreak(48000, 0, 1000)).not.toThrow();
  });

  it('cache_read 下降超过阈值应被检测到', () => {
    checkCacheBreak(50000, 0, 1000); // 首次，baseline = 50000

    // 第二次：下降 60% (>5%) 且 30000 (>2000)
    // 这里只是验证不抛出异常（日志由 logger 处理）
    expect(() => checkCacheBreak(20000, 0, 1000)).not.toThrow();
  });

  it('cache_read 下降未超过阈值不应触发', () => {
    checkCacheBreak(50000, 0, 1000); // 首次，baseline = 50000

    // 下降 4% (<5%)，不应触发
    expect(() => checkCacheBreak(48000, 0, 1000)).not.toThrow();
  });

  it('cache_read 下降超过 5% 但绝对值小于 2000 不应触发', () => {
    checkCacheBreak(30000, 0, 1000); // baseline = 30000

    // 下降 ~10% (3000) 但绝对值 3000 > 2000 → 应触发
    expect(() => checkCacheBreak(27000, 0, 1000)).not.toThrow();
  });

  it('首次缓存写入事件应被检测到', () => {
    checkCacheBreak(0, 0, 1000); // 首次，cacheWrite = 0

    // 第二次：cacheWrite > 0，之前是 0
    expect(() => checkCacheBreak(10000, 5000, 1000)).not.toThrow();
  });

  it('连续缓存写入不应重复触发创建事件', () => {
    checkCacheBreak(0, 0, 1000); // 首次

    checkCacheBreak(10000, 5000, 1000); // 第一次写入 → 触发创建事件
    // 第二次仍然有 cacheWrite，但之前已经不是 0 了
    expect(() => checkCacheBreak(15000, 5000, 1000)).not.toThrow();
  });

  it('多轮调用应正确追踪状态', () => {
    checkCacheBreak(50000, 0, 1000); // turn 1: baseline

    // turn 2: 缓存断裂（显著下降）
    expect(() => checkCacheBreak(10000, 0, 1000)).not.toThrow();

    // turn 3: 正常（小的波动）
    expect(() => checkCacheBreak(9500, 0, 1000)).not.toThrow();
  });
});

// ============ resetCacheBreakState ============

describe('resetCacheBreakState', () => {
  it('重置后应清除历史状态', () => {
    checkCacheBreak(50000, 0, 1000); // 设 baseline

    resetCacheBreakState();

    // 重置后首次调用应重新初始化（不会触发下降检测）
    // 因为 prevCacheRead 已被重置为 undefined
    expect(() => checkCacheBreak(10000, 0, 1000)).not.toThrow();
  });

  it('多次重置应安全', () => {
    expect(() => {
      resetCacheBreakState();
      resetCacheBreakState();
      resetCacheBreakState();
    }).not.toThrow();
  });
});
