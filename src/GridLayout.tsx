import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  pointerWithin,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { HassEntity } from 'home-assistant-js-websocket';
import { useMeasure } from 'react-use';

// 类型定义
interface CardProps {
  id: string | number;
  size: { width: number; height: number };
  content: React.ReactNode;
  position: { x: number; y: number };
}

// 常量定义
const GRID_COLUMNS = 16;
const GRID_ROWS = 9;
const GAP = 10;
const SCREEN_WIDTH = window.innerWidth;
const SCREEN_HEIGHT = window.innerHeight;
const CARD_BASE_WIDTH = (SCREEN_WIDTH - GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
const CARD_BASE_HEIGHT = (SCREEN_HEIGHT - GAP * (GRID_ROWS - 1)) / GRID_ROWS;

// 计算网格位置的工具函数
const calculateGridPosition = (col: number, row: number) => ({
  x: col * (CARD_BASE_WIDTH + GAP),
  y: row * (CARD_BASE_HEIGHT + GAP),
});

// 卡片内容组件
const CardContent = ({
  content,
  className = '',
}: {
  content: React.ReactNode;
  className?: string;
}) => (
  <div className={`flex h-full w-full items-center justify-center ${className}`}>{content}</div>
);

// 可拖拽卡片组件
const DraggableCard = (item: CardProps) => {
  const { width, height } = item.size;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(
      transform
        ? {
            x: transform.x,
            y: transform.y,
            scaleX: 1,
            scaleY: 1,
          }
        : null
    ),
    width: `${CARD_BASE_WIDTH * width + GAP * (width - 1)}px`,
    height: `${CARD_BASE_HEIGHT * height + GAP * (height - 1)}px`,
    position: 'absolute' as const,
    left: item.position.x,
    top: item.position.y,
    touchAction: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`select-none ${isDragging ? 'z-50 opacity-50' : 'z-0 opacity-100'}`}
    >
      <CardContent content={item.content} />
    </div>
  );
};

interface GridItem {
  id: string | number;
  entity: HassEntity;
  size: { width: number; height: number };
  position: { x: number; y: number };
}
interface GridLayoutProps {
  items: GridItem[];
  renderItem: (item: GridItem) => React.ReactNode;
}

// 主网格布局组件
const GridLayout = (props: GridLayoutProps) => {
  const [containerRef, { width, height }] = useMeasure();

  // 传感器设置
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 8,
    },
  });

  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 100,
      tolerance: 8,
    },
  });

  const sensors = useSensors(mouseSensor, touchSensor);

  const swapCard = useCallback((item: GridItem, content: React.ReactNode) => {
    const position = calculateGridPosition(item.position.x, item.position.y);
    return {
      id: item.id,
      size: item.size,
      content,
      position,
    };
  }, []);

  // 状态管理
  const [items, setItems] = useState<CardProps[]>([]);
  useEffect(() => {
    setItems(() => {
      return props.items.map((item) => {
        return swapCard(item, props.renderItem(item));
      });
    });
  }, [props, props.items, props.renderItem, swapCard]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [originalPositions, setOriginalPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});

  const { setNodeRef } = useDroppable({
    id: 'droppable-area',
  });

  const activeItem = activeId ? items.find((item) => item.id === activeId) : null;

  // 容器样式
  const containerStyle = useMemo(
    () => ({
      width: '100%',
      height: '100vh',
      position: 'relative' as const,
      borderRadius: '8px',
    }),
    []
  );

  // 网格对齐函数
  const snapToGrid = (x: number, y: number) => {
    const gridX = Math.round(x / (CARD_BASE_WIDTH + GAP)) * (CARD_BASE_WIDTH + GAP);
    const gridY = Math.round(y / (CARD_BASE_HEIGHT + GAP)) * (CARD_BASE_HEIGHT + GAP);
    return { x: gridX, y: gridY };
  };

  // 碰撞检测
  const checkCollision = useCallback(
    (newPosition: { x: number; y: number }, width: number, height: number, currentId: string) => {
      // 检查边界
      if (
        newPosition.x < 0 ||
        newPosition.y < 0 ||
        newPosition.x + width * CARD_BASE_WIDTH + (width - 1) * GAP > SCREEN_WIDTH ||
        newPosition.y + height * CARD_BASE_HEIGHT + (height - 1) * GAP > SCREEN_HEIGHT
      ) {
        return true;
      }

      // 将位置转换为网格坐标
      const gridX = Math.round(newPosition.x / (CARD_BASE_WIDTH + GAP));
      const gridY = Math.round(newPosition.y / (CARD_BASE_HEIGHT + GAP));

      // 检查与其他卡片的碰撞
      return items.some((item) => {
        if (item.id === currentId) return false;

        const itemGridX = Math.round(item.position.x / (CARD_BASE_WIDTH + GAP));
        const itemGridY = Math.round(item.position.y / (CARD_BASE_HEIGHT + GAP));

        // 检查网格重叠
        const hasXOverlap = !(gridX + width <= itemGridX || gridX >= itemGridX + item.size.width);
        const hasYOverlap = !(gridY + height <= itemGridY || gridY >= itemGridY + item.size.height);

        return hasXOverlap && hasYOverlap;
      });
    },
    [items]
  );

  // 拖拽开始处理
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);

    const item = items.find((i) => i.id === active.id);
    if (item) {
      setOriginalPositions((prev) => ({
        ...prev,
        [active.id]: { ...item.position },
      }));
    }
  };

  // 拖拽结束处理
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, delta } = event;

    if (!active) return;

    const item = items.find((i) => i.id === active.id);
    if (!item) return;

    const oldPosition = item.position;
    const newPosition = snapToGrid(oldPosition.x + delta.x, oldPosition.y + delta.y);

    setItems((currentItems) => {
      if (checkCollision(newPosition, item.size.width, item.size.height, active.id as string)) {
        return currentItems.map((item) => {
          if (item.id === active.id) {
            return {
              ...item,
              position: originalPositions[active.id],
            };
          }
          return item;
        });
      }

      const newItems = currentItems.map((item) => {
        if (item.id === active.id) {
          return {
            ...item,
            position: newPosition,
          };
        }
        return item;
      });
      return newItems;
    });

    setActiveId(null);
  };

  return (
    <div ref={containerRef}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
          <div className="mx-auto overflow-hidden" style={{ width: containerStyle.width }}>
            <div ref={setNodeRef} style={containerStyle}>
              {items.map((item) => (
                <DraggableCard key={item.id} {...item} />
              ))}
            </div>
          </div>
        </SortableContext>

        <DragOverlay adjustScale={false}>
          {activeItem && (
            <div
              style={{
                width: `${CARD_BASE_WIDTH * activeItem.size.width + GAP * (activeItem.size.width - 1)}px`,
                height: `${CARD_BASE_HEIGHT * activeItem.size.height + GAP * (activeItem.size.height - 1)}px`,
                pointerEvents: 'none',
              }}
            >
              <CardContent content={activeItem.content} className="rounded-lg shadow-lg" />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

export default GridLayout;
