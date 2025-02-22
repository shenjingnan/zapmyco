import { useMount } from 'react-use';
import { useHomeAssistant } from './use-home-assistant';
import DebugCard from './components/devices/DebugCard';
import LightCard from './components/devices/LightCard';
import GridLayout from './GridLayout';

function App() {
  const { entities, init } = useHomeAssistant();

  useMount(() => {
    init();
  });

  let x = 0;
  let y = 0;
  return (
    <div className="box-border min-h-screen bg-gray-300 p-2">
      <GridLayout
        items={Object.keys(entities).map((entityId) => {
          if (x >= 16) {
            x = 0;
            y++;
          }
          let size = { width: 1, height: 1 };
          if (['switch', 'light', 'input_boolean'].includes(entityId.split('.', 1)[0])) {
            size = { width: 3, height: 3 };
          }
          const res = {
            id: entityId,
            entity: entities[entityId],
            position: { x, y },
            size,
          };
          x += size.width;
          return res;
        })}
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
