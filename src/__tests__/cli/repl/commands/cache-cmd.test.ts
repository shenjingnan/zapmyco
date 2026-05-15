import chalk from 'chalk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCacheCommand } from '@/cli/repl/commands/cache-cmd';
import type { CommandDefinition } from '@/cli/repl/types';

describe('createCacheCommand', () => {
  let cmd: CommandDefinition;
  let appendOutput: ReturnType<typeof vi.fn>;
  let mockGetCacheStats: ReturnType<typeof vi.fn>;
  let mockGetSchemaStats: ReturnType<typeof vi.fn>;

  function mockSession(overrides?: {
    cacheStats?: Partial<{
      hitRate: number;
      averageCacheRatio: number;
      lastBreak: { broken: boolean; previousRead: number; currentRead: number } | null;
      totalCalls: number;
    }>;
    schemaStats?: { size: number; tools: string[] };
  }): unknown {
    return {
      agent: {
        getCacheStats: mockGetCacheStats.mockReturnValue({
          hitRate: 0,
          averageCacheRatio: 0,
          lastBreak: null,
          totalCalls: 0,
          ...overrides?.cacheStats,
        }),
        toolSchemaCache: {
          getStats: mockGetSchemaStats.mockReturnValue(
            overrides?.schemaStats ?? { size: 0, tools: [] }
          ),
        },
      },
      appendOutput,
    };
  }

  beforeEach(() => {
    chalk.level = 0;
    appendOutput = vi.fn();
    mockGetCacheStats = vi.fn();
    mockGetSchemaStats = vi.fn();
    cmd = createCacheCommand();
  });

  it('默认状态：全部为零、无 lastBreak、无 schema 缓存', async () => {
    await cmd.handler([], mockSession() as never);

    expect(appendOutput).toHaveBeenCalledTimes(1);
    const lines = appendOutput.mock.calls[0]?.[0] as string[];

    expect(lines[0]).toBe('');
    expect(lines[1]).toBe('  Prompt 缓存状态');
    expect(lines[2]).toContain('─'.repeat(40));
    expect(lines[3]).toContain('缓存命中率: N/A');
    expect(lines[4]).toContain('平均缓存读取比例: N/A');
    expect(lines[5]).toContain('总调用次数: 0');
    // 无断裂检测行
    expect(lines.find((l: string) => l.includes('断裂检测'))).toBeUndefined();
    // 无 schema 缓存行
    expect(lines.find((l: string) => l.includes('工具 Schema 缓存'))).toBeUndefined();
  });

  it('全命中状态 + 缓存断裂', async () => {
    await cmd.handler(
      [],
      mockSession({
        cacheStats: {
          hitRate: 1.0,
          averageCacheRatio: 0.9,
          lastBreak: { broken: true, previousRead: 8000, currentRead: 2000 },
          totalCalls: 5,
        },
      }) as never
    );

    const lines = appendOutput.mock.calls[0]?.[0] as string[];
    const output = lines.join('\n');

    expect(output).toContain('缓存命中率: 100.0%');
    expect(output).toContain('平均缓存读取比例: 90.0%');
    expect(output).toContain('总调用次数: 5');
    expect(output).toContain('断裂检测');
    expect(output).toContain('⚠ 检测到缓存断裂');
    expect(output).toContain('前次读取: 8.0K');
    expect(output).toContain('当前读取: 2.0K');
  });

  it('缓存断裂恢复状态', async () => {
    await cmd.handler(
      [],
      mockSession({
        cacheStats: {
          hitRate: 0.7,
          averageCacheRatio: 0.6,
          lastBreak: { broken: false, previousRead: 5000, currentRead: 4000 },
          totalCalls: 3,
        },
      }) as never
    );

    const lines = appendOutput.mock.calls[0]?.[0] as string[];
    const output = lines.join('\n');

    expect(output).toContain('断裂检测');
    expect(output).toContain('✓ 缓存正常');
    // broken=false 时不应出现前次/当前读取行
    expect(output).not.toContain('前次读取');
    expect(output).not.toContain('当前读取');
  });

  it('大数字格式化为 M/K', async () => {
    await cmd.handler(
      [],
      mockSession({
        cacheStats: {
          hitRate: 0.9,
          averageCacheRatio: 0.8,
          lastBreak: { broken: true, previousRead: 2000000, currentRead: 500000 },
          totalCalls: 1,
        },
      }) as never
    );

    const lines = appendOutput.mock.calls[0]?.[0] as string[];
    const output = lines.join('\n');

    expect(output).toContain('前次读取: 2.0M');
    expect(output).toContain('当前读取: 500.0K');
  });

  it('小数字保持原样', async () => {
    await cmd.handler(
      [],
      mockSession({
        cacheStats: {
          hitRate: 0.5,
          averageCacheRatio: 0.4,
          lastBreak: { broken: true, previousRead: 500, currentRead: 0 },
          totalCalls: 1,
        },
      }) as never
    );

    const lines = appendOutput.mock.calls[0]?.[0] as string[];
    const output = lines.join('\n');

    expect(output).toContain('前次读取: 500');
    expect(output).toContain('当前读取: 0');
  });

  it('formatPercent 不同区间输出', async () => {
    // 黄色区间 (0.5 < ratio <= 0.8)
    await cmd.handler(
      [],
      mockSession({
        cacheStats: {
          hitRate: 0.6,
          averageCacheRatio: 0.55,
          lastBreak: null,
          totalCalls: 0,
        },
      }) as never
    );

    let lines = appendOutput.mock.calls[0]?.[0] as string[];
    expect(lines[3]).toContain('60.0%');
    expect(lines[4]).toContain('55.0%');

    // 红色区间 (0 < ratio <= 0.5)
    appendOutput.mockClear();
    await cmd.handler(
      [],
      mockSession({
        cacheStats: {
          hitRate: 0.2,
          averageCacheRatio: 0.1,
          lastBreak: null,
          totalCalls: 0,
        },
      }) as never
    );

    lines = appendOutput.mock.calls[0]?.[0] as string[];
    expect(lines[3]).toContain('20.0%');
    expect(lines[4]).toContain('10.0%');
  });

  it('空 schema 缓存不显示', async () => {
    await cmd.handler(
      [],
      mockSession({
        schemaStats: { size: 0, tools: [] },
      }) as never
    );

    const lines = appendOutput.mock.calls[0]?.[0] as string[];
    expect(lines.find((l: string) => l.includes('工具 Schema 缓存'))).toBeUndefined();
  });

  it('有 schema 缓存时显示工具数量', async () => {
    await cmd.handler(
      [],
      mockSession({
        schemaStats: { size: 3, tools: ['tool-a', 'tool-b', 'tool-c'] },
      }) as never
    );

    const lines = appendOutput.mock.calls[0]?.[0] as string[];
    const schemaLine = lines.find((l: string) => l.includes('工具 Schema 缓存'));
    expect(schemaLine).toBeDefined();
    expect(schemaLine).toContain('3 个工具');
  });
});
