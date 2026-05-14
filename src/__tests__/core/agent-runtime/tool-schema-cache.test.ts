import { describe, expect, it } from 'vitest';
import { ToolSchemaCache } from '@/core/agent-runtime/tool-schema-cache';

describe('ToolSchemaCache', () => {
  it('getOrCompute 缓存未命中时计算并缓存', () => {
    const cache = new ToolSchemaCache();
    const result = cache.getOrCompute('tool-a', () => ({
      description: 'Tool A',
      parameters: { type: 'object' },
    }));

    expect(result).toEqual({
      name: 'tool-a',
      description: 'Tool A',
      parameters: { type: 'object' },
      hash: expect.any(String),
    });
  });

  it('getOrCompute 缓存命中时返回缓存值，不重复计算', () => {
    const cache = new ToolSchemaCache();
    cache.getOrCompute('tool-a', () => ({
      description: 'Tool A',
      parameters: { type: 'object' },
    }));

    // 第二次调用，compute 不应被执行
    const result = cache.getOrCompute('tool-a', () => {
      throw new Error('should not be called');
    });

    expect(result.description).toBe('Tool A');
    expect(result.parameters).toEqual({ type: 'object' });
  });

  it('getOrCompute 计算异常时异常传播，不被缓存', () => {
    const cache = new ToolSchemaCache();

    expect(() => {
      cache.getOrCompute('error-tool', () => {
        throw new Error('compute failed');
      });
    }).toThrow('compute failed');

    // 验证没有缓存任何内容
    expect(cache.getStats().size).toBe(0);
  });

  it('hasChanged 对于不存在的工具返回 true', () => {
    const cache = new ToolSchemaCache();
    expect(cache.hasChanged('unknown', { description: 'x', parameters: {} })).toBe(true);
  });

  it('hasChanged schema 未变化时返回 false', () => {
    const cache = new ToolSchemaCache();
    cache.getOrCompute('stable', () => ({
      description: 'Stable',
      parameters: { foo: 'bar' },
    }));

    expect(cache.hasChanged('stable', { description: 'Stable', parameters: { foo: 'bar' } })).toBe(
      false
    );
  });

  it('hasChanged description 变化时返回 true', () => {
    const cache = new ToolSchemaCache();
    cache.getOrCompute('changing', () => ({
      description: 'Original',
      parameters: { foo: 'bar' },
    }));

    expect(cache.hasChanged('changing', { description: 'Changed', parameters: { foo: 'bar' } })).toBe(
      true
    );
  });

  it('hasChanged parameters 变化时返回 true', () => {
    const cache = new ToolSchemaCache();
    cache.getOrCompute('changing', () => ({
      description: 'Stable',
      parameters: { foo: 'bar' },
    }));

    expect(
      cache.hasChanged('changing', { description: 'Stable', parameters: { bar: 'baz' } })
    ).toBe(true);
  });

  it('clear 清空缓存，后续 getOrCompute 重新计算', () => {
    const cache = new ToolSchemaCache();
    cache.getOrCompute('tool-a', () => ({
      description: 'Tool A',
      parameters: { type: 'object' },
    }));
    cache.getOrCompute('tool-b', () => ({
      description: 'Tool B',
      parameters: { type: 'string' },
    }));

    expect(cache.getStats().size).toBe(2);

    cache.clear();

    expect(cache.getStats().size).toBe(0);

    // 清空后应重新计算
    const result = cache.getOrCompute('tool-a', () => ({
      description: 'Tool A New',
      parameters: { type: 'number' },
    }));
    expect(result.description).toBe('Tool A New');
    expect(cache.getStats().size).toBe(1);
  });

  it('getStats 正确反映缓存状态', () => {
    const cache = new ToolSchemaCache();
    cache.getOrCompute('a', () => ({ description: 'A', parameters: {} }));
    cache.getOrCompute('b', () => ({ description: 'B', parameters: {} }));

    const stats = cache.getStats();
    expect(stats.size).toBe(2);
    expect(stats.tools).toEqual(['a', 'b']);
  });
});
