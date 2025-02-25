import { useMount, useUpdateEffect } from 'react-use';
import { useHomeAssistant } from './use-home-assistant';
import DebugCard from './components/devices/DebugCard';
import LightCard from './components/devices/LightCard';
import GridLayout, { GridItem } from './GridLayout';
import { useRef, useState } from 'react';
import { RecordUtils } from './utils';

function App() {
  const { entities, init } = useHomeAssistant();

  useMount(() => {
    init();
  });

  const x = 0;
  const y = 0;

  const [items, setItems] = useState<Record<string, GridItem>>({});
  const entityPositions = useRef<Record<string, { x: number; y: number }>>({});

  const getPosition = (entityId: string) => {
    return entityPositions.current[entityId];
  };

  useUpdateEffect(() => {
    let i = 0;
    setItems(
      RecordUtils.map(entities, (entity, entityId) => {
        let size = { width: 1, height: 1 };
        if (i === 0) {
          size = { width: 2, height: 2 };
        }
        if (i === 1) {
          size = { width: 1, height: 2 };
        }
        if (i === 2) {
          size = { width: 2, height: 1 };
        }
        if (i === 3) {
          size = { width: 3, height: 2 };
        }
        if (i === 4) {
          size = { width: 1, height: 3 };
        }
        if (i === 5) {
          size = { width: 3, height: 3 };
        }
        i++;
        if (['switch', 'light', 'input_boolean'].includes(entityId.split('.', 1)[0])) {
          size = { width: 3, height: 3 };
        }
        const position = getPosition(entityId) ?? { x: 0, y: 0 };
        const res = {
          id: entityId,
          entity,
          position,
          size,
        };
        return res;
      })
    );
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

  return (
    <div className="box-border h-screen bg-gray-300 p-2">
      <GridLayout
        items={items}
        onDragEnd={handleDragEnd}
        onLayoutChange={handleLayoutChange}
        renderItem={(item) => {
          return ['switch', 'light', 'input_boolean'].includes(
            item.entity.entity_id.split('.', 1)[0]
          ) ? (
            <LightCard key={item.id} entity={item.entity} />
          ) : (
            <DebugCard entity={item.entity} />
          );
        }}
      />
    </div>
  );
}

export default App;
