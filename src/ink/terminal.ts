/**
 * Terminal — 终端 I/O 封装 + Diff 序列化
 *
 * 封装 Node.js process.stdin/stdout 的原始操作，
 * 提供 raw mode、光标控制、清屏等终端能力。
 *
 * PR2 增强：
 * - writeDiffToTerminal() — 将 Diff 序列化为 ANSI 写入 stdout
 * - BSU/ESU 同步输出支持
 * - 与 src/ink/termio/ 整合
 */

import { cursorTo as nodeCursorTo } from 'node:readline';
import type { Diff } from './frame';
import { CURSOR_HIDE, CURSOR_SHOW, cursorMove, cursorTo, eraseLines } from './termio/csi';
import { BSU, ESU } from './termio/dec';

// ---------------------------------------------------------------------------
// ProcessTerminal
// ---------------------------------------------------------------------------

export class ProcessTerminal {
  readonly stdin = process.stdin;
  readonly stdout = process.stdout;
  private resizeCallbacks: Array<() => void> = [];
  private resizeBound: (() => void) | null = null;

  get rows(): number {
    return (process.stdout as { rows?: number }).rows ?? 24;
  }

  get columns(): number {
    return (process.stdout as { columns?: number }).columns ?? 80;
  }

  enableRawMode(): void {
    if (this.stdin.isTTY) {
      this.stdin.setRawMode(true);
    }
  }

  disableRawMode(): void {
    if (this.stdin.isTTY) {
      this.stdin.setRawMode(false);
    }
  }

  write(data: string): void {
    this.stdout.write(data);
  }

  /** 清屏并将光标移动到 (0, 0) */
  clear(): void {
    this.write('\x1b[2J\x1b[3J');
    this.cursorTo(0, 0);
  }

  /** 移动光标到指定列、行（0-based） */
  cursorTo(x: number, y: number): void {
    nodeCursorTo(this.stdout, x, y);
  }

  /** 注册终端 resize 回调 */
  onResize(callback: () => void): void {
    this.resizeCallbacks.push(callback);
    if (!this.resizeBound) {
      this.resizeBound = () => {
        for (const cb of this.resizeCallbacks) {
          cb();
        }
      };
      process.stdout.on('resize', this.resizeBound);
    }
  }

  /** 销毁 */
  destroy(): void {
    this.disableRawMode();
    if (this.resizeBound) {
      process.stdout.removeListener('resize', this.resizeBound);
      this.resizeBound = null;
    }
    this.resizeCallbacks = [];
  }
}

// ---------------------------------------------------------------------------
// Terminal synchronization output detection
// ---------------------------------------------------------------------------

let _syncOutputSupported: boolean | undefined;
/** @internal XTVERSION probe result (used in writeDiffToTerminal) */
let _xtversionName: string | undefined;
/**
 * 检测终端是否支持同步输出 (DEC 2026 BSU/ESU)。
 * PR2: 默认假设支持。PR6 做真正的终端查询。
 */
export function isSynchronizedOutputSupported(): boolean {
  if (_syncOutputSupported === undefined) {
    // 默认 true，后续 PR 通过终端查询精确判断
    _syncOutputSupported = true;
  }
  return _syncOutputSupported;
}

export function setXtversionName(name: string): void {
  _xtversionName = name;
}

export function getXtversionName(): string | undefined {
  return _xtversionName;
}

// ---------------------------------------------------------------------------
// writeDiffToTerminal
// ---------------------------------------------------------------------------

/**
 * 将 Diff 补丁序列写入终端。
 *
 * @param terminal  终端实例
 * @param diff      Diff 补丁序列
 */
export function writeDiffToTerminal(terminal: ProcessTerminal, diff: Diff): void {
  if (diff.length === 0) return;

  const useBsu = isSynchronizedOutputSupported();
  let result = '';

  // BSU 开始同步
  if (useBsu) result += BSU;

  // 序列化所有补丁
  for (const patch of diff) {
    switch (patch.type) {
      case 'stdout':
        result += patch.content;
        break;
      case 'clear':
        result += eraseLines(patch.count);
        break;
      case 'clearTerminal':
        // 全屏清空
        result += '\x1b[2J\x1b[3J\x1b[H';
        break;
      case 'cursorHide':
        result += CURSOR_HIDE;
        break;
      case 'cursorShow':
        result += CURSOR_SHOW;
        break;
      case 'cursorMove':
        result += cursorMove(patch.x, patch.y);
        break;
      case 'cursorTo':
        result += cursorTo(patch.col);
        break;
      case 'carriageReturn':
        result += '\r';
        break;
      case 'styleStr':
        result += patch.str;
        break;
      case 'hyperlink':
        // 后续 PR 实现
        break;
    }
  }

  // ESU 结束同步
  if (useBsu) result += ESU;

  terminal.write(result);
}
