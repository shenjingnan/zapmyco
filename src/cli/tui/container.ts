/**
 * Container — TUI 容器组件
 *
 * 实现了 Component 接口，持有子组件列表。
 * OutputArea 继承此类并覆盖 render()/invalidate()。
 */

import type { Component } from './types';

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
}
