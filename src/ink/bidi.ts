/**
 * bidi — Unicode 双向文本重排
 *
 * 为不支持双向文本算法的终端（Windows Terminal, WSL, VS Code 终端）
 * 提供 Unicode 双向文本重排功能。
 *
 * macOS 终端（Terminal.app, iTerm2）原生支持 bidi，无需软件处理。
 *
 * 参考 claude-code src/ink/bidi.ts
 */

import bidiFactory from 'bidi-js';

export type ClusteredChar = {
  value: string;
  width: number;
  styleId: number;
  hyperlink: string | undefined;
};

let bidiInstance: ReturnType<typeof bidiFactory> | undefined;
let needsSoftwareBidi: boolean | undefined;

function needsBidi(): boolean {
  if (needsSoftwareBidi === undefined) {
    needsSoftwareBidi =
      process.platform === 'win32' ||
      typeof process.env.WT_SESSION === 'string' ||
      process.env.TERM_PROGRAM === 'vscode';
  }
  return needsSoftwareBidi;
}

function getBidi() {
  if (!bidiInstance) {
    bidiInstance = bidiFactory();
  }
  return bidiInstance;
}

/**
 * 将 ClusteredChar 数组从逻辑顺序重排为视觉顺序。
 * 在支持 bidi 的终端上为 no-op。
 */
export function reorderBidi(characters: ClusteredChar[]): ClusteredChar[] {
  if (!needsBidi() || characters.length === 0) {
    return characters;
  }

  const plainText = characters.map((c) => c.value).join('');

  if (!hasRTLCharacters(plainText)) {
    return characters;
  }

  const bidi = getBidi();
  const { levels } = bidi.getEmbeddingLevels(plainText, 'auto');

  // 将 bidi levels 映射到 ClusteredChar 索引
  const charLevels: number[] = [];
  let offset = 0;
  for (let i = 0; i < characters.length; i++) {
    charLevels.push(levels[offset]!);
    offset += characters[i]!.value.length;
  }

  // 标准 bidi 重排：从最高 level 向下，反转所有 >= level 的连续段
  const reordered = [...characters];
  const maxLevel = Math.max(...charLevels);

  for (let level = maxLevel; level >= 1; level--) {
    let i = 0;
    while (i < reordered.length) {
      if (charLevels[i]! >= level) {
        let j = i + 1;
        while (j < reordered.length && charLevels[j]! >= level) {
          j++;
        }
        reverseRange(reordered, i, j - 1);
        reverseRangeNumbers(charLevels, i, j - 1);
        i = j;
      } else {
        i++;
      }
    }
  }

  return reordered;
}

function reverseRange<T>(arr: T[], start: number, end: number): void {
  while (start < end) {
    const temp = arr[start]!;
    arr[start] = arr[end]!;
    arr[end] = temp;
    start++;
    end--;
  }
}

function reverseRangeNumbers(arr: number[], start: number, end: number): void {
  while (start < end) {
    const temp = arr[start]!;
    arr[start] = arr[end]!;
    arr[end] = temp;
    start++;
    end--;
  }
}

/**
 * 快速检查文本是否包含 RTL 字符。
 * 避免在纯 LTR 文本上运行完整 bidi 算法。
 */
function hasRTLCharacters(text: string): boolean {
  return /[\u0590-\u05FF\uFB1D-\uFB4F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0780-\u07BF\u0700-\u074F]/u.test(
    text
  );
}
