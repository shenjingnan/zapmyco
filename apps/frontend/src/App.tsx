import { useMount, useUpdateEffect } from 'react-use';
import { useHomeAssistant } from './use-home-assistant';
import DebugCard from './components/devices/DebugCard';
import LightCard from './components/devices/LightCard';
import OccupancySensorCard from './components/devices/OccupancySensorCard';
import GridLayout, { GridItem } from './GridLayout';
import { useMemo, useRef, useState } from 'react';
import { RecordUtils } from './utils';
import OneSwitchCard from './components/devices/OneSwitchCard';
import TempHumiditySensor from './components/devices/TempHumiditySensor';

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
    let i = 0;
    setItems(
      RecordUtils.map(entities, (entity, entityId) => {
        let size = { width: 1, height: 1 };
        if (i === 0) {
          size = { width: 1, height: 1 };
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
        if (entityId === 'sun.sun') {
          size = { width: 3, height: 2 };
        }
        i++;
        if (['switch', 'light', 'input_boolean'].includes(entityId.split('.', 1)[0])) {
          size = { width: 4, height: 4 };
        }
        if (entityId === 'sensor.linp_cn_blt_3_1kd89jrngco00_es2_has_someone_duration_p_2_1080') {
          size = { width: 4, height: 2 };
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

  const renderCard = (item: GridItem) => {
    if (['switch', 'light', 'input_boolean'].includes(item.entity.entity_id.split('.', 1)[0])) {
      return <LightCard key={item.id} entity={item.entity} />;
    }

    if (
      item.entity.entity_id ===
      'sensor.linp_cn_blt_3_1kd89jrngco00_es2_has_someone_duration_p_2_1080'
    ) {
      return <OccupancySensorCard key={item.id} entity={item.entity} />;
    }

    if (item.entity.entity_id === 'sun.sun') {
      return <TempHumiditySensor key={item.id} entity={item.entity} />;
    }

    if (item.entity.entity_id === 'person.nemo2') {
      return <OneSwitchCard key={item.id} entity={item.entity} />;
    }

    return <DebugCard key={item.id} entity={item.entity} />;
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
        renderItem={renderCard}
      />
    </div>
  );
}

export default App;
