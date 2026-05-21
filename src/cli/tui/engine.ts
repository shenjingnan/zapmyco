/**
 * TUI — 终端 UI 引擎
 *
 * 本地实现的 TUI 引擎。
 * 管理渲染循环（16ms setInterval）、组件树、焦点、Overlay 栈、差量渲染。
 *
 * ### 渲染流程
 * ```
 * 16ms setInterval 驱动:
 *   1. dirty=true 触发 doRender()
 *   2. computeOutput() — 渲染组件树 → 应用 overlay
 *   3. force=true → 清屏全量重写；否则逐行 diff 差量更新
 *   4. 定位硬件光标
 *   5. 保存 lastOutput 供下帧 diff
 * ```
 *
 * ### AnimationManager 兼容
 * doRender 为公共方法，可被 AnimationManager monkey-patch 替换，
 * 在渲染前插入动画帧推进回调。
 *
 * ### 光标标记
 * Editor 在渲染输出中嵌入光标标记（\\u001B_pi:c\\u0007），
 * TUI 扫描、移除标记并将硬件光标定位到对应位置。
 */

import { writeSync } from 'node:fs';
import { Container } from './container';
import type { ProcessTerminal } from './terminal';
import type { Component, OverlayHandle, OverlayMargin, OverlayOptions } from './types';

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

interface OverlayEntry {
  component: Component;
  options: OverlayOptions;
}

interface OverlayRect {
  row: number;
  col: number;
  width: number;
  height: number;
}

/** 光标标记 — Editor 在渲染输出末尾嵌入，TUI 据此定位硬件光标 */
const CURSOR_MARKER = '\u001B_pi:c\u0007';
// biome-ignore lint/suspicious/noControlCharactersInRegex: CURSOR_MARKER 包含 ESC 和 BEL 控制字符
const CURSOR_MARKER_RE = /\u001B_pi:c\u0007/g;

/** 默认渲染间隔（ms） */
const RENDER_INTERVAL = 16;

// ---------------------------------------------------------------------------
// TUI 引擎
// ---------------------------------------------------------------------------

export class TUI {
  readonly terminal: ProcessTerminal;

  /** 根容器（组件树的入口） */
  private root = new Container();

  /** Overlay 栈（后进先出） */
  private overlayStack: OverlayEntry[] = [];

  /** setInterval 定时器引用 */
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /** 是否有内容变化需要重绘 */
  private dirty = false;

  /** 是否强制全量重绘（resize / overlay 切换） */
  private force = false;

  /** 上一帧的输出行数组，用于逐行 diff */
  private lastOutput: string[] = [];

  /** 当前获得焦点的组件 */
  private focused: Component | null = null;

  /** 编辑器光标位置（从光标标记解析） */
  private cursorRow = -1;
  private cursorCol = -1;

  constructor(terminal: ProcessTerminal) {
    this.terminal = terminal;
  }

  // -----------------------------------------------------------------------
  // 公共组件树 API
  // -----------------------------------------------------------------------

  /** 添加子组件到根容器 */
  addChild(child: Component): void {
    this.root.addChild(child);
  }

  /** 设置焦点组件（接收键盘输入），同时设置组件的 focused 属性 */
  setFocus(component: Component): void {
    // 取消前一个组件的焦点
    if (this.focused && 'focused' in this.focused) {
      (this.focused as { focused: boolean }).focused = false;
    }
    this.focused = component;
    // 设置新组件的焦点（Editor/Input 据此决定是否嵌入光标标记）
    if (component && 'focused' in component) {
      (component as { focused: boolean }).focused = true;
    }
    this.requestRender();
  }

  // -----------------------------------------------------------------------
  // 生命周期
  // -----------------------------------------------------------------------

  /** 启动 TUI — 清屏、隐藏光标、启用 raw mode、启动渲染循环 */
  start(): void {
    // 启用 raw mode — 使 stdin 逐键送达而非行缓冲
    this.terminal.enableRawMode();

    // 隐藏硬件光标
    this.terminal.write('\x1b[?25l');
    this.terminal.clear();
    this.lastOutput = [];
    this.dirty = true;
    this.force = true;

    // 注册进程退出安全网 — 确保光标在任何退出路径下都能恢复
    process.on('exit', this.#exitHandler);

    // 注册 resize 回调
    this.terminal.onResize(() => {
      // 终端尺寸变化后强制全量重绘
      this.force = true;
      this.dirty = true;
    });

    // stdin 读取 — 分发给 overlay 或焦点组件
    this.terminal.stdin.on('data', (chunk: Buffer) => {
      const data = chunk.toString();
      if (this.overlayStack.length > 0) {
        // Overlay 模式：顶层 overlay 接收输入
        const top = this.overlayStack[this.overlayStack.length - 1]!;
        top.component.handleInput?.(data);
      } else if (this.focused) {
        this.focused.handleInput?.(data);
      }
    });

    // 渲染循环
    this.intervalId = setInterval(() => {
      if (this.dirty) {
        this.doRender();
        this.dirty = false;
        this.force = false;
      }
    }, RENDER_INTERVAL);
  }

  /** 停止 TUI — 恢复光标、清屏、清理定时器和事件 */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    process.removeListener('exit', this.#exitHandler);

    // 恢复硬件光标
    this.terminal.write('\x1b[?25h');
    this.terminal.cursorTo(0, this.terminal.rows);

    this.terminal.destroy();
    this.terminal.stdin.removeAllListeners('data');
    this.lastOutput = [];
    this.dirty = false;
    this.force = false;
  }

  // -----------------------------------------------------------------------
  // 渲染控制
  // -----------------------------------------------------------------------

  /**
   * 请求重绘。
   * @param force 设为 true 时强制全量重绘（默认 false，仅差量更新）
   */
  requestRender(force?: boolean): void {
    this.dirty = true;
    if (force) {
      this.force = true;
    }
  }

  /**
   * 公共渲染方法 — 供 AnimationManager monkey-patch。
   *
   * AnimationManager 通过替换此方法来插入动画帧推进回调：
   * ```
   * tuiObj.doRender = function() {
   *   // 推进动画帧
   *   for (const cb of callbacks) cb(now);
   *   // 调回原始 doRender
   *   originalDoRender.call(this);
   * };
   * ```
   */
  doRender(): void {
    const lines = this.computeOutput();

    if (this.force || this.lastOutput.length === 0) {
      this.forceFullRedraw(lines);
    } else {
      this.deltaUpdate(lines);
    }

    // 如果编辑器在渲染中嵌入了光标标记，定位硬件光标后重新显示
    if (this.cursorRow >= 0) {
      this.terminal.write('\x1b[?25h');
    }

    this.lastOutput = lines;
  }

  // -----------------------------------------------------------------------
  // Overlay 系统
  // -----------------------------------------------------------------------

  /**
   * 显示 Overlay。
   * @returns OverlayHandle 包含 hide() 方法用于关闭 overlay
   */
  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
    const entry: OverlayEntry = { component, options: options ?? {} };
    this.overlayStack.push(entry);
    this.force = true;
    this.dirty = true;
    return {
      hide: () => {
        const idx = this.overlayStack.indexOf(entry);
        if (idx >= 0) {
          this.overlayStack.splice(idx, 1);
        }
        this.force = true;
        this.dirty = true;
      },
    };
  }

  // --------------------------------------------------
  // 硬件光标控制（可选，供 ZapmycoEditor 使用）
  // --------------------------------------------------

  setShowHardwareCursor(visible: boolean): void {
    if (visible) {
      this.terminal.write('\x1b[?25h');
    } else {
      this.terminal.write('\x1b[?25l');
    }
  }

  /**
   * 进程退出时的安全网 — 强制恢复光标。
   * 在 process.on('exit') 中只能使用同步操作。
   */
  readonly #exitHandler = () => {
    writeSync(1, '\x1b[?25h');
  };

  // ======================================================================
  // 私有方法
  // ======================================================================

  /**
   * 计算完整输出 — 渲染组件树 → 应用 overlay → 限制行数
   */
  private computeOutput(): string[] {
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    this.cursorRow = -1;
    this.cursorCol = -1;

    // 1. 渲染根组件树
    let lines = this.root.render(width);

    // 2. 限制总行数 ≤ terminal.rows
    if (lines.length > height) {
      lines = lines.slice(lines.length - height);
    }

    // 3. 应用 overlay（从底向上，栈顶在最上面）
    for (const entry of this.overlayStack) {
      lines = this.applyOverlay(lines, entry);
    }

    // 4. 扫描并移除光标标记
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const markerIdx = line.indexOf(CURSOR_MARKER);
      if (markerIdx >= 0) {
        // 移除标记
        lines[i] = line.replace(CURSOR_MARKER_RE, '');
        // 计算标记位置的可见宽度（不含 ANSI 码）
        this.cursorRow = i;
        this.cursorCol = visibleWidth(line.substring(0, markerIdx));
      }
    }

    return lines;
  }

  /**
   * 将 overlay 渲染结果叠加到基础输出上
   */
  private applyOverlay(base: string[], entry: OverlayEntry): string[] {
    const width = this.terminal.columns;
    const overlayLines = entry.component.render(width);
    const rect = this.calculateOverlayRect(entry, overlayLines.length);

    const result = [...base];

    // 限制 overlay 高度不超过终端可用行数
    const clampedHeight = Math.min(rect.height, this.terminal.rows - rect.row);

    for (let i = 0; i < clampedHeight; i++) {
      const targetRow = rect.row + i;
      // 确保目标行存在
      while (targetRow >= result.length) {
        result.push('');
      }
      const overlayLine = i < overlayLines.length ? overlayLines[i]! : '';
      // 截断或填充到指定宽度
      result[targetRow] = overlayLine.padEnd(rect.width).slice(0, rect.width);
    }

    return result;
  }

  /**
   * 计算 overlay 的矩形区域（位置 + 尺寸）
   *
   * 所有现有 overlay 均使用 anchor: 'top-left'，布局逻辑：
   *  - width：百分比 → terminal.columns * pct；数字 → 直接使用；默认 100%
   *  - height：由内容决定，maxHeight 限制
   *  - row：margin.top（默认 0）
   *  - col：0
   */
  private calculateOverlayRect(entry: OverlayEntry, contentHeight: number): OverlayRect {
    const opts = entry.options;
    const tw = this.terminal.columns;
    const th = this.terminal.rows;

    // --- 宽度 ---
    let width = tw; // 默认 100%
    if (typeof opts.width === 'string' && opts.width.endsWith('%')) {
      const pct = Number.parseInt(opts.width, 10) / 100;
      width = Math.floor(tw * pct);
    } else if (typeof opts.width === 'number') {
      width = opts.width;
    }
    if (opts.minWidth) {
      width = Math.max(width, opts.minWidth);
    }
    width = Math.min(width, tw);

    // --- 高度 ---
    let height = contentHeight;
    if (opts.maxHeight) {
      if (typeof opts.maxHeight === 'string' && opts.maxHeight.endsWith('%')) {
        const pct = Number.parseInt(opts.maxHeight, 10) / 100;
        height = Math.min(height, Math.floor(th * pct));
      } else if (typeof opts.maxHeight === 'number') {
        height = Math.min(height, opts.maxHeight);
      }
    }
    height = Math.min(height, th);

    // --- 位置 ---
    let row = 0;
    if (opts.anchor === 'top-left' || !opts.anchor) {
      const margin = opts.margin;
      if (typeof margin === 'number') {
        row = margin;
      } else if (margin) {
        row = (margin as OverlayMargin).top ?? 0;
      }
    }
    const col = 0;

    return { row, col, width, height };
  }

  /**
   * 差量更新 — 逐行比较 lastOutput 与新输出，仅变更的行
   */
  private deltaUpdate(newOutput: string[]): void {
    const oldOutput = this.lastOutput;
    if (oldOutput.length === 0) {
      this.forceFullRedraw(newOutput);
      return;
    }

    const maxLen = Math.max(newOutput.length, oldOutput.length);
    const t = this.terminal;

    for (let i = 0; i < maxLen; i++) {
      if (i >= newOutput.length) {
        // 行被删除 → 清空
        t.cursorTo(0, i);
        t.write('\x1b[2K');
      } else if (i >= oldOutput.length || newOutput[i] !== oldOutput[i]) {
        // 新行或内容变化 → 覆写后清行尾（确保旧行无残留）
        t.cursorTo(0, i);
        t.write(newOutput[i] ?? '');
        t.write('\x1b[0K');
      }
    }

    // 定位硬件光标
    this.applyCursorPosition();
  }

  /**
   * 全量重绘 — 清屏后重新写入所有行
   */
  private forceFullRedraw(lines: string[]): void {
    const t = this.terminal;
    t.cursorTo(0, 0);

    // 写入所有行，每行后 \r\n（raw mode 下 \n 不回行首）
    for (let i = 0; i < lines.length; i++) {
      t.write(`${lines[i] ?? ''}\x1b[0K`);
      if (i < lines.length - 1) {
        t.write('\r\n');
      }
    }

    // 清空多余行
    if (this.lastOutput.length > lines.length) {
      for (let i = lines.length; i < this.lastOutput.length; i++) {
        t.cursorTo(0, i);
        t.write('\x1b[2K');
      }
    }

    // 定位硬件光标
    this.applyCursorPosition();
  }

  /** 定位硬件光标到编辑器光标位置 */
  private applyCursorPosition(): void {
    if (this.cursorRow >= 0 && this.cursorCol >= 0) {
      this.terminal.cursorTo(this.cursorCol, this.cursorRow);
    }
  }
}

// ======================================================================
// 工具函数
// ======================================================================

/** ANSI 转义序列正则（用于计算可见宽度时排除） */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列包含 ESC 控制字符
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** 计算字符串的可见宽度（排除 ANSI 码） */
function visibleWidth(text: string): number {
  // 简单实现：排除 ANSI 控制序列后取长度
  // 不考虑 CJK 双宽字符（因为用于光标定位列号，不影响正确性）
  return text.replace(ANSI_RE, '').length;
}
