/**
 * ProcessTerminal — 进程级终端 I/O 封装
 *
 * 封装 Node.js process.stdin/stdout 的原始操作，
 * 提供 raw mode、光标控制、清屏等终端能力。
 */

import { cursorTo } from 'node:readline';
import { ENTER_ALT_SCREEN, EXIT_ALT_SCREEN } from './dec';

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
      // 进入 Alternate Screen Buffer
      this.write(ENTER_ALT_SCREEN);
      // 启用鼠标事件追踪：按钮事件（含滚轮）+ SGR 扩展模式
      this.write('\x1b[?1002h\x1b[?1006h');
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

  /** 销毁：关闭鼠标追踪、退出 alt screen、恢复 raw mode、移除 resize 监听 */
  destroy(): void {
    // 关闭鼠标事件追踪
    this.write('\x1b[?1002l\x1b[?1006l');
    // 退出 Alternate Screen Buffer，恢复主屏幕内容
    this.write(EXIT_ALT_SCREEN);
    this.disableRawMode();
    if (this.resizeBound) {
      process.stdout.removeListener('resize', this.resizeBound);
      this.resizeBound = null;
    }
    this.resizeCallbacks = [];
  }
}
