/**
 * write_file 工具实现 — 文件创建与覆写
 *
 * 功能：
 * - 创建新文件 / 覆写已有文件
 * - 自动创建父目录
 * - 敏感路径检查
 * - 工作区边界保护
 * - 过期检测（软约束）
 * - 返回结构化 diff
 *
 * 参考 Claude Code FileWriteTool 和 Hermes write_file 的设计。
 *
 * @module cli/repl/tools/file-write
 */

import {
  generateSimpleDiff,
  readFileContent,
  readStateTracker,
  validateFilePath,
  writeFileContent,
} from './file-security';

// ============ 类型定义 ============

/** write_file 工具参数 */
export interface WriteFileParams {
  /** 文件绝对路径 */
  file_path: string;
  /** 要写入的内容 */
  content: string;
}

/** write_file 返回详情 */
export interface WriteFileDetails {
  type: 'create' | 'update';
  filePath: string;
  contentLength: number;
  warning?: string;
  error?: string;
  elapsedMs?: number;
}

// ============ write_file 工具 ============

export function createWriteFileTool() {
  return {
    id: 'write_file' as const,
    label: '写入文件',
    description:
      '将内容写入文件，完全替换已有内容或创建新文件。' +
      '使用此工具来创建或覆写文件。自动创建父目录。' +
      '参数 file_path 为文件绝对路径，content 为要写入的内容。',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: '文件绝对路径（必填）。必须是绝对路径，不能是相对路径。',
        },
        content: {
          type: 'string',
          description: '要写入文件的完整内容（必填）',
        },
      },
      required: ['file_path', 'content'],
    } as const,

    // biome-ignore lint/suspicious/noExplicitAny: tool execute returns flexible result
    async execute(_toolCallId: string, params: WriteFileParams): Promise<any> {
      const startTime = Date.now();

      // Step 1: 路径验证
      const pathResult = validateFilePath(params.file_path);
      if (!pathResult.valid) {
        const details: WriteFileDetails = {
          type: 'create',
          filePath: params.file_path,
          contentLength: 0,
        };
        if (pathResult.reason) {
          details.error = pathResult.reason;
        }
        return {
          content: [
            {
              type: 'text',
              text: `[写入失败] ${pathResult.reason}`,
            },
          ],
          details,
        };
      }

      const resolvedPath = pathResult.resolved;

      // Step 2: 过期检测（软约束）
      let warning: string | undefined;
      const staleWarning = readStateTracker.checkStale(resolvedPath);
      if (staleWarning) {
        warning = staleWarning;
      }

      // Step 3: 检查文件是否已存在
      const oldContent = readFileContent(resolvedPath);
      const isNew = oldContent === null;

      // Step 4: 写入文件
      try {
        writeFileContent(resolvedPath, params.content);
      } catch (err) {
        const details: WriteFileDetails = {
          type: isNew ? 'create' : 'update',
          filePath: resolvedPath,
          contentLength: 0,
          error: err instanceof Error ? err.message : String(err),
        };
        return {
          content: [
            {
              type: 'text',
              text: `[写入失败] ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details,
        };
      }

      // Step 5: 更新读取状态（避免自身写入触发过期）
      readStateTracker.recordWrite(resolvedPath);

      // Step 6: 生成 diff
      const diff = generateSimpleDiff(resolvedPath, oldContent, params.content);
      const elapsedMs = Date.now() - startTime;

      // Step 7: 构建响应
      const type = isNew ? 'create' : ('update' as const);
      const messageHeader =
        type === 'create' ? `[文件已创建] ${resolvedPath}` : `[文件已更新] ${resolvedPath}`;

      const parts: string[] = [messageHeader];

      if (warning) {
        parts.push(`\n⚠ ${warning}`);
      }

      parts.push(`\n\`\`\`diff\n${diff}\n\`\`\``);
      parts.push(`\n耗时: ${elapsedMs}ms`);

      const details: WriteFileDetails = {
        type,
        filePath: resolvedPath,
        contentLength: params.content.length,
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
