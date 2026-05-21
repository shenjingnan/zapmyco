/**
 * 自动补全提供者
 *
 * 组合式自动补全提供者。
 * 支持斜杠命令补全和文件路径补全。
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

/**
 * 组合式自动补全提供者
 *
 * 整合斜杠命令补全和文件路径补全。
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
}
