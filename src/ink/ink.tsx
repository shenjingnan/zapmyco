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
import { StylePool } from '@/cli/tui/style-pool';
import type { DOMElement } from './dom';
import { createNode } from './dom';
import type { Frame } from './frame';
import { emptyFrame } from './frame';
import { LogUpdate } from './log-update';
import { optimize } from './optimizer';
import reconciler from './reconciler';
import { createRenderer } from './renderer';
import { ProcessTerminal, writeDiffToTerminal } from './terminal';

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

    this.terminal.destroy();
  }

  /** 启动终端会话 */
  start(): void {
    this.terminal.enableRawMode();
    this.terminal.clear();
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
  // debug
  // ---------------------------------------------------------------------------

  private get stdout(): NodeJS.WriteStream {
    return this.terminal.stdout;
  }
}
