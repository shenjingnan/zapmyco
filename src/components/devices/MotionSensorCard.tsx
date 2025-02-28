import { SunIcon, User } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HassEntity } from 'home-assistant-js-websocket';

interface MotionSensorCardProps {
  entity: HassEntity;
}

const MotionSensorCard = (props: Readonly<MotionSensorCardProps>) => {
  const { entity } = props;

  // 活动历史数据
  const activityData = [
    { value: 20, color: 'bg-gray-100' },
    { value: 30, color: 'bg-gray-100' },
    { value: 15, color: 'bg-gray-100' },
    { value: 25, color: 'bg-gray-100' },
    { value: 40, color: 'bg-gray-100' },
    { value: 60, color: 'bg-blue-100' },
    { value: 80, color: 'bg-blue-200' },
    { value: 70, color: 'bg-blue-300' },
    { value: 60, color: 'bg-blue-400' },
    { value: 40, color: 'bg-blue-300' },
    { value: 30, color: 'bg-blue-200' },
    { value: 20, color: 'bg-blue-100' },
  ];

  return (
    <Card className="h-full w-full overflow-hidden">
      <div className="flex h-full flex-col justify-between p-3">
        <div className="mb-2 flex flex-col">
          <div className="mb-2 flex items-center justify-between">
            <Badge variant="secondary">玄关</Badge>
            <div className="flex items-center">
              <div className="mr-1.5 h-2 w-2 rounded-full bg-green-300"></div>
              <span className="text-xs">有人</span>
            </div>
          </div>
          <h3 className="font-semibold">{entity.attributes.friendly_name?.split(' ')[0]}</h3>
        </div>
        <div className="mt-auto flex flex-grow flex-col">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs text-gray-500">今日活动</div>
          </div>
          <div className="flex h-auto min-h-6 flex-1 items-end space-x-0.5">
            {activityData.map((item, index) => (
              <div
                key={index}
                className={`w-full ${item.color} rounded-sm transition-all duration-200 hover:opacity-80 ${index === activityData.length - 1 ? 'animate-[pulse_2s_infinite]' : ''}`}
                style={{ height: `${item.value}%` }}
              ></div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default MotionSensorCard;
