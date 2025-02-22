import { useMount, useRaf, useUpdateEffect } from 'react-use';
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

  let x = 0;
  let y = 0;

  const [items, setItems] = useState<Record<string, GridItem>>({});
  const entityPositions = useRef<Record<string, { x: number; y: number }>>({});

  const getPosition = (entityId: string) => {
    if (entityId === 'light.yeelink_cn_1132894958_mbulb3_s_2') {
      console.log('nemo light.yeelink_cn_1132894958_mbulb3_s_2 position', entityPositions.current);
    }
    return entityPositions.current[entityId];
  };

  useUpdateEffect(() => {
    setItems(
      RecordUtils.map(entities, (entity, entityId) => {
        if (x >= 16) {
          x = 0;
          y++;
        }
        let size = { width: 1, height: 1 };
        if (['switch', 'light', 'input_boolean'].includes(entityId.split('.', 1)[0])) {
          size = { width: 3, height: 3 };
        }
        const position = getPosition(entityId) ?? { x, y };
        const res = {
          id: entityId,
          entity,
          position,
          size,
        };
        entityPositions.current[entityId] = position;
        x += size.width;
        return res;
      })
    );
  }, [entities]);

  const handleDragEnd = (item: { id: string | number; position: { x: number; y: number } }) => {
    entityPositions.current[item.id] = item.position;
    console.log('nemo entityPositions.current', item.id, entityPositions.current, item.position);
  };

  return (
    <div className="box-border min-h-screen bg-gray-300 p-2">
      <GridLayout
        items={items}
        onDragEnd={handleDragEnd}
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
