import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import GridLayout, { GridItem } from './GridLayout';
import { type HassEntity } from 'home-assistant-js-websocket';

// 模拟DOM环境
import { JSDOM } from 'jsdom';

// 创建一个JSDOM实例
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// 创建模拟实体
const createMockEntity = (entityId: string): HassEntity => ({
  entity_id: entityId,
  state: 'on',
  attributes: {},
  last_changed: '',
  last_updated: '',
  context: { id: '', parent_id: null, user_id: null },
});

// 简化的测试
describe('GridLayout', () => {
  // 基本测试数据
  const mockItems: Record<string, GridItem> = {
    '1': {
      id: '1',
      entity: createMockEntity('light.living_room'),
      size: { width: 2, height: 2 },
      position: { x: 0, y: 0 },
    },
  };

  const renderItem = (item: GridItem) => (
    <div data-testid={`item-${item.id}`}>{item.entity.entity_id}</div>
  );

  const mockOnDragEnd = vi.fn();
  const mockOnLayoutChange = vi.fn();

  // 最简单的测试：组件能否渲染
  it('renders without crashing', () => {
    // 使用mock函数替代getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));

    // 简单渲染测试
    const { container } = render(
      <GridLayout
        items={mockItems}
        renderItem={renderItem}
        onDragEnd={mockOnDragEnd}
        onLayoutChange={mockOnLayoutChange}
      />
    );

    expect(container).toBeTruthy();
  });
});
