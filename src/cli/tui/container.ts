/**
 * Container — TUI 容器组件
 *
 * 实现了 Component 接口，持有子组件列表。
 * OutputArea 继承此类并覆盖 render()/invalidate()。
 */

import type { Screen } from './screen';
import type { StylePool } from './style-pool';
import type { Component, Rect } from './types';

export class Container implements Component {
  protected children: Component[] = [];

  addChild(child: Component): void {
    this.children.push(child);
  }

  removeChild(child: Component): void {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
    }
  }

  getChildren(): Component[] {
    return this.children;
  }

  render(width: number): string[] {
    const result: string[] = [];
    for (const child of this.children) {
      const lines = child.render(width);
      result.push(...lines);
    }
    return result;
  }

  handleInput(data: string): void {
    for (const child of this.children) {
      child.handleInput?.(data);
    }
  }

  invalidate(): void {
    // Container 自身不维护 dirty 状态，子类（如 OutputArea）可覆盖
  }

  // -----------------------------------------------------------------------
  // Screen 渲染（新接口）
  // -----------------------------------------------------------------------

  /**
   * 渲染子组件到 Screen 缓冲区。
   * 由于 Container 是渲染树的内部节点，实际的布局计算在引擎层完成，
   * 此处将渲染委托给子组件。
   */
  renderToScreen(screen: Screen, stylePool: StylePool, rect: Rect): void {
    for (const child of this.children) {
      if (child.renderToScreen) {
        child.renderToScreen(screen, stylePool, rect);
      }
      // 若子组件未实现 renderToScreen，引擎层会通过旧接口回退处理
    }
  }
}
