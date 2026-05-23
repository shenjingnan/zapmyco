/**
 * Ink — 核心编排器
 *
 * 管理 React reconciler container、渲染生命周期和终端 I/O。
 * 完整的渲染管线：
 *   React commit → Yoga layout → renderNodeToOutput → Screen diff → Terminal output
 *
 * PR2 完整实现：连接所有管线阶段。
 * 后续 PR 将添加 selection、search highlight、pool GC 等特性。
 */

import type { ReactNode } from 'react';
import { LegacyRoot } from 'react-reconciler/constants.js';
import { setClipboard } from '@/cli/tui/clipboard';
import { StylePool } from '@/cli/tui/style-pool';
import type { DOMElement } from './dom';
import { createNode } from './dom';
import type { Frame } from './frame';
import { emptyFrame } from './frame';
import { LogUpdate } from './log-update';
import { optimize } from './optimizer';
import reconciler from './reconciler';
import { createRenderer } from './renderer';
import {
  applySelectionOverlay,
  captureScrolledRows,
  clearSelection as clearSelectionState,
  createSelectionState,
  extendSelection,
  type FocusMove,
  finishSelection,
  getSelectedText,
  hasSelection,
  moveFocus,
  type SelectionState,
  selectLineAt,
  selectWordAt,
  shiftAnchor,
  shiftSelection,
  startSelection,
  updateSelection,
} from './selection';
import { ProcessTerminal, writeDiffToTerminal } from './terminal';
import { DEC, decreset, decset } from './termio/dec';

export interface InkOptions {
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
  debug?: boolean;
  exitOnCtrlC?: boolean;
  patchConsole?: boolean;
}

/**
 * Ink — 核心编排器。
 *
 * 管理 React reconciler container、渲染生命周期和清理。
 * start/stop 控制终端界面生命周期。
 */
export class Ink {
  private readonly rootNode: DOMElement;
  private readonly container: ReturnType<typeof reconciler.createContainer>;
  readonly terminal: ProcessTerminal;
  private isUnmounted = false;

  /** 样式池 */
  private stylePool: StylePool;

  /** 双缓冲 */
  private frontFrame: Frame;
  private backFrame: Frame;

  /** Diff 引擎 */
  private logUpdate: LogUpdate;

  /** 渲染器 */
  private renderFrame: ReturnType<typeof createRenderer>;

  /** 渲染调度 */
  private renderScheduled = false;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  /** 调试 */
  private debug: boolean;

  // ---------------------------------------------------------------------------
  // 文本选择
  // ---------------------------------------------------------------------------

  /** 文本选择状态（仅备选屏幕模式） */
  readonly selection: SelectionState = createSelectionState();

  /** 选择状态变化监听器（用于 useHasSelection） */
  private readonly selectionListeners = new Set<() => void>();

  /** 鼠标事件追踪 */
  private mouseEnabled = false;

  /** 多击追踪 */
  private clickCount = 0;
  private lastClickTime = 0;
  private lastClickCol = -1;
  private lastClickRow = -1;

  /** stdin 数据缓冲区 */
  private stdinBuffer = '';

  constructor(options?: InkOptions) {
    this.debug = options?.debug ?? false;

    this.terminal = new ProcessTerminal();

    // 样式池
    this.stylePool = new StylePool();

    // 根 DOM 节点
    this.rootNode = createNode('ink-root');

    // 挂载渲染生命周期回调
    this.rootNode.onComputeLayout = this.calculateLayout;
    this.rootNode.onRender = this.onRender;

    // 创建 reconciler container
    this.container = reconciler.createContainer(
      this.rootNode,
      LegacyRoot,
      null,
      false,
      null,
      '',
      () => {},
      () => {},
      () => {},
      () => {}
    );

    // 初始化双缓冲
    const { rows, columns } = this.terminal;
    this.frontFrame = emptyFrame(rows, columns);
    this.backFrame = emptyFrame(rows, columns);

    // Diff 引擎
    this.logUpdate = new LogUpdate(this.stylePool);

    // 渲染器
    this.renderFrame = createRenderer(this.rootNode);

    // 终端 resize 监听
    this.terminal.onResize(() => this.handleResize());
  }

  /** 渲染 React 组件树 */
  render(node: ReactNode): void {
    reconciler.updateContainerSync(node, this.container, null, () => {});
    reconciler.flushSyncWork();
  }

  /** 卸载 React 树并清理 */
  unmount(_error?: Error): void {
    if (this.isUnmounted) return;
    this.isUnmounted = true;

    // 取消排队的渲染
    this.cancelScheduledRender();

    reconciler.updateContainerSync(null, this.container, null, () => {});
    reconciler.flushSyncWork();

    this.disableMouse();
    this.terminal.destroy();
  }

  /** 启动终端会话 */
  start(): void {
    this.terminal.enableRawMode();
    this.terminal.clear();
    this.enableMouse();
    this.setupStdinListener();
    this.requestRender();
  }

  /** 等待直到退出 */
  async waitUntilExit(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.isUnmounted) resolve();
        else setImmediate(check);
      };
      check();
    });
  }

  // ---------------------------------------------------------------------------
  // 渲染调度
  // ---------------------------------------------------------------------------

  /** 请求一次渲染 */
  requestRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;

    // 使用 setTimeout 节流
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.flush();
    }, 16); // ~60fps
  }

  /** 取消排队的渲染 */
  private cancelScheduledRender(): void {
    this.renderScheduled = false;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
  }

  /** 立即执行渲染 */
  private flush(): void {
    if (!this.renderScheduled) return;
    this.renderScheduled = false;

    const { columns, rows } = this.terminal;

    // 交换双缓冲
    const temp = this.backFrame;
    this.backFrame = this.frontFrame;
    this.frontFrame = temp;

    // 执行渲染
    const { frame } = this.renderFrame({
      terminalWidth: columns,
      terminalHeight: rows,
      prevScreen: this.backFrame.screen,
    });

    // 交换帧引用
    this.frontFrame = frame;

    // 在选择进行中时，应用选择覆盖到前帧的 Screen buffer
    // 在 diff 之前修改，使 diff 引擎将选择变化当作普通 cell 变化
    if (hasSelection(this.selection)) {
      applySelectionOverlay(this.frontFrame.screen, this.selection, this.stylePool);
    }

    // Diff
    const diff = this.logUpdate.render(this.backFrame, this.frontFrame);

    // 优化
    const optimizedDiff = optimize(diff);

    // 写出
    if (optimizedDiff.length > 0) {
      writeDiffToTerminal(this.terminal, optimizedDiff);
      if (this.debug) {
        this.stdout.write(`\x1b[2K\x1b[0m[ink] patches: ${optimizedDiff.length}\r\n`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 生命周期回调 (由 reconciler 触发)
  // ---------------------------------------------------------------------------

  /** 计算布局 — 设置 Yoga 尺寸并计算布局 */
  private calculateLayout = (): void => {
    const rootYoga = this.rootNode.yogaNode;
    if (!rootYoga) return;

    const { columns, rows } = this.terminal;
    rootYoga.setWidth(columns);
    rootYoga.setHeight(rows);
    rootYoga.calculateLayout(columns, rows);
  };

  /** 渲染回调 — 触发渲染管线 */
  private onRender = (): void => {
    this.requestRender();
  };

  // ---------------------------------------------------------------------------
  // 事件处理
  // ---------------------------------------------------------------------------

  /** 处理终端 resize */
  private handleResize(): void {
    this.cancelScheduledRender();
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // 鼠标事件
  // ---------------------------------------------------------------------------

  /** 启用鼠标跟踪 */
  private enableMouse(): void {
    if (this.mouseEnabled) return;
    this.mouseEnabled = true;
    this.terminal.write(decset(DEC.MOUSE_BUTTON));
    this.terminal.write(decset(DEC.MOUSE_SGR));
  }

  /** 禁用鼠标跟踪 */
  private disableMouse(): void {
    if (!this.mouseEnabled) return;
    this.mouseEnabled = false;
    this.terminal.write(decreset(DEC.MOUSE_NORMAL));
    this.terminal.write(decreset(DEC.MOUSE_BUTTON));
    this.terminal.write(decreset(DEC.MOUSE_ANY));
    this.terminal.write(decreset(DEC.MOUSE_SGR));
  }

  /** 设置 stdin 数据监听器 */
  private setupStdinListener(): void {
    this.terminal.stdin.on('data', (data: Buffer) => {
      const chunk = data.toString('utf-8');
      this.stdinBuffer += chunk;

      // 尝试解析 SGR 鼠标事件
      if (this.handleSgrMouse()) return;

      // 处理其他输入（Escape 清除选择）
      if (chunk === '\x1b') {
        this.handleEscapeKey();
      }
    });
  }

  /** 解析并处理 SGR 鼠标事件。返回 true 如果事件被消耗。 */
  private handleSgrMouse(): boolean {
    const buf = this.stdinBuffer;
    if (!buf.includes('\x1b[<')) return false;

    // 尝试匹配最长的完整 SGR 序列
    const match = buf.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (!match) return false;

    const btnStr = match[1]!;
    const colStr = match[2]!;
    const rowStr = match[3]!;
    const terminator = match[4]!;
    const button = Number.parseInt(btnStr, 10);
    const col = Number.parseInt(colStr, 10) - 1; // 1-based → 0-based
    const row = Number.parseInt(rowStr, 10) - 1;
    const isRelease = terminator === 'm';

    // 从缓冲区移除已处理的序列
    this.stdinBuffer = this.stdinBuffer.slice(match[0].length);

    // 忽略超出范围的坐标
    if (col < 0 || row < 0) return true;

    if (isRelease) {
      this.handleMouseRelease();
      return true;
    }

    const sgrButton = button & 0x03; // 低 2 位 = 按钮编号
    const isMotion = (button & 0x20) !== 0; // 位 6 = 拖拽

    if (isMotion) {
      this.handleMouseDrag(sgrButton, col, row);
    } else {
      this.handleMousePress(sgrButton, col, row);
    }
    return true;
  }

  /** 处理鼠标按下 */
  private handleMousePress(button: number, col: number, row: number): void {
    const now = Date.now();
    const samePos = col === this.lastClickCol && row === this.lastClickRow;
    const withinTime = now - this.lastClickTime < 500;

    if (samePos && withinTime) {
      this.clickCount++;
    } else {
      this.clickCount = 1;
    }

    this.lastClickTime = now;
    this.lastClickCol = col;
    this.lastClickRow = row;

    if (button === 0) {
      // 左键：开始选择
      if (this.clickCount === 1) {
        startSelection(this.selection, col, row);
      } else if (this.clickCount === 2) {
        selectWordAt(this.selection, this.frontFrame.screen, col, row);
      } else {
        selectLineAt(this.selection, this.frontFrame.screen, row);
      }
      // 确保 hasSelection 为 true
      if (!this.selection.focus) {
        this.selection.focus = this.selection.anchor ? { ...this.selection.anchor } : null;
      }
      this.notifySelectionChange();
      this.requestRender();
    } else if (button === 2) {
      // 右键：复制选中文本
      this.copySelection();
    }
  }

  /** 处理鼠标拖拽 */
  private handleMouseDrag(_button: number, col: number, row: number): void {
    const sel = this.selection;
    if (!sel.isDragging) return;

    if (sel.anchorSpan) {
      extendSelection(sel, this.frontFrame.screen, col, row);
    } else {
      updateSelection(sel, col, row);
    }
    this.notifySelectionChange();
    this.requestRender();
  }

  /** 处理鼠标释放 */
  private handleMouseRelease(): void {
    finishSelection(this.selection);
    this.notifySelectionChange();
    this.requestRender();
    // 重置 clickCount 延迟（鼠标移开后重置）
    setTimeout(() => {
      if (!this.selection.isDragging) {
        this.clickCount = 0;
      }
    }, 500);
  }

  /** 处理 Escape 键：清除选择 */
  private handleEscapeKey(): void {
    if (hasSelection(this.selection)) {
      this.clearTextSelection();
      this.requestRender();
    }
  }

  // ---------------------------------------------------------------------------
  // 选择操作
  // ---------------------------------------------------------------------------

  /**
   * 将当前选择文本复制到系统剪贴板，不清除选择高亮。
   * 返回复制的文本（无选择时返回空字符串）。
   */
  copySelectionNoClear(): string {
    if (!hasSelection(this.selection)) return '';
    return getSelectedText(this.selection, this.frontFrame.screen);
  }

  /**
   * 复制选择文本到剪贴板并清除选择。
   */
  copySelection(): string {
    if (!hasSelection(this.selection)) return '';
    const text = this.copySelectionNoClear();
    if (text) {
      const seq = setClipboard(text);
      if (seq) this.terminal.write(seq);
    }
    clearSelectionState(this.selection);
    this.notifySelectionChange();
    return text;
  }

  /** 清除文本选择（不复制） */
  clearTextSelection(): void {
    if (!hasSelection(this.selection)) return;
    clearSelectionState(this.selection);
    this.notifySelectionChange();
  }

  /** 是否有活跃的文本选择 */
  hasTextSelection(): boolean {
    return hasSelection(this.selection);
  }

  /** 订阅选择状态变化 */
  subscribeToSelectionChange(cb: () => void): () => void {
    this.selectionListeners.add(cb);
    return () => this.selectionListeners.delete(cb);
  }

  /** 通知选择状态变化 */
  private notifySelectionChange(): void {
    for (const cb of this.selectionListeners) {
      try {
        cb();
      } catch {
        // 忽略单个监听器错误
      }
    }
  }

  /**
   * 拖拽滚动时偏移 anchor（仅 anchor 跟随内容移动，focus 在鼠标位置）。
   */
  shiftAnchor(dRow: number, minRow: number, maxRow: number): void {
    shiftAnchor(this.selection, dRow, minRow, maxRow);
  }

  /**
   * 在 ScrollBox 滚出前捕获选中行的文本。
   */
  captureScrolledRows(firstRow: number, lastRow: number, side: 'above' | 'below'): void {
    captureScrolledRows(this.selection, this.frontFrame.screen, firstRow, lastRow, side);
  }

  /**
   * 键盘滚动选择偏移。
   */
  shiftSelectionForScroll(dRow: number, minRow: number, maxRow: number): void {
    const hadSel = hasSelection(this.selection);
    shiftSelection(this.selection, dRow, minRow, maxRow, this.frontFrame.screen.cols);
    if (hadSel && !hasSelection(this.selection)) {
      this.notifySelectionChange();
    }
  }

  /**
   * 键盘选择扩展（shift+方向键）。
   */
  moveSelectionFocus(move: FocusMove): void {
    if (!this.selection.focus) return;
    const { focus } = this.selection;
    let col = focus.col;
    let row = focus.row;

    switch (move) {
      case 'left':
        col = Math.max(0, col - 1);
        break;
      case 'right':
        col = Math.min(this.frontFrame.screen.cols - 1, col + 1);
        break;
      case 'up':
        row = Math.max(0, row - 1);
        break;
      case 'down':
        row = Math.min(this.frontFrame.screen.rows - 1, row + 1);
        break;
      case 'lineStart':
        col = 0;
        break;
      case 'lineEnd':
        col = this.frontFrame.screen.cols - 1;
        break;
    }

    moveFocus(this.selection, col, row);
    this.notifySelectionChange();
  }

  // ---------------------------------------------------------------------------
  // debug
  // ---------------------------------------------------------------------------

  private get stdout(): NodeJS.WriteStream {
    return this.terminal.stdout;
  }
}
