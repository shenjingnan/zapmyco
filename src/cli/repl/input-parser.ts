/**
 * 输入解析器
 *
 * 将用户单行输入解析为结构化的 ParsedInput，
 * 区分命令、自然语言目标、空行和多行续行。
 */

import type { ParsedInput } from './types.js';

/**
 * 输入解析器
 */
export class InputParser {
  private buffer = '';

  /**
   * 解析单行输入
   *
   * 规则：
   * 1. 空行 → empty
   * 2. 以 / 开头 → command
   * 3. 以 \ 结尾 → incomplete（多行续行）
   * 4. 其他 → goal（拼接 buffer 后）
   */
  parse(line: string): ParsedInput {
    const trimmed = line.trimEnd();

    // 规则 1: 空行（且无缓冲内容）
    if (trimmed.length === 0 && this.buffer.length === 0) {
      return { kind: 'empty' };
    }

    // 规则 2: 命令（优先识别，即使有 buffer 也清空后处理）
    if (trimmed.startsWith('/')) {
      this.buffer = '';
      return this.parseCommand(trimmed);
    }

    // 规则 3: 续行标记
    if (trimmed.endsWith('\\')) {
      const content = trimmed.slice(0, -1);
      this.buffer += this.buffer ? `\n${content}` : content;
      return { kind: 'incomplete', buffer: this.buffer };
    }

    // 规则 4 & 5: 完整输入（可能包含之前缓冲的多行内容）
    const fullInput = this.buffer ? `${this.buffer}\n${trimmed}` : trimmed;
    this.buffer = '';

    if (fullInput.trim().length === 0) {
      return { kind: 'empty' };
    }

    return { kind: 'goal', rawInput: fullInput };
  }

  /** 重置解析状态（清空多行缓冲） */
  reset(): void {
    this.buffer = '';
  }

  /** 获取当前缓冲内容 */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * 解析命令行
   *
   * 支持引号包裹的参数：/config set key "value with spaces"
   */
  private parseCommand(line: string): ParsedInput {
    // 去掉开头的 /
    const withoutSlash = line.slice(1);

    // 使用简单的分词：支持双引号内的空格
    const tokens = this.tokenize(withoutSlash);

    if (tokens.length === 0) {
      return { kind: 'empty' };
    }

    const name = tokens[0]?.toLowerCase() ?? '';
    const args = tokens.slice(1);

    return { kind: 'command', name, args };
  }

  /**
   * 分词器
   *
   * 支持双引号包裹的参数（引号内空格不分割）。
   */
  private tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (char === ' ' && !inQuotes) {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    // 处理最后一个 token
    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }
}
