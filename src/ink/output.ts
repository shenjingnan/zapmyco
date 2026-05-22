// ---------------------------------------------------------------------------
// 操作类型
// ---------------------------------------------------------------------------

interface WriteOperation {
  type: 'write';
  x: number;
  y: number;
  text: string;
}

interface ClipOperation {
  type: 'clip';
  clip: { x1?: number; x2?: number; y1?: number; y2?: number };
}

interface UnclipOperation {
  type: 'unclip';
}

type Operation = WriteOperation | ClipOperation | UnclipOperation;

/**
 * Output — 虚拟终端缓冲区。
 *
 * 记录 write/clip/unclip 操作队列，get() 时物化成输出字符串。
 * PR1 仅实现 write 操作，clip/unclip 在后续 PR 添加。
 */
export class Output {
  readonly width: number;
  readonly height: number;
  private operations: Operation[] = [];

  constructor(options: { width: number; height: number }) {
    this.width = options.width;
    this.height = options.height;
  }

  /** 记录一次 write 操作 */
  write(x: number, y: number, text: string): void {
    this.operations.push({ type: 'write', x, y, text });
  }

  /** 物化所有操作，返回输出字符串 */
  get(): { output: string; height: number } {
    const emptyRow = ' '.repeat(this.width);

    // 回放所有 write 操作到行缓冲区
    const rowBuffers: string[] = [];
    for (let y = 0; y < this.height; y++) {
      rowBuffers[y] = emptyRow;
    }

    for (const op of this.operations) {
      if (op.type === 'write') {
        if (op.y < 0 || op.y >= this.height) continue;
        const row = rowBuffers[op.y] ?? emptyRow;
        const chars = row.split('');
        for (let i = 0; i < op.text.length; i++) {
          const cx = op.x + i;
          if (cx < 0 || cx >= this.width) break;
          chars[cx] = op.text[i] ?? ' ';
        }
        rowBuffers[op.y] = chars.join('');
      }
    }

    // 逐行去掉尾部空白，拼接输出
    let maxNonEmptyRow = -1;
    const lines: string[] = [];
    for (let y = 0; y < this.height; y++) {
      const row = rowBuffers[y] ?? emptyRow;
      const trimmed = row.replace(/\s+$/, '');
      lines.push(trimmed);
      if (trimmed.length > 0) {
        maxNonEmptyRow = y;
      }
    }

    const trimmedLines = lines.slice(0, maxNonEmptyRow + 1);
    return {
      output: trimmedLines.join('\n'),
      height: maxNonEmptyRow + 1,
    };
  }
}
