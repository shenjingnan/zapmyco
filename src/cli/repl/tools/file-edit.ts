/**
 * edit_file 工具实现 — 精确字符串替换
 *
 * 功能：
 * - 精确字符串查找替换
 * - replace_all 批量替换
 * - Unicode 引号归一化（花括号引号 → 直引号）
 * - 多匹配唯一性检查
 * - 同 write_file 的安全保护
 *
 * 参考 Claude Code FileEditTool 的设计。
 * 不做 Hermes 的 9 级模糊匹配（复杂度高，可后续迭代）。
 *
 * @module cli/repl/tools/file-edit
 */

import {
  generateSimpleDiff,
  readFileContent,
  readStateTracker,
  validateFilePath,
  writeFileContent,
} from './file-security';

// ============ 类型定义 ============

/** edit_file 工具参数 */
export interface EditFileParams {
  /** 文件绝对路径 */
  file_path: string;
  /** 要替换的文本（必填，必须在文件中精确匹配） */
  old_string: string;
  /** 替换为（必填，必须与 old_string 不同） */
  new_string: string;
  /** 替换所有匹配项（可选，默认 false。多匹配时必须为 true） */
  replace_all?: boolean;
}

/** edit_file 返回详情 */
export interface EditFileDetails {
  filePath: string;
  replaced: boolean;
  matchCount: number;
  replaceAll: boolean;
  warning?: string;
  error?: string;
  elapsedMs?: number;
}

// ============ Unicode 归一化 ============

/**
 * Unicode 字符映射：将花括号引号等归一化为 ASCII 等价字符
 * 参考 Claude Code FileEditTool/utils.ts 和 Hermes fuzzy_match.py
 */
const UNICODE_MAP: Record<string, string> = {
  '\u201c': '"', // 左双引号 "
  '\u201d': '"', // 右双引号 "
  '\u2018': "'", // 左单引号 '
  '\u2019': "'", // 右单引号 '
  '\u2014': '--', // em dash
  '\u2013': '-', // en dash
  '\u2026': '...', // 省略号
  '\u00a0': ' ', // 不间断空格
};

/**
 * 归一化 Unicode 字符
 */
function normalizeUnicode(text: string): string {
  let result = text;
  for (const [char, replacement] of Object.entries(UNICODE_MAP)) {
    result = result.replaceAll(char, replacement);
  }
  return result;
}

/**
 * 在目标内容中查找匹配的字符串
 *
 * 先精确匹配，如果失败则尝试 Unicode 归一化后匹配。
 * 返回实际匹配到的字符串（用于替换），或 null。
 */
function findActualString(content: string, oldString: string): string | null {
  // 1. 精确匹配
  if (content.includes(oldString)) {
    return oldString;
  }

  // 2. Unicode 归一化后匹配
  const normalizedContent = normalizeUnicode(content);
  const normalizedOld = normalizeUnicode(oldString);

  if (normalizedContent.includes(normalizedOld)) {
    // 找到了归一化后的匹配，返回归一化后的 old_string
    return normalizedOld;
  }

  return null;
}

// ============ edit_file 工具 ============

export function createEditFileTool() {
  return {
    id: 'edit_file' as const,
    label: '编辑文件',
    description:
      '在文件中执行精确字符串替换。' +
      '参数 old_string 为要查找的文本（必须在文件中精确匹配），' +
      'new_string 为替换后的文本（必须与 old_string 不同）。' +
      '如果 old_string 在文件中出现多次，必须设置 replace_all=true。' +
      '自动支持 Unicode 引号归一化（花括号引号 → 直引号）。',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: '文件绝对路径（必填）',
        },
        old_string: {
          type: 'string',
          description:
            '要替换的文本（必填）。必须是文件中的精确内容。支持 Unicode 引号自动归一化。',
        },
        new_string: {
          type: 'string',
          description: '替换后的新文本（必填）。必须与 old_string 不同。',
        },
        replace_all: {
          type: 'boolean',
          description:
            '是否替换所有匹配项（可选，默认 false）。当 old_string 在文件中出现多次时必须设为 true。',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    } as const,

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(_toolCallId: string, params: EditFileParams): Promise<any> {
      const startTime = Date.now();
      const replaceAll = params.replace_all === true;

      // Step 1: 基本参数检查
      if (params.old_string === params.new_string) {
        const details: EditFileDetails = {
          filePath: params.file_path,
          replaced: false,
          matchCount: 0,
          replaceAll,
          error: 'old_string 与 new_string 相同',
        };
        return {
          content: [
            {
              type: 'text',
              text: '[编辑失败] old_string 和 new_string 完全相同，没有需要修改的内容。',
            },
          ],
          details,
        };
      }

      // Step 2: 路径验证
      const pathResult = validateFilePath(params.file_path);
      if (!pathResult.valid) {
        const details: EditFileDetails = {
          filePath: params.file_path,
          replaced: false,
          matchCount: 0,
          replaceAll,
        };
        if (pathResult.reason) {
          details.error = pathResult.reason;
        }
        return {
          content: [
            {
              type: 'text',
              text: `[编辑失败] ${pathResult.reason}`,
            },
          ],
          details,
        };
      }

      const resolvedPath = pathResult.resolved;

      // Step 3: 读取文件
      const fileContent = readFileContent(resolvedPath);
      if (fileContent === null) {
        const details: EditFileDetails = {
          filePath: resolvedPath,
          replaced: false,
          matchCount: 0,
          replaceAll,
          error: '文件不存在',
        };
        return {
          content: [
            {
              type: 'text',
              text: `[编辑失败] 文件不存在: ${resolvedPath}`,
            },
          ],
          details,
        };
      }

      // Step 4: 过期检测（软约束）
      let warning: string | undefined;
      const staleWarning = readStateTracker.checkStale(resolvedPath);
      if (staleWarning) {
        warning = staleWarning;
      }

      // Step 5: 查找匹配
      const actualOldString = findActualString(fileContent, params.old_string);
      if (actualOldString === null) {
        const details: EditFileDetails = {
          filePath: resolvedPath,
          replaced: false,
          matchCount: 0,
          replaceAll,
          error: 'old_string 未在文件中找到',
        };
        return {
          content: [
            {
              type: 'text',
              text:
                `[编辑失败] 在文件中未找到要替换的文本。\n` +
                `搜索内容: "${params.old_string}"\n` +
                `请使用 read_file 确认文件当前内容后重试。`,
            },
          ],
          details,
        };
      }

      // Step 6: 多匹配检查
      const matchCount = fileContent.split(actualOldString).length - 1;
      if (matchCount > 1 && !replaceAll) {
        const details: EditFileDetails = {
          filePath: resolvedPath,
          replaced: false,
          matchCount,
          replaceAll,
          error: `找到 ${matchCount} 处匹配但未设置 replace_all`,
        };
        return {
          content: [
            {
              type: 'text',
              text:
                `[编辑失败] 找到 ${matchCount} 处匹配，但 replace_all 为 false。\n` +
                `要替换所有 ${matchCount} 处匹配，请设置 replace_all=true。\n` +
                `要替换其中一处，请提供更多上下文使 old_string 唯一。\n` +
                `搜索内容: "${params.old_string}"`,
            },
          ],
          details,
        };
      }

      // Step 7: 执行替换
      const newContent = replaceAll
        ? fileContent.replaceAll(actualOldString, params.new_string)
        : fileContent.replace(actualOldString, params.new_string);

      // Step 8: 写入文件
      try {
        writeFileContent(resolvedPath, newContent);
      } catch (err) {
        const details: EditFileDetails = {
          filePath: resolvedPath,
          replaced: false,
          matchCount,
          replaceAll,
          error: err instanceof Error ? err.message : String(err),
        };
        return {
          content: [
            {
              type: 'text',
              text: `[编辑失败] ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details,
        };
      }

      // Step 9: 更新状态、生成 diff
      readStateTracker.recordWrite(resolvedPath);
      const diff = generateSimpleDiff(resolvedPath, fileContent, newContent);
      const elapsedMs = Date.now() - startTime;

      // Step 10: 构建响应
      const parts: string[] = [];
      parts.push(
        `[文件已编辑] ${resolvedPath}`,
        `替换了 ${matchCount} 处匹配${replaceAll ? '（replace_all=true）' : ''}`
      );

      if (warning) {
        parts.push(`\n⚠ ${warning}`);
      }

      parts.push(`\n\`\`\`diff\n${diff}\n\`\`\``);
      parts.push(`\n耗时: ${elapsedMs}ms`);

      const details: EditFileDetails = {
        filePath: resolvedPath,
        replaced: true,
        matchCount,
        replaceAll,
        elapsedMs,
      };
      if (warning) {
        details.warning = warning;
      }

      return {
        content: [{ type: 'text', text: parts.join('\n') }],
        details,
      };
    },
  };
}
