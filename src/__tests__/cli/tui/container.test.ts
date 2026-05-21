/**
 * Container 组件单元测试
 */
import { describe, expect, it, vi } from 'vitest';
import { Container } from '@/cli/tui/container';
import type { Component } from '@/cli/tui/types';

/** 创建一个 Mock 子组件 */
function createMockComponent(renderOutput: string[] = []): Component {
  return {
    render: vi.fn(() => renderOutput),
    handleInput: vi.fn(),
    invalidate: vi.fn(),
  };
}

describe('Container', () => {
  describe('constructor', () => {
    it('应创建空的组件列表', () => {
      const container = new Container();
      expect(container.getChildren()).toEqual([]);
    });
  });

  describe('addChild', () => {
    it('应添加子组件到列表末尾', () => {
      const container = new Container();
      const child = createMockComponent();
      container.addChild(child);
      expect(container.getChildren()).toHaveLength(1);
      expect(container.getChildren()[0]).toBe(child);
    });

    it('应支持添加多个子组件', () => {
      const container = new Container();
      const child1 = createMockComponent();
      const child2 = createMockComponent();
      container.addChild(child1);
      container.addChild(child2);
      expect(container.getChildren()).toHaveLength(2);
    });
  });

  describe('removeChild', () => {
    it('应移除已添加的子组件', () => {
      const container = new Container();
      const child = createMockComponent();
      container.addChild(child);
      container.removeChild(child);
      expect(container.getChildren()).toHaveLength(0);
    });

    it('移除不存在的子组件不应报错', () => {
      const container = new Container();
      const child = createMockComponent();
      expect(() => container.removeChild(child)).not.toThrow();
    });

    it('应只移除指定的子组件', () => {
      const container = new Container();
      const child1 = createMockComponent();
      const child2 = createMockComponent();
      container.addChild(child1);
      container.addChild(child2);
      container.removeChild(child1);
      expect(container.getChildren()).toHaveLength(1);
      expect(container.getChildren()[0]).toBe(child2);
    });
  });

  describe('render', () => {
    it('空容器应返回空数组', () => {
      const container = new Container();
      expect(container.render(80)).toEqual([]);
    });

    it('应按顺序拼接子组件的渲染输出', () => {
      const container = new Container();
      container.addChild(createMockComponent(['line1', 'line2']));
      container.addChild(createMockComponent(['line3']));
      const result = container.render(80);
      expect(result).toEqual(['line1', 'line2', 'line3']);
    });

    it('应向子组件传递 width 参数', () => {
      const container = new Container();
      const child = createMockComponent(['line']);
      container.addChild(child);
      container.render(120);
      expect(child.render).toHaveBeenCalledWith(120);
    });
  });

  describe('handleInput', () => {
    it('应广播输入给所有子组件', () => {
      const container = new Container();
      const child1 = createMockComponent();
      const child2 = createMockComponent();
      container.addChild(child1);
      container.addChild(child2);
      container.handleInput('data');
      expect(child1.handleInput).toHaveBeenCalledWith('data');
      expect(child2.handleInput).toHaveBeenCalledWith('data');
    });

    it('没有子组件时不应报错', () => {
      const container = new Container();
      expect(() => container.handleInput('data')).not.toThrow();
    });

    it('子组件没有 handleInput 时应跳过', () => {
      const container = new Container();
      container.addChild({ render: () => [], invalidate: () => {} });
      expect(() => container.handleInput('data')).not.toThrow();
    });
  });

  describe('invalidate', () => {
    it('默认实现不应报错', () => {
      const container = new Container();
      expect(() => container.invalidate()).not.toThrow();
    });
  });
});
