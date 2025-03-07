import React from 'react';
import { Badge } from '@/components/ui/badge';
import { HassEntity } from 'home-assistant-js-websocket';
import { ServiceCard } from '@/components/devices/ServiceCard';
import { CardContent } from '@/components/ui/card';

interface TempHumiditySensorCardProps {
  entity: HassEntity;
}

const TempHumiditySensorCard: React.FC<TempHumiditySensorCardProps> = ({ entity }) => {
  const getTempStatus = (temp: number) => {
    if (temp < 16) return { label: '偏冷', color: 'text-blue-500', bgColor: 'bg-blue-50' };
    if (temp < 20) return { label: '凉爽', color: 'text-cyan-500', bgColor: 'bg-cyan-50' };
    if (temp < 26) return { label: '舒适', color: 'text-green-500', bgColor: 'bg-green-50' };
    if (temp < 30) return { label: '温暖', color: 'text-yellow-500', bgColor: 'bg-yellow-50' };
    return { label: '炎热', color: 'text-red-500', bgColor: 'bg-red-50' };
  };

  const getHumidityStatus = (hum: number) => {
    if (hum < 30) return { label: '干燥', color: 'text-amber-500', bgColor: 'bg-amber-50' };
    if (hum < 40) return { label: '偏干', color: 'text-yellow-500', bgColor: 'bg-yellow-50' };
    if (hum < 60) return { label: '适宜', color: 'text-green-500', bgColor: 'bg-green-50' };
    if (hum < 70) return { label: '偏湿', color: 'text-cyan-500', bgColor: 'bg-cyan-50' };
    return { label: '潮湿', color: 'text-blue-500', bgColor: 'bg-blue-50' };
  };

  const temperature = 23.5;
  const humidity = 45;

  const tempStatus = getTempStatus(temperature);
  const humidityStatus = getHumidityStatus(humidity);

  return (
    <ServiceCard entity={entity}>
      <CardContent className="p-0">
        <div className="flex items-center justify-between">
          <div>
            <Badge variant="secondary">主卧室</Badge>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <div
              className={`h-2 w-2 rounded-full ${Date.parse(entity.last_updated) < Date.now() - 3600000 ? 'bg-gray-300' : 'bg-green-500'}`}
            ></div>
            2分钟前
          </div>
        </div>
        <h3 className="mb-2 text-lg font-semibold">{entity.attributes.friendly_name}</h3>

        <div className="flex justify-between border-gray-100">
          <div className="flex flex-1 flex-col items-center">
            <div className="flex items-baseline text-2xl font-bold">
              <span className={tempStatus.color}>{temperature}</span>
              <span className="ml-0.5 text-sm">°C</span>
            </div>
            <div
              className={`mt-1 rounded-full px-2 py-0.5 text-xs ${tempStatus.bgColor} ${tempStatus.color}`}
            >
              {tempStatus.label}
            </div>
          </div>

          <div className="mx-2 w-px bg-gray-200"></div>

          <div className="flex flex-1 flex-col items-center">
            <div className="flex items-baseline text-2xl font-bold">
              <span className={humidityStatus.color}>{humidity}</span>
              <span className="ml-0.5 text-sm">%</span>
            </div>
            <div
              className={`mt-1 rounded-full px-2 py-0.5 text-xs ${humidityStatus.bgColor} ${humidityStatus.color}`}
            >
              {humidityStatus.label}
            </div>
          </div>
        </div>
      </CardContent>
    </ServiceCard>
  );
};

export { type TempHumiditySensorCardProps, TempHumiditySensorCard };
