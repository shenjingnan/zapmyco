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
import { DynamicCardRenderer } from './components/grid/DynamicCardRenderer';

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

  const renderCard = (item: GridItem) => {
    return <DynamicCardRenderer key={item.id} entity={item.entity} size={item.size} />;
    // if (['switch', 'light', 'input_boolean'].includes(item.entity.entity_id.split('.', 1)[0])) {
    //   return <LightCard key={item.id} entity={item.entity} />;
    // }
    // if (item.entity.entity_id === 'notify.xiaomi_cn_1143886953_hub1_emit_virtual_event_a_4_1') {
    //   return <HealthCard key={item.id} entity={item.entity} />;
    // }
    // if (
    //   item.entity.entity_id === 'event.linp_cn_blt_3_1kd89jrngco00_es2_device_be_reset_e_2_1028'
    // ) {
    //   return <WeatherCard key={item.id} entity={item.entity} />;
    // }
    // if (item.entity.entity_id === 'event.xiaomi_cn_1143886953_hub1_network_changed_e_2_2') {
    //   return <AutomationCard key={item.id} entity={item.entity} />;
    // }
    // if (
    //   item.entity.entity_id === 'sensor.linp_cn_blt_3_1kd89jrngco00_es2_occupancy_status_p_2_1078'
    // ) {
    //   return <SceneCard key={item.id} entity={item.entity} />;
    // }
    // if (item.entity.entity_id === 'sensor.xiaomi_cn_1143886953_hub1_ip_address_p_2_2') {
    //   return <RefrigeratorCard key={item.id} entity={item.entity} />;
    // }
    // if (item.entity.entity_id === 'sensor.linp_cn_blt_3_1kd89jrngco00_es2_illumination_p_2_1005') {
    //   return <WashingMachineCard key={item.id} entity={item.entity} />;
    // }
    // if (item.entity.entity_id === 'event.xiaomi_cn_1143886953_hub1_virtual_event_e_4_1') {
    //   return <OvenCard key={item.id} entity={item.entity} />;
    // }
    // if (item.entity.entity_id === 'sensor.xiaomi_cn_1143886953_hub1_wifi_ssid_p_2_3') {
    //   return <SmartPlugCard key={item.id} entity={item.entity} />;
    // }
    // if (item.entity.entity_id === 'sensor.xiaomi_cn_1143886953_hub1_access_mode_p_2_1') {
    //   return <CurtainCard key={item.id} entity={item.entity} />;
    // }
    // if (item.entity.entity_id === 'todo.shopping_list') {
    //   return <HumidifierCard key={item.id} entity={item.entity} />;
    // }
    // if (
    //   item.entity.entity_id === 'sensor.linp_cn_blt_3_1kd89jrngco00_es2_no_one_duration_p_2_1079'
    // ) {
    //   return <AirPurifierCard key={item.id} entity={item.entity} />;
    // }

    // if (item.entity.entity_id === 'scene.new_scene') {
    //   return <SecurityCard key={item.id} entity={item.entity} />;
    // }

    // if (item.entity.entity_id === 'conversation.home_assistant') {
    //   return <EnergyCard key={item.id} entity={item.entity} />;
    // }

    // if (
    //   item.entity.entity_id ===
    //   'sensor.linp_cn_blt_3_1kd89jrngco00_es2_has_someone_duration_p_2_1080'
    // ) {
    //   return <OccupancySensorCard key={item.id} entity={item.entity} />;
    // }

    // if (item.entity.entity_id === 'sun.sun') {
    //   return <TempHumiditySensor key={item.id} entity={item.entity} />;
    // }

    // if (item.entity.entity_id === 'zone.home') {
    //   return <ThermostatCard key={item.id} entity={item.entity} />;
    // }

    // if (item.entity.entity_id === 'person.nemo2') {
    //   return <OneSwitchCard key={item.id} entity={item.entity} />;
    // }

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
