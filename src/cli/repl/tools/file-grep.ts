/**
 * grep 工具实现 — 文件内容搜索
 *
 * 功能：
 * - 正则表达式搜索文件内容
 * - 支持 output_mode: content / files_with_matches / count
 * - 支持上下文行（-A/-B/-C）
 * - 支持 glob 文件过滤
 * - 结果数量限制
 *
 * 参考 Claude Code GrepTool 的设计。
 *
 * @module cli/repl/tools/file-grep
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ============ 类型定义 ============

/** grep 工具参数 */
export interface GrepParams {
  /** 正则表达式搜索模式 */
  pattern: string;
  /** 搜索范围目录（可选） */
  path?: string;
  /** 文件过滤 glob（可选，如 "*.ts"） */
  glob?: string;
  /** 输出模式 */
  output_mode?: 'content' | 'files_with_matches' | 'count';
  /** 上下文行数（显示匹配行前后 N 行） */
  context?: number;
  /** 匹配行之前额外行数 */
  '-B'?: number;
  /** 匹配行之后额外行数 */
  '-A'?: number;
  /** 忽略大小写 */
  '-i'?: boolean;
}

/** grep 返回详情 */
export interface GrepDetails {
  pattern: string;
  matchCount: number;
  fileCount: number;
  searchPath: string;
  truncated: boolean;
  outputMode: string;
  error?: string;
  elapsedMs?: number;
}

// ============ grep 实现 ============

/**
 * 收集搜索范围内的所有文件
 */
function collectFiles(searchPath: string, fileGlob?: string): string[] {
  const { readdirSync, statSync } = require('node:fs');
  const { join } = require('node:path');
  const results: string[] = [];
  const maxFiles = 2000;

  // 构建 glob 正则
  let globRegex: RegExp | null = null;
  if (fileGlob) {
    const regexStr = fileGlob
      .replace(/\\/g, '/')
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<GLOBSTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/<<<GLOBSTAR>>>/g, '.*');
    globRegex = new RegExp(`^${regexStr}$`);
  }

  function walk(dir: string) {
    if (results.length >= maxFiles) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxFiles) return;

        if (entry.name.startsWith('.') && entry.name !== '.') continue;
        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          // 跳过二进制文件（简单扩展名判断）
          if (isBinaryExtension(entry.name)) continue;

          // glob 过滤
          if (globRegex) {
            const relativePath = fullPath
              .replace(searchPath, '')
              .replace(/\\/g, '/')
              .replace(/^\//, '');
            if (!globRegex.test(relativePath) && !globRegex.test(entry.name)) {
              continue;
            }
          }

          // 跳过过大文件
          try {
            const stat = statSync(fullPath);
            if (stat.size > 1024 * 1024) continue; // 跳过 > 1MB
          } catch {
            continue;
          }

          results.push(fullPath);
        }
      }
    } catch {
      // 权限错误
    }
  }

  walk(searchPath);
  return results;
}

/**
 * 二进制文件扩展名列表
 */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.svg',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.wav',
  '.flac',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.bin',
  '.dat',
  '.class',
  '.pyc',
  '.db',
  '.sqlite',
  '.sqlite3',
]);

function isBinaryExtension(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

// ============ grep 工具 ============

export function createGrepTool() {
  const MAX_RESULTS = 250;

  return {
    id: 'grep' as const,
    label: '内容搜索',
    description:
      '使用正则表达式搜索文件内容。支持 output_mode 控制输出格式：' +
      '"content"（含上下文）、"files_with_matches"（仅文件列表）、"count"（匹配计数）。' +
      '参数 context 可指定显示匹配行前后 N 行上下文。' +
      '参数 glob 可过滤文件（如 "*.ts" 仅搜索 TypeScript 文件）。',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '正则表达式搜索模式（必填）',
        },
        path: {
          type: 'string',
          description: '搜索范围目录（可选，默认当前工作目录）',
        },
        glob: {
          type: 'string',
          description: '文件过滤 glob 模式（可选，如 "*.ts"）',
        },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
          description:
            '输出模式：content（默认，含上下文）、files_with_matches（文件列表）、count（计数）',
        },
        '-i': {
          type: 'boolean',
          description: '忽略大小写（默认大小写敏感）',
        },
        '-A': {
          type: 'number',
          description: '匹配行之后显示的行数',
        },
        '-B': {
          type: 'number',
          description: '匹配行之前显示的行数',
        },
        context: {
          type: 'number',
          description: '匹配行前后显示的行数（同时设置 -A 和 -B）',
        },
      },
      required: ['pattern'],
    } as const,

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(_toolCallId: string, params: GrepParams): Promise<any> {
      const startTime = Date.now();
      const searchPath = resolve(params.path ?? process.cwd());
      const outputMode = params.output_mode ?? 'content';
      const ignoreCase = params['-i'] === true;
      const contextBefore = params['-B'] ?? params.context ?? 0;
      const contextAfter = params['-A'] ?? params.context ?? 0;

      // 编译正则
      let regex: RegExp;
      try {
        regex = new RegExp(params.pattern, ignoreCase ? 'gi' : 'g');
      } catch {
        const details: GrepDetails = {
          pattern: params.pattern,
          matchCount: 0,
          fileCount: 0,
          searchPath,
          truncated: false,
          outputMode,
        };
        return {
          content: [
            {
              type: 'text',
              text: `[grep] 无效的正则表达式: "${params.pattern}"`,
            },
          ],
          details,
        };
      }

      // 收集文件
      const files = collectFiles(searchPath, params.glob);

      // 搜索
      const results: Array<{
        file: string;
        lineNum: number;
        line: string;
        contextBefore: string[];
        contextAfter: string[];
      }> = [];

      for (const file of files) {
        if (results.length >= MAX_RESULTS) break;

        try {
          const content = readFileSync(file, 'utf-8');
          const lines = content.split('\n');

          // 重置 lastIndex
          regex.lastIndex = 0;

          // 逐行搜索
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= MAX_RESULTS) break;

            const currentLine = lines[i]!;

            // 每行单独匹配
            const lineRegex = new RegExp(params.pattern, ignoreCase ? 'i' : '');
            if (lineRegex.test(currentLine)) {
              const ctxBefore: string[] = [];
              const ctxAfter: string[] = [];

              for (let b = Math.max(0, i - contextBefore); b < i; b++) {
                ctxBefore.push(lines[b]!);
              }
              for (let a = i + 1; a <= Math.min(lines.length - 1, i + contextAfter); a++) {
                ctxAfter.push(lines[a]!);
              }

              results.push({
                file,
                lineNum: i + 1,
                line: currentLine.substring(0, 500), // 截断过长行
                contextBefore: ctxBefore.map((l) => l.substring(0, 500)),
                contextAfter: ctxAfter.map((l) => l.substring(0, 500)),
              });
            }
          }
        } catch {
          // 读取错误
        }
      }

      const elapsedMs = Date.now() - startTime;
      const truncated = results.length >= MAX_RESULTS;

      // 按输出模式构建响应
      if (outputMode === 'files_with_matches') {
        const uniqueFiles = [...new Set(results.map((r) => r.file))];
        return buildFilesOutput(uniqueFiles, params.pattern, searchPath, truncated, elapsedMs);
      }

      if (outputMode === 'count') {
        const fileCounts = new Map<string, number>();
        for (const r of results) {
          fileCounts.set(r.file, (fileCounts.get(r.file) ?? 0) + 1);
        }
        return buildCountOutput(fileCounts, params.pattern, searchPath, truncated, elapsedMs);
      }

      // content 模式
      return buildContentOutput(results, params.pattern, searchPath, truncated, elapsedMs);
    },
  };
}

// ============ 输出构建 ============

function buildContentOutput(
  results: Array<{
    file: string;
    lineNum: number;
    line: string;
    contextBefore: string[];
    contextAfter: string[];
  }>,
  pattern: string,
  searchPath: string,
  truncated: boolean,
  elapsedMs: number
) {
  if (results.length === 0) {
    const details: GrepDetails = {
      pattern,
      matchCount: 0,
      fileCount: 0,
      searchPath,
      truncated: false,
      outputMode: 'content',
      elapsedMs,
    };
    return {
      content: [
        { type: 'text', text: `[grep] 未找到匹配 "${pattern}" 的内容（在 ${searchPath} 中）` },
      ],
      details,
    };
  }

  const lines: string[] = [
    `[grep] 找到 ${results.length} 处匹配 "${pattern}"${truncated ? '（结果已截断）' : ''}：`,
    '',
  ];

  for (const r of results) {
    lines.push(`${r.file}:${r.lineNum}`);
    for (const ctxLine of r.contextBefore) {
      lines.push(`  ${ctxLine}`);
    }
    lines.push(`> ${r.line}`);
    for (const ctxLine of r.contextAfter) {
      lines.push(`  ${ctxLine}`);
    }
    lines.push('');
  }

  const details: GrepDetails = {
    pattern,
    matchCount: results.length,
    fileCount: [...new Set(results.map((r) => r.file))].length,
    searchPath,
    truncated,
    outputMode: 'content',
    elapsedMs,
  };
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details,
  };
}

function buildFilesOutput(
  files: string[],
  pattern: string,
  searchPath: string,
  truncated: boolean,
  elapsedMs: number
) {
  if (files.length === 0) {
    const details: GrepDetails = {
      pattern,
      matchCount: 0,
      fileCount: 0,
      searchPath,
      truncated: false,
      outputMode: 'files_with_matches',
      elapsedMs,
    };
    return {
      content: [
        { type: 'text', text: `[grep] 未找到匹配 "${pattern}" 的文件（在 ${searchPath} 中）` },
      ],
      details,
    };
  }

  const parts = [
    `[grep] 找到 ${files.length} 个匹配 "${pattern}" 的文件${truncated ? '（结果已截断）' : ''}：`,
    '',
    ...files.map((f, i) => `${i + 1}. ${f}`),
  ];

  const details: GrepDetails = {
    pattern,
    matchCount: files.length,
    fileCount: files.length,
    searchPath,
    truncated,
    outputMode: 'files_with_matches',
    elapsedMs,
  };
  return {
    content: [{ type: 'text', text: parts.join('\n') }],
    details,
  };
}

function buildCountOutput(
  fileCounts: Map<string, number>,
  pattern: string,
  searchPath: string,
  truncated: boolean,
  elapsedMs: number
) {
  if (fileCounts.size === 0) {
    const details: GrepDetails = {
      pattern,
      matchCount: 0,
      fileCount: 0,
      searchPath,
      truncated: false,
      outputMode: 'count',
      elapsedMs,
    };
    return {
      content: [
        { type: 'text', text: `[grep] 未找到匹配 "${pattern}" 的内容（在 ${searchPath} 中）` },
      ],
      details,
    };
  }

  const parts = [`[grep] 匹配 "${pattern}" 的计数${truncated ? '（结果已截断）' : ''}：`, ''];

  let total = 0;
  // 首次排序
  const sorted = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [file, count] of sorted) {
    parts.push(`${count} ${file}`);
    total += count;
  }
  parts.push('', `合计: ${total} 处匹配（${fileCounts.size} 个文件）`);

  const details: GrepDetails = {
    pattern,
    matchCount: total,
    fileCount: fileCounts.size,
    searchPath,
    truncated,
    outputMode: 'count',
    elapsedMs,
  };
  return {
    content: [{ type: 'text', text: parts.join('\n') }],
    details,
  };
}
