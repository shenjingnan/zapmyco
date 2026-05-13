/**
 * LSP diagnostics 测试
 */
import { describe, expect, it } from 'vitest';
import { createDiagnosticCollector, formatDiagnostics } from '@/core/lsp/diagnostics';
import type { LspDiagnostic } from '@/core/lsp/types';

function makeDiag(overrides: Partial<LspDiagnostic> = {}): LspDiagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 10 },
    },
    severity: 1,
    message: 'Test error',
    ...overrides,
  };
}

describe('createDiagnosticCollector', () => {
  it('应返回具有 init/getForFile/clearForFile/clear 方法的对象', () => {
    const collector = createDiagnosticCollector();
    expect(collector.init).toBeDefined();
    expect(collector.getForFile).toBeDefined();
    expect(collector.clearForFile).toBeDefined();
    expect(collector.clear).toBeDefined();
  });

  it('getForFile 空文件应返回空数组', () => {
    const collector = createDiagnosticCollector();
    expect(collector.getForFile('/test.ts')).toEqual([]);
  });

  it('clearForFile 不应抛异常', () => {
    const collector = createDiagnosticCollector();
    expect(() => collector.clearForFile('/test.ts')).not.toThrow();
  });

  it('clear 不应抛异常', () => {
    const collector = createDiagnosticCollector();
    expect(() => collector.clear()).not.toThrow();
  });
});

describe('formatDiagnostics', () => {
  it('空诊断应返回空字符串', () => {
    expect(formatDiagnostics('/test.ts', [])).toBe('');
  });

  it('应格式化错误级别诊断', () => {
    const diags = [makeDiag({ severity: 1, message: 'Type error', source: 'ts', code: 2322 })];
    const result = formatDiagnostics('/file.ts', diags);
    expect(result).toContain('LSP 诊断 — /file.ts (1 条)');
    expect(result).toContain('Error');
    expect(result).toContain('2322');
    expect(result).toContain('[ts]');
    expect(result).toContain('Type error');
  });

  it('应格式化警告级别诊断', () => {
    const diags = [makeDiag({ severity: 2, message: 'Unused var' })];
    const result = formatDiagnostics('/file.ts', diags);
    expect(result).toContain('Warning');
  });

  it('应格式化信息级别诊断', () => {
    const diags = [makeDiag({ severity: 3, message: 'Info msg' })];
    const result = formatDiagnostics('/file.ts', diags);
    expect(result).toContain('Information');
  });

  it('应格式化 Hint 级别诊断', () => {
    const diags = [makeDiag({ severity: 4, message: 'Hint msg' })];
    const result = formatDiagnostics('/file.ts', diags);
    expect(result).toContain('Hint');
  });

  it('未知 severity 应显示 Unknown', () => {
    const diags = [makeDiag({ severity: 99 as never, message: 'Unknown severity' })];
    const result = formatDiagnostics('/file.ts', diags);
    expect(result).toContain('Unknown');
  });

  it('应截断超过 20 条诊断', () => {
    const diags = Array.from({ length: 25 }, (_, i) => makeDiag({ message: `Error ${i}` }));
    const result = formatDiagnostics('/file.ts', diags);
    expect(result).toContain('25 条');
    expect(result).toContain('... 还有 5 条诊断');
  });

  it('恰好 20 条诊断不应截断', () => {
    const diags = Array.from({ length: 20 }, (_, i) => makeDiag({ message: `Error ${i}` }));
    const result = formatDiagnostics('/file.ts', diags);
    expect(result).toContain('20 条');
    expect(result).not.toContain('还有');
  });

  it('无 source 和 code 的诊断', () => {
    const diags = [makeDiag({ severity: 1, message: 'Bare error' })];
    // 确保 source 和 code 未定义
    delete diags[0]!.source;
    delete diags[0]!.code;
    const result = formatDiagnostics('/file.ts', diags);
    expect(result).toContain('Bare error');
    expect(result).not.toContain('[');
  });
});
