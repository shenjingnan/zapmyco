import React, { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUpdateEffect } from 'react-use';

// 可排序项组件
interface DraggableItemProps {
  id: string;
  children: React.ReactNode;
  className?: string;
}
const DraggableItem = (props: DraggableItemProps) => {
  const { id, children, ...restProps } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} {...restProps}>
      {children}
    </div>
  );
};

// 拖拽时显示的项组件
const DragItem = ({ id }: { id: string }) => {
  return (
    <div className="mb-2 cursor-move rounded bg-white p-4 shadow ring-2 ring-primary">
      Item {id}
    </div>
  );
};

interface Item {
  id: string;
  [key: string]: unknown;
}

interface Props {
  items: Item[];
  renderItem: ({ item, index }: { item: Item; index: number }) => React.ReactNode;
}

const DraggableGrid = (props: Props) => {
  const [items, setItems] = useState<Item[]>(props.items);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 100,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  useUpdateEffect(() => {
    setItems(props.items);
  });

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setItems((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
    setActiveId(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-12 gap-2 p-2">
          {items.map((item, index) => props.renderItem({ item, index }))}
        </div>
      </SortableContext>

      {/* 拖拽时的覆盖层 */}
      <DragOverlay
        adjustScale={true}
        dropAnimation={{
          duration: 300,
          easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
        }}
      >
        {activeId
          ? props.renderItem({ item: items.find((item) => item.id === activeId)!, index: 0 })
          : null}
      </DragOverlay>
    </DndContext>
  );
};

export { DraggableItem, DraggableGrid };
