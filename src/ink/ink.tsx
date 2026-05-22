import type { ReactNode } from 'react';
import { LegacyRoot } from 'react-reconciler/constants.js';
import type { DOMElement } from './dom';
import { createNode } from './dom';
import reconciler from './reconciler';
import { ProcessTerminal } from './terminal';

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

  constructor(_options?: InkOptions) {
    this.terminal = new ProcessTerminal();
    this.rootNode = createNode('ink-root');

    // 挂载渲染生命周期回调
    this.rootNode.onComputeLayout = this.calculateLayout;
    this.rootNode.onRender = this.onRender;

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
    reconciler.updateContainerSync(null, this.container, null, () => {});
    reconciler.flushSyncWork();
    this.terminal.destroy();
  }

  /** 计算布局 — PR1: no-op，后续 PR 集成 Yoga */
  private calculateLayout = (): void => {
    // PR1: 无操作。后续: rootNode.yogaNode.setWidth(terminal.columns)
  };

  /** 渲染回调 — PR1: no-op，后续 PR 集成交付管线 */
  private onRender = (): void => {
    // PR1: 无操作。后续: renderToOutput() → terminal.write()
  };

  /** 启动终端会话 */
  start(): void {
    this.terminal.enableRawMode();
    this.terminal.clear();
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
}
