/**
 * Cell — 终端屏幕中的一个单元格。
 * 后续 PR 将优化为 Int32Array packed 格式以减少 GC 压力。
 */
export interface Cell {
  /** 字符（'' = 空单元格） */
  char: string;
  /** 样式 ID（0 = 默认无样式） */
  styleId: number;
  /** 显示宽度（1 = 窄，2 = 宽，如 CJK/emoji） */
  width: number;
}

/** 空单元格常量 */
const EMPTY_CELL: Cell = { char: '', styleId: 0, width: 1 };

/**
 * Screen — Cell 缓冲区。
 *
 * 二维网格的 Cell 缓冲区，扁平数组存储（行主序: cells[row * cols + col]）。
 * 这是 Ink 渲染管线的基础缓冲区。
 */
export class Screen {
  private _cells: Cell[];
  private _rows: number;
  private _cols: number;

  constructor(rows: number, cols: number) {
    this._rows = rows;
    this._cols = cols;
    this._cells = Array.from({ length: rows * cols }, () => ({ ...EMPTY_CELL }));
  }

  /** 行数 */
  get rows(): number {
    return this._rows;
  }

  /** 列数 */
  get cols(): number {
    return this._cols;
  }

  /** 获取单元格。越界时返回空单元格。 */
  getCell(col: number, row: number): Cell {
    if (col < 0 || col >= this._cols || row < 0 || row >= this._rows) {
      return EMPTY_CELL;
    }
    return this._cells[row * this._cols + col] ?? EMPTY_CELL;
  }

  /** 设置单元格。越界时静默忽略。 */
  setCell(col: number, row: number, char: string, styleId: number, width: number): void {
    if (col < 0 || col >= this._cols || row < 0 || row >= this._rows) {
      return;
    }
    const idx = row * this._cols + col;
    this._cells[idx] = { char, styleId, width };
  }

  /** 全屏填充 */
  fill(char: string, styleId: number): void {
    const width = char.length >= 2 ? 2 : 1;
    for (let r = 0; r < this._rows; r++) {
      for (let c = 0; c < this._cols; c++) {
        this._cells[r * this._cols + c] = { char, styleId, width };
      }
    }
  }

  /** 清空一行 */
  clearLine(row: number): void {
    if (row < 0 || row >= this._rows) return;
    const start = row * this._cols;
    for (let c = 0; c < this._cols; c++) {
      this._cells[start + c] = { ...EMPTY_CELL };
    }
  }

  /** 清空矩形区域 */
  clearRegion(x: number, y: number, w: number, h: number): void {
    for (let r = y; r < y + h && r < this._rows; r++) {
      const start = r * this._cols + x;
      const end = Math.min(start + w, (r + 1) * this._cols);
      for (let i = start; i < end; i++) {
        this._cells[i] = { ...EMPTY_CELL };
      }
    }
  }

  /**
   * 行偏移（硬件滚动仿真）。
   * delta > 0: 向上滚动（行从 bottom 移出，顶部出现空行）
   * delta < 0: 向下滚动（行从 top 移出，底部出现空行）
   */
  shiftRows(top: number, bottom: number, delta: number): void {
    if (top < 0 || bottom >= this._rows || top > bottom) return;
    const width = this._cols;
    const count = bottom - top + 1;

    if (delta > 0) {
      const shift = Math.min(delta, count);
      for (let r = top; r <= bottom - shift; r++) {
        const srcRow = (r + shift) * width;
        const dstRow = r * width;
        for (let c = 0; c < width; c++) {
          this._cells[dstRow + c] = this._cells[srcRow + c] ?? { ...EMPTY_CELL };
        }
      }
      for (let r = bottom - shift + 1; r <= bottom; r++) {
        this.clearLine(r);
      }
    } else if (delta < 0) {
      const shift = Math.min(-delta, count);
      for (let r = bottom - shift; r >= top; r--) {
        const srcRow = r * width;
        const dstRow = (r + shift) * width;
        for (let c = 0; c < width; c++) {
          this._cells[dstRow + c] = this._cells[srcRow + c] ?? { ...EMPTY_CELL };
        }
      }
      for (let r = top; r < top + shift; r++) {
        this.clearLine(r);
      }
    }
  }

  /** 深拷贝 */
  clone(): Screen {
    const s = new Screen(this._rows, this._cols);
    for (let i = 0; i < this._cells.length; i++) {
      const c = this._cells[i] ?? EMPTY_CELL;
      s._cells[i] = { char: c.char, styleId: c.styleId, width: c.width };
    }
    return s;
  }

  /** 在指定位置写入字符串。每个字符使用相同的 styleId。 */
  writeString(col: number, row: number, text: string, styleId: number): void {
    if (row < 0 || row >= this._rows) return;
    let x = col;
    for (const ch of text) {
      if (x >= this._cols) break;
      if (x < 0) {
        x++;
        continue;
      }
      const w = ch.length >= 2 ? 2 : 1;
      this.setCell(x, row, ch, styleId, w);
      if (w === 2 && x + 1 < this._cols) {
        this.setCell(x + 1, row, '', styleId, 2);
      }
      x += w;
    }
  }

  /** 调整屏幕尺寸。保留可容纳的原内容，新增区域清空。 */
  resize(rows: number, cols: number): void {
    if (rows === this._rows && cols === this._cols) return;
    const newCells = Array.from({ length: rows * cols }, () => ({ ...EMPTY_CELL }));

    const copyRows = Math.min(rows, this._rows);
    const copyCols = Math.min(cols, this._cols);
    for (let r = 0; r < copyRows; r++) {
      const srcStart = r * this._cols;
      const dstStart = r * cols;
      for (let c = 0; c < copyCols; c++) {
        newCells[dstStart + c] = this._cells[srcStart + c] ?? { ...EMPTY_CELL };
      }
    }

    this._cells = newCells;
    this._rows = rows;
    this._cols = cols;
  }
}
