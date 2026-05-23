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
import {
  CURSOR_HIDE,
  CURSOR_SHOW,
  cursorMove,
  cursorTo,
  eraseLines,
  RESET_SCROLL_REGION,
  scrollDown,
  scrollUp,
  setScrollRegion,
} from './termio/csi';
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

  /** 终端色彩级别 */
  get colorLevel(): ColorLevel {
    return getColorLevel();
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
// Terminal capability detection
// ---------------------------------------------------------------------------

let _syncOutputSupported: boolean | undefined;
/** @internal XTVERSION probe result (used in writeDiffToTerminal) */
let _xtversionName: string | undefined;

/**
 * 检测终端是否支持同步输出 (DEC 2026 BSU/ESU)。
 *
 * 支持矩阵：
 * - iTerm2: 支持
 * - WezTerm: 支持
 * - Warp: 支持
 * - kitty: 支持
 * - ghostty: 支持
 * - VTE >= 6800: 支持
 * - tmux: 不支持（即使底层终端支持，tmux 会破坏同步）
 * - Terminal.app: 不支持
 * - Windows Terminal: 不支持
 *
 * PR6: 使用环境变量检测替代硬编码 true。
 */
export function detectSyncOutputSupport(): boolean {
  const termProgram = process.env.TERM_PROGRAM ?? '';
  const term = process.env.TERM ?? '';

  // tmux 特殊处理：即使底层终端支持，tmux 会破坏同步
  if (termProgram === 'tmux' || term.includes('tmux')) {
    return false;
  }

  // 已知支持的终端
  const supported = [
    'iTerm.app', // iTerm2
    'WezTerm', // WezTerm
    'warp-terminal', // Warp
    'kitty', // kitty
    'ghostty', // ghostty
    'vscode', // VS Code terminal（基于 xterm.js）
  ];

  if (supported.includes(termProgram)) return true;

  // VTE >= 6800: 检查 TERM 包含 vte
  if (term.includes('vte')) return true;

  // 默认不支持（保守策略）
  return false;
}

/**
 * 查询终端是否支持同步输出。
 * 首次调用后缓存结果。
 */
export function isSynchronizedOutputSupported(): boolean {
  if (_syncOutputSupported === undefined) {
    _syncOutputSupported = detectSyncOutputSupport();
  }
  return _syncOutputSupported;
}

/** 色彩级别 */
export type ColorLevel = 'truecolor' | '256' | '16' | '8';

/**
 * 检测终端色彩级别。
 * 使用 Node.js `process.stdout.getColorDepth()`。
 */
export function detectColorLevel(): ColorLevel {
  const colorDepth = (process.stdout as { getColorDepth?: () => number }).getColorDepth?.();
  if (colorDepth === undefined) return '16';

  // Node.js getColorDepth() 返回值：
  // 1  → 8 色
  // 4  → 16 色
  // 8  → 256 色
  // 24 → truecolor (16.7M)
  if (colorDepth >= 24) return 'truecolor';
  if (colorDepth >= 8) return '256';
  if (colorDepth >= 4) return '16';
  return '8';
}

/**
 * 获取终端色彩级别（缓存结果）。
 */
let _colorLevel: ColorLevel | undefined;
export function getColorLevel(): ColorLevel {
  if (_colorLevel === undefined) {
    _colorLevel = detectColorLevel();
  }
  return _colorLevel;
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
      case 'setScrollRegion':
        result += setScrollRegion(patch.top, patch.bottom);
        break;
      case 'scrollUp':
        result += scrollUp(patch.count);
        break;
      case 'scrollDown':
        result += scrollDown(patch.count);
        break;
      case 'resetScrollRegion':
        result += RESET_SCROLL_REGION;
        break;
    }
  }

  // ESU 结束同步
  if (useBsu) result += ESU;

  terminal.write(result);
}
