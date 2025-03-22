import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GridLayout, { GridItem } from './GridLayout';
import { type HassEntity } from 'home-assistant-js-websocket';

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.ResizeObserver = class ResizeObserver {
  observe() {
    // empty
  }
  unobserve() {
    // empty
  }
  disconnect() {
    // empty
  }
};

const createMockEntity = (entityId: string): HassEntity => ({
  entity_id: entityId,
  state: 'on',
  attributes: {},
  last_changed: '',
  last_updated: '',
  context: { id: '', parent_id: null, user_id: null },
});

describe('GridLayout', () => {
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

  it('renders without crashing', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {
        // empty
      },
    }));

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
