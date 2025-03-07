import { Badge } from '@/components/ui/badge';
import { HassEntity } from 'home-assistant-js-websocket';
import { ServiceCard } from '@/components/devices/ServiceCard';

interface OccupancySensorCardProps {
  entity: HassEntity;
}

const OccupancySensorCard: React.FC<OccupancySensorCardProps> = (props) => {
  const { entity } = props;
  // 模拟数据
  const sensorData = {
    location: '玄关',
    name: '领普人体存在传感器ES3',
    hasPresence: true,
    batteryLevel: 85,
    detectionCount: 24,
    lightLevel: 320, // 单位：lux
  };

  return (
    <ServiceCard entity={entity}>
      <div className="mb-2 flex items-center justify-between">
        <Badge variant="secondary">玄关</Badge>
        <div className="flex items-center">
          <div
            className={`h-3 w-3 rounded-full ${sensorData.hasPresence ? 'bg-green-400' : 'bg-gray-400'} mr-2`}
          ></div>
          <span className="text-xs">{sensorData.hasPresence ? '有人' : '无人'}</span>
        </div>
      </div>
      <div className="mb-2 flex items-start justify-between">
        <div>
          <h3 className="truncate text-base font-semibold">
            {entity.attributes.friendly_name?.split(' ')[0]}
          </h3>
        </div>
        <div className="flex items-center space-x-2"></div>
      </div>
      <div className="grid grid-cols-3">
        <div>
          <span className="text-lg font-medium">{sensorData.batteryLevel}%</span>
          <span className="block text-xs text-gray-500">剩余电量</span>
        </div>
        <div>
          <span className="text-lg font-medium">{sensorData.detectionCount}次</span>
          <span className="block text-xs text-gray-500">今日检测</span>
        </div>
        <div>
          <span className="text-lg font-medium">{sensorData.lightLevel} lux</span>
          <span className="block text-xs text-gray-500">当前光照</span>
        </div>
      </div>
    </ServiceCard>
  );
};

export { type OccupancySensorCardProps, OccupancySensorCard };
