/**
 * ProcessTerminal — 进程级终端 I/O 封装
 *
 * 封装 Node.js process.stdin/stdout 的原始操作，
 * 提供 raw mode、光标控制、清屏等终端能力。
 */

import { cursorTo } from 'node:readline';

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

  /** 清屏并将光标移动到 (1,1) */
  clear(): void {
    this.write('\x1b[2J\x1b[3J');
    this.cursorTo(0, 0);
  }

  /** 移动光标到指定列、行（0-based，终端内部控制为 1-based） */
  cursorTo(x: number, y: number): void {
    cursorTo(this.stdout, x, y);
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

  /** 销毁：恢复 raw mode、移除 resize 监听 */
  destroy(): void {
    this.disableRawMode();
    if (this.resizeBound) {
      process.stdout.removeListener('resize', this.resizeBound);
      this.resizeBound = null;
    }
    this.resizeCallbacks = [];
  }
}
