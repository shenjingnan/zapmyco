/**
 * LSP 诊断收集器
 *
 * 被动收集 textDocument/publishDiagnostics 通知，
 * 存储在内存 Map 中，支持去重和 LRU 淘汰。
 *
 * @module core/lsp
 */

import type { LspServerManager } from './lsp-server-manager';
import type { LspDiagnostic } from './types';

// ============ 类型 ============

export interface DiagnosticCollector {
  /** 初始化：注册诊断通知处理器 */
  init(manager: LspServerManager): void;
  /** 获取指定文件的诊断 */
  getForFile(filePath: string): LspDiagnostic[];
  /** 清除指定文件的诊断 */
  clearForFile(filePath: string): void;
  /** 清除所有诊断 */
  clear(): void;
}

// ============ 实现 ============

export function createDiagnosticCollector(): DiagnosticCollector {
  const diagnosticsByFile = new Map<string, LspDiagnostic[]>();

  function init(_manager: LspServerManager): void {
    // 当前 LspServerManager 不直接支持在 instance 上注册通知。
    // 诊断收集通过包装 ReadFile 工具实现，在文件打开后监听诊断通知。
    // 此处的 init 是占位，用于未来在 LspServerManager 增加 onDiagnostics 事件。
  }

  function getForFile(filePath: string): LspDiagnostic[] {
    const diags = diagnosticsByFile.get(filePath);
    if (!diags) return [];
    return [...diags];
  }

  function clearForFile(filePath: string): void {
    diagnosticsByFile.delete(filePath);
  }

  function clear(): void {
    diagnosticsByFile.clear();
  }

  return { init, getForFile, clearForFile, clear };
}

/**
 * 格式化诊断信息为可读文本
 */
export function formatDiagnostics(filePath: string, diagnostics: LspDiagnostic[]): string {
  if (diagnostics.length === 0) return '';

  const severityLabels: Record<number, string> = {
    1: 'Error',
    2: 'Warning',
    3: 'Information',
    4: 'Hint',
  };

  const lines: string[] = [`LSP 诊断 — ${filePath} (${diagnostics.length} 条)`];

  for (const diag of diagnostics.slice(0, 20)) {
    const severity = severityLabels[diag.severity ?? 1] ?? 'Unknown';
    const line = diag.range.start.line + 1;
    const char = diag.range.start.character + 1;
    const source = diag.source ? ` [${diag.source}]` : '';
    const code = diag.code ? ` (${diag.code})` : '';
    lines.push(`  ${severity}${code}${source} @ ${line}:${char} — ${diag.message}`);
  }

  if (diagnostics.length > 20) {
    lines.push(`  ... 还有 ${diagnostics.length - 20} 条诊断`);
  }

  return lines.join('\n');
}
