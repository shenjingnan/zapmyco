/**
 * LSP 代码智能工具
 *
 * 为 Agent 提供语义级代码理解能力：
 * - goToDefinition: 跳转到定义
 * - findReferences: 查找引用
 * - hover: 悬停信息
 * - documentSymbol: 文档符号
 * - workspaceSymbol: 工作区符号
 * - goToImplementation: 跳转到实现
 * - prepareCallHierarchy: 准备调用层次
 * - incomingCalls: 传入调用
 * - outgoingCalls: 传出调用
 *
 * @module cli/repl/tools/lsp-tool
 */

import type { ToolRegistration } from '@/core/agent-runtime';
import type { LspServerManager } from '@/core/lsp/lsp-server-manager';
import type {
  LspCallHierarchyItem,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspWorkspaceSymbol,
} from '@/core/lsp/types';
import { SYMBOL_KIND_NAMES } from '@/core/lsp/types';
import { resolveWorktreePath } from '@/core/worktree/worktree-context';

// ============ 类型 ============

/** LSP 操作类型 */
type LspOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol'
  | 'goToImplementation'
  | 'prepareCallHierarchy'
  | 'incomingCalls'
  | 'outgoingCalls';

/** LSP 工具参数 */
interface LspToolParams {
  operation: LspOperation;
  filePath: string;
  line?: number;
  character?: number;
  query?: string;
}

// ============ 操作映射 ============

/** 操作 → LSP 方法 */
const METHOD_MAP: Record<LspOperation, string> = {
  goToDefinition: 'textDocument/definition',
  findReferences: 'textDocument/references',
  hover: 'textDocument/hover',
  documentSymbol: 'textDocument/documentSymbol',
  workspaceSymbol: 'workspace/symbol',
  goToImplementation: 'textDocument/implementation',
  prepareCallHierarchy: 'textDocument/prepareCallHierarchy',
  incomingCalls: 'callHierarchy/incomingCalls',
  outgoingCalls: 'callHierarchy/outgoingCalls',
};

/**
 * 需要两步调用（先 prepareCallHierarchy）的操作
 */
const TWO_STEP_OPS: Set<string> = new Set(['incomingCalls', 'outgoingCalls']);

/**
 * 需要位置参数的操作
 */
const POSITION_REQUIRED_OPS: Set<string> = new Set([
  'goToDefinition',
  'findReferences',
  'hover',
  'goToImplementation',
  'prepareCallHierarchy',
  'incomingCalls',
  'outgoingCalls',
]);

/**
 * 不需要 filePath 的操作
 */
const NO_FILEPATH_OPS: Set<string> = new Set(['workspaceSymbol']);

// ============ 结果格式化 ============

function formatLocation(loc: LspLocation | LspLocationLink): string {
  if ('targetUri' in loc) {
    // LocationLink
    const path = loc.targetUri.replace(/^file:\/\//, '');
    const line = loc.targetRange.start.line + 1;
    const char = loc.targetRange.start.character + 1;
    return `${path}:${line}:${char}`;
  }
  // Location
  const path = loc.uri.replace(/^file:\/\//, '');
  const line = loc.range.start.line + 1;
  const char = loc.range.start.character + 1;
  return `${path}:${line}:${char}`;
}

function formatHoverContent(contents: LspHover['contents']): string {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === 'string' ? c : `\`\`\`${c.language}\n${c.value}\n\`\`\``))
      .join('\n');
  }
  if (typeof contents === 'object' && 'kind' in contents) {
    return contents.value;
  }
  return JSON.stringify(contents, null, 2);
}

function formatDocumentSymbol(symbols: LspDocumentSymbol[], indent = 0): string {
  const prefix = '  '.repeat(indent);
  const lines: string[] = [];

  for (const sym of symbols) {
    const kind = SYMBOL_KIND_NAMES[sym.kind] ?? `Kind(${sym.kind})`;
    const detail = sym.detail ? `: ${sym.detail}` : '';
    const line = sym.selectionRange.start.line + 1;
    const char = sym.selectionRange.start.character + 1;
    const deprecated = sym.deprecated ? ' [deprecated]' : '';

    lines.push(`${prefix}${kind} ${sym.name}${detail} @ ${line}:${char}${deprecated}`);

    if (sym.children && sym.children.length > 0) {
      lines.push(...formatDocumentSymbol(sym.children, indent + 1));
    }
  }

  return lines.join('\n');
}

function formatWorkspaceSymbol(symbols: LspWorkspaceSymbol[]): string {
  const lines: string[] = [];

  for (const sym of symbols) {
    const kind = SYMBOL_KIND_NAMES[sym.kind] ?? `Kind(${sym.kind})`;
    const path = sym.location.uri.replace(/^file:\/\//, '');
    const line = sym.location.range.start.line + 1;
    const char = sym.location.range.start.character + 1;
    const container = sym.containerName ? ` (in ${sym.containerName})` : '';

    lines.push(`${kind} ${sym.name}${container} — ${path}:${line}:${char}`);
  }

  return lines.join('\n');
}

function formatCallHierarchyItem(item: LspCallHierarchyItem): string {
  const kind = SYMBOL_KIND_NAMES[item.kind] ?? `Kind(${item.kind})`;
  const path = item.uri.replace(/^file:\/\//, '');
  const line = item.selectionRange.start.line + 1;
  const char = item.selectionRange.start.character + 1;
  const detail = item.detail ? `: ${item.detail}` : '';

  return `${kind} ${item.name}${detail} — ${path}:${line}:${char}`;
}

// ============ 工具创建 ============

export function createLspTool(lspManager: LspServerManager): ToolRegistration {
  return {
    id: 'LSP',
    label: 'LSP 代码智能',
    description:
      '使用 Language Server Protocol 进行代码智能操作。支持：' +
      'goToDefinition(跳转到定义)、findReferences(查找引用)、hover(悬停信息)、' +
      'documentSymbol(文档符号)、workspaceSymbol(工作区符号)、' +
      'goToImplementation(跳转到实现)、prepareCallHierarchy(准备调用层次)、' +
      'incomingCalls(传入调用)、outgoingCalls(传出调用)。' +
      '所有操作都需要 filePath(绝对路径)、line(1-based)、character(1-based) 参数。' +
      'LSP 服务器必须已配置才能使用此工具。',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: [
            'goToDefinition',
            'findReferences',
            'hover',
            'documentSymbol',
            'workspaceSymbol',
            'goToImplementation',
            'prepareCallHierarchy',
            'incomingCalls',
            'outgoingCalls',
          ],
          description: '要执行的 LSP 操作',
        },
        filePath: {
          type: 'string',
          description: '文件绝对路径或相对路径（workspaceSymbol 操作不需要）',
        },
        line: {
          type: 'number',
          description: '行号（1-based，与编辑器一致。位置相关操作需要）',
        },
        character: {
          type: 'number',
          description: '字符偏移（1-based，与编辑器一致。位置相关操作需要）',
        },
      },
      required: ['operation', 'filePath', 'line', 'character'],
    },
    defaultRisk: 'low',
    // biome-ignore lint/suspicious/noExplicitAny: ToolRegistration execute 参数类型为 unknown
    execute: async (_toolCallId: string, rawParams: any) => {
      const startTime = Date.now();
      const { operation, filePath, line, character } = rawParams as LspToolParams;

      // 参数验证
      if (!NO_FILEPATH_OPS.has(operation) && !filePath) {
        return {
          content: [{ type: 'text', text: '错误：需要 filePath 参数' }],
          details: { error: true, message: 'filePath required' },
        };
      }

      if (POSITION_REQUIRED_OPS.has(operation)) {
        if (line == null || character == null) {
          return {
            content: [{ type: 'text', text: `错误：${operation} 需要 line 和 character 参数` }],
            details: { error: true, message: 'position required' },
          };
        }
      }

      try {
        // Worktree 路径映射
        const resolvedPath = NO_FILEPATH_OPS.has(operation)
          ? process.cwd()
          : resolveWorktreePath(filePath);

        const lspMethod = METHOD_MAP[operation];

        // callHierarchy 两步调用
        if (TWO_STEP_OPS.has(operation)) {
          // Step 1: prepareCallHierarchy
          const items = await lspManager.request<LspCallHierarchyItem[]>(
            resolvedPath,
            'textDocument/prepareCallHierarchy',
            {
              textDocument: { uri: `file://${resolvedPath}` },
              position: { line: (line ?? 1) - 1, character: (character ?? 1) - 1 },
            }
          );

          const firstItem = items?.[0];
          if (!items || items.length === 0 || !firstItem) {
            return {
              content: [{ type: 'text', text: '未找到调用层次项' }],
              details: {
                operation,
                filePath: resolvedPath,
                resultCount: 0,
                elapsedMs: Date.now() - startTime,
              },
            };
          }

          // Step 2: incomingCalls / outgoingCalls
          const results = await lspManager.request<unknown[]>(resolvedPath, lspMethod, {
            item: firstItem,
          });

          const elapsedMs = Date.now() - startTime;
          const callResults = results ?? [];

          if (operation === 'incomingCalls') {
            const calls = callResults as Array<{
              from: LspCallHierarchyItem;
              fromRanges: unknown[];
            }>;
            const formatted = calls
              .map((c) => `← ${formatCallHierarchyItem(c.from)} (${c.fromRanges.length} 处调用)`)
              .join('\n');
            return {
              content: [
                {
                  type: 'text',
                  text: `传入调用 — ${formatCallHierarchyItem(firstItem)}\n\n${formatted || '无传入调用'}`,
                },
              ],
              details: { operation, filePath: resolvedPath, resultCount: calls.length, elapsedMs },
            };
          }

          // outgoingCalls
          const calls = callResults as Array<{ to: LspCallHierarchyItem; fromRanges: unknown[] }>;
          const formatted = calls
            .map((c) => `→ ${formatCallHierarchyItem(c.to)} (${c.fromRanges.length} 处调用)`)
            .join('\n');
          return {
            content: [
              {
                type: 'text',
                text: `传出调用 — ${formatCallHierarchyItem(firstItem)}\n\n${formatted || '无传出调用'}`,
              },
            ],
            details: { operation, filePath: resolvedPath, resultCount: calls.length, elapsedMs },
          };
        }

        // 单步调用
        const methodParams: Record<string, unknown> = {};

        if (operation === 'workspaceSymbol') {
          methodParams.query = rawParams.query ?? '';
        } else if (operation === 'documentSymbol') {
          methodParams.textDocument = { uri: `file://${resolvedPath}` };
        } else if (operation === 'findReferences') {
          methodParams.textDocument = { uri: `file://${resolvedPath}` };
          methodParams.position = { line: (line ?? 1) - 1, character: (character ?? 1) - 1 };
          methodParams.context = { includeDeclaration: true };
        } else {
          methodParams.textDocument = { uri: `file://${resolvedPath}` };
          methodParams.position = { line: (line ?? 1) - 1, character: (character ?? 1) - 1 };
        }

        const result = await lspManager.request<unknown>(resolvedPath, lspMethod, methodParams);
        const elapsedMs = Date.now() - startTime;

        // 格式化结果
        switch (operation) {
          case 'goToDefinition':
          case 'goToImplementation': {
            const locations = (result ?? []) as Array<LspLocation | LspLocationLink>;
            const formatted = locations.map(formatLocation).join('\n');
            return {
              content: [
                {
                  type: 'text',
                  text: `${operation === 'goToDefinition' ? '定义' : '实现'} (${locations.length} 处)\n\n${formatted || '无结果'}`,
                },
              ],
              details: {
                operation,
                filePath: resolvedPath,
                resultCount: locations.length,
                elapsedMs,
              },
            };
          }

          case 'findReferences': {
            const refs = (result ?? []) as LspLocation[];
            const formatted = refs.map(formatLocation).join('\n');
            return {
              content: [
                {
                  type: 'text',
                  text: `引用 (${refs.length} 处)\n\n${formatted || '无引用'}`,
                },
              ],
              details: { operation, filePath: resolvedPath, resultCount: refs.length, elapsedMs },
            };
          }

          case 'hover': {
            const hover = result as LspHover | null;
            if (!hover?.contents) {
              return {
                content: [{ type: 'text', text: '无悬停信息' }],
                details: { operation, filePath: resolvedPath, resultCount: 0, elapsedMs },
              };
            }
            const formatted = formatHoverContent(hover.contents);
            return {
              content: [{ type: 'text', text: formatted }],
              details: { operation, filePath: resolvedPath, resultCount: 1, elapsedMs },
            };
          }

          case 'documentSymbol': {
            const symbols = (result ?? []) as LspDocumentSymbol[];
            if (symbols.length === 0) {
              return {
                content: [{ type: 'text', text: '无文档符号' }],
                details: { operation, filePath: resolvedPath, resultCount: 0, elapsedMs },
              };
            }
            const formatted = formatDocumentSymbol(symbols);
            return {
              content: [
                {
                  type: 'text',
                  text: `文档符号 (${symbols.length} 个顶层)\n\n${formatted}`,
                },
              ],
              details: {
                operation,
                filePath: resolvedPath,
                resultCount: symbols.length,
                elapsedMs,
              },
            };
          }

          case 'workspaceSymbol': {
            const symbols = (result ?? []) as LspWorkspaceSymbol[];
            if (symbols.length === 0) {
              return {
                content: [{ type: 'text', text: '未找到工作区符号' }],
                details: { operation, resultCount: 0, elapsedMs },
              };
            }
            const formatted = formatWorkspaceSymbol(symbols);
            return {
              content: [
                {
                  type: 'text',
                  text: `工作区符号 (${symbols.length} 个)\n\n${formatted}`,
                },
              ],
              details: { operation, resultCount: symbols.length, elapsedMs },
            };
          }

          case 'prepareCallHierarchy': {
            const items = (result ?? []) as LspCallHierarchyItem[];
            if (items.length === 0) {
              return {
                content: [{ type: 'text', text: '未找到调用层次项' }],
                details: { operation, filePath: resolvedPath, resultCount: 0, elapsedMs },
              };
            }
            const formatted = items.map(formatCallHierarchyItem).join('\n');
            return {
              content: [
                {
                  type: 'text',
                  text: `调用层次 (${items.length} 项)\n\n${formatted}`,
                },
              ],
              details: { operation, filePath: resolvedPath, resultCount: items.length, elapsedMs },
            };
          }

          default:
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              details: { operation, filePath: resolvedPath, elapsedMs },
            };
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `LSP 操作失败: ${errorMsg}` }],
          details: { error: true, operation, filePath, message: errorMsg },
        };
      }
    },
  };
}
