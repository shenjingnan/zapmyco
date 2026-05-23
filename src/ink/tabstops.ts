/**
 * tabstops — Tab 展开为空格
 *
 * 将文本中的 Tab 字符展开为空格（默认 8 列间距，POSIX 标准）。
 * 使用 createTokenizer 分离 ANSI 序列，使用 stringWidth 计算列位置。
 *
 * 参考 claude-code src/ink/tabstops.ts
 */

import { stringWidth } from './stringWidth';
import { createTokenizer } from './termio/tokenize';

/**
 * 将文本中的 Tab 字符展开为空格。
 * 处理 ANSI 转义序列，不破坏样式。
 *
 * @param text     - 输入文本（可含 ANSI 序列）
 * @param interval - Tab 间隔（默认 8，POSIX 标准）
 * @returns 展开后的文本
 */
export function expandTabs(text: string, interval = 8): string {
  if (!text.includes('\t')) return text;

  const tokenizer = createTokenizer();
  const tokens = tokenizer.feed(text);
  const result: string[] = [];
  let col = 0;

  for (const token of tokens) {
    if (token.type === 'sequence') {
      result.push(token.value);
    } else {
      // 文本内容
      for (const char of token.value) {
        if (char === '\n' || char === '\r') {
          result.push(char);
          col = 0;
        } else if (char === '\t') {
          const spaces = interval - (col % interval);
          result.push(' '.repeat(spaces));
          col += spaces;
        } else {
          result.push(char);
          col += stringWidth(char);
        }
      }
    }
  }

  return result.join('');
}
