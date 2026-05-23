/**
 * renderer — 渲染管线编排
 *
 * 将 DOM 树通过以下管线处理为一帧 Frame：
 * DOM 树 → renderNodeToOutput() → Output 操作队列 → output.get() → Screen → Frame
 *
 * PR2 完整实现：使用 Yoga 布局和 Screen buffer 进行渲染。
 * PR6 增强：DECSTBM 硬件滚动检测 — 添加 scrollHint 到 Frame。
 */

import type { DOMElement } from './dom';
import type { Frame } from './frame';
import { Output } from './output';
import { renderNodeToOutput } from './render-node-to-output';
import type { Screen } from './screen';

// ---------------------------------------------------------------------------
// RenderOptions / RenderResult
// ---------------------------------------------------------------------------

export interface RenderOptions {
  terminalWidth: number;
  terminalHeight: number;
  prevScreen?: Screen;
}

export interface RenderResult {
  frame: Frame;
}

// ---------------------------------------------------------------------------
// createRenderer
// ---------------------------------------------------------------------------

/**
 * 创建渲染器函数。
 *
 * @param rootNode DOM 树根节点
 * @param stylePool 样式池
 * @returns 渲染器函数
 */
export function createRenderer(rootNode: DOMElement): (options: RenderOptions) => RenderResult {
  let output: Output | null = null;

  return (options: RenderOptions): RenderResult => {
    const { terminalWidth, terminalHeight, prevScreen } = options;

    // 创建或复用 Output 实例
    if (!output || output.width !== terminalWidth || output.height !== terminalHeight) {
      output = new Output({ width: terminalWidth, height: terminalHeight });
    }

    // 确保 output 的 screen 尺寸正确
    if (output.screen.rows !== terminalHeight || output.screen.cols !== terminalWidth) {
      output.screen.resize(terminalHeight, terminalWidth);
    }
    output.reset(terminalWidth, terminalHeight, output.screen);

    // 渲染 DOM 树到 Output
    renderNodeToOutput(rootNode, output, prevScreen ? { prevScreen } : undefined);

    // 应用操作到 Screen buffer
    const screen = output.get();

    // 构造 Frame
    const frame: Frame = {
      screen,
      viewport: { width: terminalWidth, height: terminalHeight },
      cursor: { x: 0, y: 0, visible: true },
    };

    return { frame };
  };
}
