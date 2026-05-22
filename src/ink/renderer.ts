import { DEFAULT_TERMINAL_HEIGHT, DEFAULT_TERMINAL_WIDTH } from './constants';
import type { DOMElement } from './dom';
import { Output } from './output';

/**
 * 遍历 DOM 树，生成终端输出字符串。
 *
 * PR1 最小实现：深度优先遍历子节点，将文本节点写入 Output。
 * 后续 PR 集成 Yoga 布局（使用计算后的 x/y/w/h）和样式应用。
 */
export function renderToOutput(node: DOMElement): {
  output: string;
  height: number;
} {
  const yogaWidth = DEFAULT_TERMINAL_WIDTH;
  const yogaHeight = DEFAULT_TERMINAL_HEIGHT;
  const output = new Output({ width: yogaWidth, height: yogaHeight });

  renderNode(node, output, 0, 0);

  return output.get();
}

function renderNode(node: DOMElement, output: Output, _x: number, _y: number): void {
  for (const child of node.childNodes) {
    if (child.nodeName === '#text') {
      output.write(_x, _y, child.nodeValue);
    } else if ('childNodes' in child) {
      // 递归渲染子 DOMElement
      renderNode(child as DOMElement, output, _x, _y);
    }
  }
}
