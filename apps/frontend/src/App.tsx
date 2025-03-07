import { useMount, useUpdateEffect } from 'react-use';
import { useHomeAssistant } from '@/use-home-assistant';
import GridLayout, { GridItem } from '@/GridLayout';
import { useMemo, useRef, useState } from 'react';
import { RecordUtils } from '@/utils';
import { cardRegistry } from '@/components/devices';
import { DynamicCardRenderer } from '@/components/grid/DynamicCardRenderer';

function App() {
  const { entities, init } = useHomeAssistant();

  useMount(() => {
    init();
  });

  const [items, setItems] = useState<Record<string, GridItem>>({});
  const entityPositions = useRef<Record<string, { x: number; y: number }>>({});

  const getPosition = (entityId: string) => {
    return entityPositions.current[entityId];
  };

  useUpdateEffect(() => {
    const mappedItems = RecordUtils.map(entities, (entity, entityId) => {
      let size = { width: 1, height: 1 };

      const matchedCard = cardRegistry.findCardForEntity(entity);
      if (matchedCard) {
        size = matchedCard.meta.defaultSize;
      }

      const position = getPosition(entityId) ?? { x: 0, y: 0 };

      return {
        id: entityId,
        entity,
        component: matchedCard?.component,
        position,
        size,
      };
    });
    const filteredItems = RecordUtils.filter(mappedItems, (_, entityId) =>
      entityId.includes('light')
    );

    setItems(filteredItems);
  }, [entities]);

  const handleDragEnd = (item: { id: string | number; position: { x: number; y: number } }) => {
    entityPositions.current[item.id] = item.position;
  };

  const handleLayoutChange = (
    layout: Record<string, { id: string | number; position: { x: number; y: number } }>
  ) => {
    RecordUtils.forEach(layout, (item) => {
      entityPositions.current[item.id] = item.position;
    });
  };

  const debugSize = useMemo(() => {
    return {
      width: 1920,
      height: 1080,
    };
  }, []);

  return (
    <div
      className="box-border h-screen bg-gray-300 p-2"
      style={{ width: debugSize.width, height: debugSize.height }}
    >
      <GridLayout
        items={items}
        onDragEnd={handleDragEnd}
        onLayoutChange={handleLayoutChange}
        renderItem={(item) => <DynamicCardRenderer key={item.id} entity={item.entity} />}
      />
    </div>
  );
}

export default App;
