/**
 * Output — 操作队列 → Screen buffer
 *
 * renderNodeToOutput() 将 DOM 树遍历结果记录为 Output 操作，
 * get() 将这些操作应用到 Screen buffer，返回完整的帧。
 *
 * PR2 简化实现：直接操作 object-based Cell buffer。
 * 后续 PR 将添加 grapheme clustering、charCache 等优化。
 */

import { Screen } from './screen';

// ---------------------------------------------------------------------------
// Operation 类型
// ---------------------------------------------------------------------------

export type Clip = { x1?: number; x2?: number; y1?: number; y2?: number };

interface WriteOperation {
  type: 'write';
  x: number;
  y: number;
  text: string;
  styleId: number;
}

interface BlitOperation {
  type: 'blit';
  src: Screen;
  srcX: number;
  srcY: number;
  w: number;
  h: number;
  dstX: number;
  dstY: number;
}

interface ClearOperation {
  type: 'clear';
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ClipOperation {
  type: 'clip';
  clip: Clip;
}

interface UnclipOperation {
  type: 'unclip';
}

interface ShiftOperation {
  type: 'shift';
  top: number;
  bottom: number;
  delta: number;
}

type Operation =
  | WriteOperation
  | BlitOperation
  | ClearOperation
  | ClipOperation
  | UnclipOperation
  | ShiftOperation;

// ---------------------------------------------------------------------------
// Output 类
// ---------------------------------------------------------------------------

export class Output {
  readonly width: number;
  readonly height: number;
  private operations: Operation[] = [];
  private _screen: Screen;
  constructor(options: { width: number; height: number }) {
    this.width = options.width;
    this.height = options.height;
    this._screen = new Screen(options.height, options.width);
  }

  get screen(): Screen {
    return this._screen;
  }

  /** 重置 Output 为下一帧准备 */
  reset(width: number, height: number, screen: Screen): void {
    this.operations = [];
    this._screen = screen;
    // 确保 screen 尺寸匹配
    if (screen.cols !== width || screen.rows !== height) {
      screen.resize(height, width);
    }
    screen.clearDamage();
  }

  /** 撰写文本 */
  write(x: number, y: number, text: string, styleId = 0): void {
    this.operations.push({ type: 'write', x, y, text, styleId });
  }

  /** 从另一个 Screen 拷贝区域 */
  blit(
    src: Screen,
    srcX: number,
    srcY: number,
    w: number,
    h: number,
    dstX: number,
    dstY: number
  ): void {
    this.operations.push({ type: 'blit', src, srcX, srcY, w, h, dstX, dstY });
  }

  /** 清空区域 */
  clear(x: number, y: number, w: number, h: number): void {
    this.operations.push({ type: 'clear', x, y, w, h });
  }

  /** 压入裁剪栈 */
  clip(clip: Clip): void {
    this.operations.push({ type: 'clip', clip });
  }

  /** 弹出裁剪栈 */
  unclip(): void {
    this.operations.push({ type: 'unclip' });
  }

  /** 行移位 */
  shift(top: number, bottom: number, delta: number): void {
    this.operations.push({ type: 'shift', top, bottom, delta });
  }

  /** 应用所有操作到 Screen buffer，返回 Screen */
  get(): Screen {
    const screen = this._screen;
    const clipStack: Clip[] = [];

    for (const op of this.operations) {
      switch (op.type) {
        case 'write':
          this._applyWrite(screen, op, clipStack);
          break;
        case 'blit':
          this._applyBlit(screen, op, clipStack);
          break;
        case 'clear':
          screen.clearRegion(op.x, op.y, op.w, op.h);
          break;
        case 'clip':
          clipStack.push(op.clip);
          break;
        case 'unclip':
          clipStack.pop();
          break;
        case 'shift':
          screen.shiftRows(op.top, op.bottom, op.delta);
          break;
      }
    }

    return screen;
  }

  // ---------------------------------------------------------------------------
  // 内部操作
  // ---------------------------------------------------------------------------

  private _getEffectiveClip(clipStack: Clip[]): Clip | undefined {
    if (clipStack.length === 0) return undefined;
    // 取最近一个
    return clipStack[clipStack.length - 1];
  }

  private _applyWrite(screen: Screen, op: WriteOperation, clipStack: Clip[]): void {
    const clip = this._getEffectiveClip(clipStack);
    let x = op.x;
    const y = op.y;

    // 应用裁剪
    if (clip) {
      if (clip.x1 !== undefined && x < clip.x1) x = clip.x1;
      if (clip.x2 !== undefined && x > clip.x2) return;
      if (clip.y1 !== undefined && y < clip.y1) return;
      if (clip.y2 !== undefined && y > clip.y2) return;
    }

    for (const ch of op.text) {
      if (x >= screen.cols) break;
      if (x < 0) {
        x++;
        continue;
      }

      const w = ch.length >= 2 ? 2 : 1;
      screen.setCell(x, y, ch, op.styleId, w);

      // 宽字符的第二格
      if (w === 2 && x + 1 < screen.cols) {
        screen.setCell(x + 1, y, '', op.styleId, 2);
      }
      x += w;
    }
  }

  private _applyBlit(screen: Screen, op: BlitOperation, clipStack: Clip[]): void {
    // 带裁剪的 blit
    const clip = this._getEffectiveClip(clipStack);
    let { srcX, srcY, w, h, dstX, dstY } = op;

    if (clip) {
      if (clip.x1 !== undefined) {
        const diff = clip.x1 - dstX;
        if (diff > 0) {
          srcX += diff;
          dstX += diff;
          w -= diff;
        }
      }
      if (clip.y1 !== undefined) {
        const diff = clip.y1 - dstY;
        if (diff > 0) {
          srcY += diff;
          dstY += diff;
          h -= diff;
        }
      }
      if (clip.x2 !== undefined) {
        w = Math.min(w, clip.x2 - dstX + 1);
      }
      if (clip.y2 !== undefined) {
        h = Math.min(h, clip.y2 - dstY + 1);
      }
    }

    if (w <= 0 || h <= 0) return;
    screen.blitRegion(op.src, srcX, srcY, w, h, dstX, dstY);
  }
}
