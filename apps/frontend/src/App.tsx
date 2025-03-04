import { useMount, useUpdateEffect } from 'react-use';
import { useHomeAssistant } from '@/use-home-assistant';
import {
  TempHumiditySensor,
  OneSwitchCard,
  OccupancySensorCard,
  LightCard,
  DebugCard,
  ThermostatCard,
  EnergyCard,
  SecurityCard,
  AirPurifierCard,
  HumidifierCard,
  CurtainCard,
  SmartPlugCard,
  RefrigeratorCard,
  WashingMachineCard,
  OvenCard,
  SceneCard,
  AutomationCard,
  WeatherCard,
  HealthCard,
} from '@/components/devices';
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
    setItems(
      RecordUtils.map(entities, (entity, entityId) => {
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
        renderItem={(item) => (
          <DynamicCardRenderer key={item.id} entity={item.entity} size={item.size} />
        )}
      />
    </div>
  );
}

export default App;
