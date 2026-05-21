/**
 * 自动补全提供者
 *
 * 组合式自动补全提供者。
 * 支持斜杠命令补全和文件路径补全。
 * 实现 Editor 所需的 getSuggestions / applyCompletion 接口。
 */

import type { SlashCommand } from './types';

/** 补全项 */
export interface Completion {
  name: string;
  description?: string;
  insertText?: string;
}

/** 自动补全提供者接口 */
export interface AutocompleteProvider {
  getCompletions(line: string, cursorPos: number): Promise<Completion[]>;
}

/** Editor 补全项格式（getSuggestions 返回的 items） */
export interface SuggestionItem {
  label: string;
  value: string;
  description?: string;
}

/** Editor 补全结果格式 */
export interface SuggestionResult {
  items: SuggestionItem[];
  prefix: string;
}

/** Editor 补全应用结果格式 */
export interface CompletionResult {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
}

/**
 * 组合式自动补全提供者
 *
 * 整合斜杠命令补全和文件路径补全。
 * 实现 Editor 所需的 getSuggestions / applyCompletion 接口。
 */
export class CombinedAutocompleteProvider implements AutocompleteProvider {
  constructor(
    private readonly slashCommands: SlashCommand[],
    _cwd: string,
    private readonly fileProvider: AutocompleteProvider | null
  ) {
    void _cwd;
  }

  async getCompletions(line: string, _cursorPos: number): Promise<Completion[]> {
    if (line.startsWith('/')) {
      const input = line.slice(1);
      return this.slashCommands
        .filter((cmd) => cmd.name.startsWith(input))
        .map((cmd) => ({
          name: cmd.name,
          ...(cmd.description ? { description: cmd.description } : {}),
        }));
    }

    if (this.fileProvider) {
      return this.fileProvider.getCompletions(line, _cursorPos);
    }

    return [];
  }

  /**
   * 获取当前光标位置的补全建议（Editor 调用）
   *
   * 从 buffer 中提取当前行，判断是否以 / 开头，
   * 若是则在 slashCommands 中按前缀匹配。
   */
  async getSuggestions(
    buffer: string[],
    row: number,
    col: number,
    _options?: { signal?: AbortSignal; force?: boolean }
  ): Promise<SuggestionResult> {
    const line = buffer[row];
    if (!line) return { items: [], prefix: '' };

    const beforeCursor = line.slice(0, col);

    // 匹配 /command 模式（行首或空白后的 /...）
    const slashMatch = beforeCursor.match(/(?:^|\s)(\/[a-zA-Z0-9_-]*)$/);
    const fullPrefix = slashMatch?.[1];
    if (fullPrefix) {
      // e.g. "/he"
      const input = fullPrefix.slice(1); // e.g. "he"

      if (!input) {
        // 纯 "/" → 返回所有命令
        const items: SuggestionItem[] = this.slashCommands.map((cmd) => ({
          label: cmd.name,
          value: cmd.name,
          ...(cmd.description ? { description: cmd.description } : {}),
        }));
        return { items, prefix: fullPrefix };
      }

      // 前缀匹配优先，子串匹配补充
      const prefixMatches = this.slashCommands.filter((cmd) => cmd.name.startsWith(input));
      const substringMatches = this.slashCommands.filter(
        (cmd) => !cmd.name.startsWith(input) && cmd.name.includes(input)
      );

      const items: SuggestionItem[] = [...prefixMatches, ...substringMatches].map((cmd) => ({
        label: cmd.name,
        value: cmd.name,
        ...(cmd.description ? { description: cmd.description } : {}),
      }));

      return { items, prefix: fullPrefix };
    }

    // 不匹配命令模式，返回空
    return { items: [], prefix: '' };
  }

  /**
   * 应用选中的补全项到 buffer（Editor 调用）
   *
   * 将当前行中从前缀位置到光标的内容替换为完整的命令名。
   */
  applyCompletion(
    buffer: string[],
    row: number,
    col: number,
    item: { label: string; value?: string },
    prefix: string
  ): CompletionResult {
    const lines = [...buffer];
    const line = lines[row];
    if (!line) return { lines, cursorLine: row, cursorCol: col };

    // 从光标前查找 prefix 的位置
    const prefixPos = line.lastIndexOf(prefix, col);
    if (prefixPos < 0) {
      // 找不到 prefix 时在光标处直接插入
      const insertText = item.value ?? item.label;
      lines[row] = line.slice(0, col) + insertText + line.slice(col);
      return { lines, cursorLine: row, cursorCol: col + insertText.length };
    }

    // 替换从 prefix 位置到光标的内容为完整命令名
    // 注意：prefix 包含 '/'（如 '/com'），替换时需保留 '/' 前缀
    const insertText = item.value ?? item.label;
    if (prefix.startsWith('/')) {
      // 保留 '/' 前缀，只替换命令名部分
      lines[row] = line.slice(0, prefixPos + 1) + insertText + line.slice(col);
      return { lines, cursorLine: row, cursorCol: prefixPos + 1 + insertText.length };
    }
    lines[row] = line.slice(0, prefixPos) + insertText + line.slice(col);
    return { lines, cursorLine: row, cursorCol: prefixPos + insertText.length };
  }
}
