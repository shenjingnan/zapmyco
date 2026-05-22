/**
 * Screen — Cell 缓冲区
 *
 * 二维网格的 Cell 缓冲区，每个 Cell 包含字符、样式 ID 和显示宽度。
 * 使用扁平数组存储，支持批量操作、区域拷贝和硬件滚动偏移。
 *
 * 设计参考 claude-code 的 Ink Screen buffer，但使用 Cell 对象而非打包 TypedArray，
 * 降低实现复杂度，便于逐步优化。
 */

// ---------------------------------------------------------------------------
// Cell 类型
// ---------------------------------------------------------------------------

export interface Cell {
  /** 字符（'' = 空单元格） */
  char: string;
  /** 样式 ID（0 = 默认无样式） */
  styleId: number;
  /** 显示宽度（1 = 窄, 2 = 宽, 如 CJK/emoji） */
  width: number;
}

/** 空单元格常量 */
const EMPTY_CELL: Cell = { char: '', styleId: 0, width: 1 };

// ---------------------------------------------------------------------------
// Screen 类
// ---------------------------------------------------------------------------

export class Screen {
  /** 扁平 Cell 数组（行主序: cells[row * cols + col]） */
  private _cells: Cell[];
  /** 行数 */
  private _rows: number;
  /** 列数 */
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

  // -----------------------------------------------------------------------
  // 核心访问
  // -----------------------------------------------------------------------

  /**
   * 获取单元格。
   * 越界时返回空单元格（不抛异常）。
   */
  getCell(col: number, row: number): Cell {
    if (col < 0 || col >= this._cols || row < 0 || row >= this._rows) {
      return EMPTY_CELL;
    }
    return this._cells[row * this._cols + col] ?? EMPTY_CELL;
  }

  /**
   * 设置单元格。
   * 越界时静默忽略。
   */
  setCell(col: number, row: number, char: string, styleId: number, width: number): void {
    if (col < 0 || col >= this._cols || row < 0 || row >= this._rows) {
      return;
    }
    const idx = row * this._cols + col;
    this._cells[idx] = { char, styleId, width };
  }

  // -----------------------------------------------------------------------
  // 批量操作
  // -----------------------------------------------------------------------

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
   * 区域拷贝 — 将 src 屏幕中指定区域拷贝到本屏幕。
   * 两个屏幕尺寸不必相同。
   */
  blitRegion(
    src: Screen,
    srcX: number,
    srcY: number,
    dstX: number,
    dstY: number,
    w: number,
    h: number
  ): void {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const srcCell = src.getCell(srcX + c, srcY + r);
        this.setCell(dstX + c, dstY + r, srcCell.char, srcCell.styleId, srcCell.width);
      }
    }
  }

  /**
   * 行偏移（硬件滚动仿真）
   * delta > 0: 向上滚动（行从 bottom 移出，顶部出现空行）
   * delta < 0: 向下滚动（行从 top 移出，底部出现空行）
   */
  shiftRows(top: number, bottom: number, delta: number): void {
    if (top < 0 || bottom >= this._rows || top > bottom) return;
    const width = this._cols;
    const count = bottom - top + 1;

    if (delta > 0) {
      // 向上滚动
      const shift = Math.min(delta, count);
      for (let r = top; r <= bottom - shift; r++) {
        const srcRow = (r + shift) * width;
        const dstRow = r * width;
        for (let c = 0; c < width; c++) {
          this._cells[dstRow + c] = this._cells[srcRow + c] ?? EMPTY_CELL;
        }
      }
      // 清空底部 shift 行
      for (let r = bottom - shift + 1; r <= bottom; r++) {
        this.clearLine(r);
      }
    } else if (delta < 0) {
      // 向下滚动
      const shift = Math.min(-delta, count);
      for (let r = bottom - shift; r >= top; r--) {
        const srcRow = r * width;
        const dstRow = (r + shift) * width;
        for (let c = 0; c < width; c++) {
          this._cells[dstRow + c] = this._cells[srcRow + c] ?? EMPTY_CELL;
        }
      }
      // 清空顶部 shift 行
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

  // -----------------------------------------------------------------------
  // 行写辅助
  // -----------------------------------------------------------------------

  /**
   * 在指定位置写入字符串。
   * 每个字符使用相同的 styleId。自动跳过超右边界。
   */
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
        // 宽字符第二格设为 spacer tail
        this.setCell(x + 1, row, '', styleId, 2);
      }
      x += w;
    }
  }

  // -----------------------------------------------------------------------
  // 遍历
  // -----------------------------------------------------------------------

  /** 遍历所有非空单元格 */
  forEachCell(callback: (col: number, row: number, cell: Cell) => void): void {
    for (let r = 0; r < this._rows; r++) {
      for (let c = 0; c < this._cols; c++) {
        const cell = this._cells[r * this._cols + c] ?? EMPTY_CELL;
        if (cell.char !== '' || cell.styleId !== 0) {
          callback(c, r, cell);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // 尺寸管理
  // -----------------------------------------------------------------------

  /** 调整屏幕尺寸。保留可容纳的原内容，新增区域清空。 */
  resize(rows: number, cols: number): void {
    if (rows === this._rows && cols === this._cols) return;
    const newCells = Array.from({ length: rows * cols }, () => ({ ...EMPTY_CELL }));

    // 拷贝可容纳的旧内容
    const copyRows = Math.min(rows, this._rows);
    const copyCols = Math.min(cols, this._cols);
    for (let r = 0; r < copyRows; r++) {
      const srcStart = r * this._cols;
      const dstStart = r * cols;
      for (let c = 0; c < copyCols; c++) {
        newCells[dstStart + c] = this._cells[srcStart + c] ?? EMPTY_CELL;
      }
    }

    this._cells = newCells;
    this._rows = rows;
    this._cols = cols;
  }
}
