import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ComponentType } from 'react';

export interface WithDraggableProps {
  id: string;
  dragProps?: Record<string, unknown>;
}

export function withDraggable<T extends WithDraggableProps>(WrappedComponent: ComponentType<T>) {
  return function DraggableComponent(props: T) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: props.id,
    });

    const dragProps = {
      ref: setNodeRef,
      style: {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      },
      ...attributes,
      ...listeners,
    };

    return <WrappedComponent {...props} dragProps={dragProps} />;
  };
}
