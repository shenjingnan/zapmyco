/**
 * glob 工具实现 — 文件模式匹配搜索
 *
 * 功能：
 * - 使用 glob 模式匹配文件
 * - 支持相对/绝对路径
 * - 按修改时间排序
 * - 结果数量限制
 *
 * 参考 Claude Code GlobTool 的设计。
 *
 * @module cli/repl/tools/file-glob
 */

import { statSync } from 'node:fs';
import { resolve } from 'node:path';

// ============ 类型定义 ============

/** glob 工具参数 */
export interface GlobParams {
  /** glob 模式（如 "src/**\/*.ts"） */
  pattern: string;
  /** 搜索根目录（可选，默认当前工作目录） */
  path?: string;
}

/** glob 返回详情 */
export interface GlobDetails {
  pattern: string;
  matchCount: number;
  searchPath: string;
  truncated: boolean;
  error?: string;
  elapsedMs?: number;
}

// ============ glob 匹配实现 ============

/**
 * 简单的 glob 模式匹配
 *
 * 使用同步 fs.readdirSync 递归实现，避免引入额外依赖。
 * 支持 **、*、? 通配符。
 */
function globSync(pattern: string, rootPath: string): string[] {
  const { readdirSync } = require('node:fs');
  const { join, relative, dirname } = require('node:path');

  // 解析 pattern 中的目录部分
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // 检查是否为递归模式
  const isRecursive = normalizedPattern.includes('**');

  if (isRecursive) {
    // 使用简单的递归遍历实现
    const parts = normalizedPattern.split('/');
    const results: string[] = [];
    const maxResults = 500;

    // 构建正则表达式匹配
    let regexStr = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<GLOBSTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/<<<GLOBSTAR>>>/g, '.*');

    // 当 pattern 以 **/ 开头时，允许匹配根目录下的文件（使目录前缀可选）
    if (normalizedPattern.startsWith('**/')) {
      regexStr = regexStr.replace(/^\.\*\//, '(.*/)?');
    }

    const regex = new RegExp(`^${regexStr}$`);

    function walk(dir: string) {
      if (results.length >= maxResults) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= maxResults) return;
          const fullPath = join(dir, entry.name);
          const relativePath = relative(rootPath, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            // 跳过隐藏目录和 node_modules
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            walk(fullPath);
          } else if (entry.isFile()) {
            if (regex.test(relativePath)) {
              results.push(fullPath);
            }
          }
        }
      } catch {
        // 权限错误，跳过
      }
    }

    // 找到搜索的起始目录
    // 当 pattern 以 ** 开头时（如 **/*.ts），从 rootPath 开始遍历
    const startsWithGlobstar = normalizedPattern.startsWith('**');
    const staticPart = parts.find((p) => !p.includes('*') && !p.includes('?')) || '.';
    const startDir = startsWithGlobstar
      ? rootPath
      : resolve(rootPath, staticPart === '**' ? '.' : dirname(normalizedPattern));
    walk(startDir);

    // 按修改时间排序
    results.sort((a, b) => {
      try {
        return statSync(b).mtimeMs - statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });

    return results.slice(0, maxResults);
  } else {
    // 简单模式匹配（不使用递归）
    const results: string[] = [];
    const regexStr = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');

    const regex = new RegExp(regexStr);
    const searchDir = rootPath;

    try {
      // biome-ignore lint/suspicious/noExplicitAny: Node types don't include recursive option
      const entries = readdirSync(searchDir, { withFileTypes: true, recursive: false } as any);
      for (const entry of entries) {
        if (entry.isFile() && regex.test(entry.name)) {
          const fullPath = join(searchDir, entry.name);
          results.push(fullPath);
        }
      }
    } catch {
      // 目录不存在或权限错误
    }

    // 按修改时间排序
    results.sort((a, b) => {
      try {
        return statSync(b).mtimeMs - statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });

    return results;
  }
}

// ============ glob 工具 ============

export function createGlobTool() {
  return {
    id: 'glob' as const,
    label: '文件搜索',
    description:
      '使用 glob 模式匹配搜索文件。支持 ** (递归)、* (任意字符)、? (单字符) 通配符。' +
      '结果按修改时间倒序排列，最多返回 500 个匹配。' +
      '参数 pattern 为 glob 模式（如 "src/**/*.ts"、"*.js"），path 为搜索根目录（可选）。',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'glob 匹配模式（必填）。如 "**/*.ts"、"src/**/*.test.ts"',
        },
        path: {
          type: 'string',
          description: '搜索根目录（可选，默认当前工作目录）',
        },
      },
      required: ['pattern'],
    } as const,

    // biome-ignore lint/suspicious/noExplicitAny: tool execute returns flexible result
    async execute(_toolCallId: string, params: GlobParams): Promise<any> {
      const startTime = Date.now();
      const searchPath = resolve(params.path ?? process.cwd());

      try {
        const matches = globSync(params.pattern, searchPath);
        const elapsedMs = Date.now() - startTime;
        const truncated = matches.length >= 500;

        if (matches.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `[glob] 未找到匹配 "${params.pattern}" 的文件（在 ${searchPath} 中）`,
              },
            ],
            details: {
              pattern: params.pattern,
              matchCount: 0,
              searchPath,
              truncated: false,
              elapsedMs,
            } satisfies GlobDetails,
          };
        }

        const parts: string[] = [
          `[glob] 找到 ${matches.length} 个匹配 "${params.pattern}" 的文件${truncated ? '（结果已截断）' : ''}：`,
          '',
          ...matches.map((m, i) => `${i + 1}. ${m}`),
        ];

        return {
          content: [{ type: 'text', text: parts.join('\n') }],
          details: {
            pattern: params.pattern,
            matchCount: matches.length,
            searchPath,
            truncated,
            elapsedMs,
          } satisfies GlobDetails,
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `[glob] 搜索失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: {
            pattern: params.pattern,
            matchCount: 0,
            searchPath,
            truncated: false,
            error: err instanceof Error ? err.message : String(err),
          } satisfies GlobDetails,
        };
      }
    },
  };
}
