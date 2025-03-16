import React from 'react';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ServiceCard, type HassEntity } from '@zapmyco/ui';
import {
  Cloud,
  CloudRain,
  CloudSnow,
  Sun,
  Moon,
  CloudLightning,
  Wind,
  Droplets,
  ThermometerSun,
  Umbrella,
  Eye,
} from 'lucide-react';
interface WeatherForecast {
  datetime: string;
  condition: string;
  temperature: number;
  precipitation_probability: number;
  humidity: number;
  wind_speed: number;
}

interface WeatherCardProps {
  entity: HassEntity;
}

const WeatherCard: React.FC<WeatherCardProps> = (props) => {
  const { entity } = props;

  // 从entity中提取状态数据
  const condition = entity.state;
  const temperature = entity.attributes.temperature || 0;
  const humidity = entity.attributes.humidity || 0;
  const windSpeed = entity.attributes.wind_speed || 0;
  const windDirection = entity.attributes.wind_direction || '';
  const pressure = entity.attributes.pressure || 0;
  const visibility = entity.attributes.visibility || 0;
  const forecast = (entity.attributes.forecast || []) as WeatherForecast[];

  // 获取天气图标
  const getWeatherIcon = (condition: string) => {
    switch (condition.toLowerCase()) {
      case 'clear':
        return Sun;
      case 'cloudy':
        return Cloud;
      case 'rainy':
        return CloudRain;
      case 'snowy':
        return CloudSnow;
      case 'thunder':
        return CloudLightning;
      case 'night':
        return Moon;
      default:
        return Sun;
    }
  };

  const WeatherIcon = getWeatherIcon(condition);

  // 获取天气状况描述
  const getWeatherDescription = (condition: string) => {
    const descriptions: { [key: string]: string } = {
      clear: '晴天',
      cloudy: '多云',
      rainy: '雨天',
      snowy: '雪天',
      thunder: '雷雨',
      night: '夜晚',
    };
    return descriptions[condition.toLowerCase()] || '晴天';
  };

  return (
    <ServiceCard entity={entity}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <WeatherIcon className="h-5 w-5" />
            {entity.attributes.friendly_name || '天气信息'}
          </CardTitle>
          <Badge variant="outline" className="font-normal">
            {getWeatherDescription(condition)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* 当前天气 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <WeatherIcon className="h-16 w-16 text-blue-500" />
            <div>
              <div className="text-3xl font-bold">{temperature}°C</div>
              <div className="text-sm text-slate-500">{getWeatherDescription(condition)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Droplets className="h-4 w-4 text-blue-500" />
              <span className="text-sm">{humidity}%</span>
            </div>
            <div className="flex items-center gap-2">
              <Wind className="h-4 w-4 text-blue-500" />
              <span className="text-sm">{windSpeed}km/h</span>
            </div>
          </div>
        </div>

        {/* 详细信息 */}
        <div className="grid grid-cols-4 gap-2">
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <Wind className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium">{windDirection}</span>
            <span className="text-xs text-slate-500">风向</span>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <ThermometerSun className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium">{pressure}hPa</span>
            <span className="text-xs text-slate-500">气压</span>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <Eye className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium">{visibility}km</span>
            <span className="text-xs text-slate-500">能见度</span>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <Umbrella className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium">
              {forecast[0]?.precipitation_probability || 0}%
            </span>
            <span className="text-xs text-slate-500">降水概率</span>
          </div>
        </div>

        {/* 天气预报 */}
        <div className="space-y-2">
          <div className="text-sm font-medium">未来天气</div>
          <div className="grid grid-cols-4 gap-2">
            {forecast.slice(0, 4).map((day, index) => (
              <div
                key={index}
                className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800"
              >
                <span className="text-xs text-slate-500">
                  {new Date(day.datetime).toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                {React.createElement(getWeatherIcon(day.condition), {
                  className: 'h-6 w-6 my-1 text-blue-500',
                })}
                <span className="text-sm font-medium">{day.temperature}°C</span>
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <Umbrella className="h-3 w-3" />
                  <span>{day.precipitation_probability}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </ServiceCard>
  );
};

export { type WeatherCardProps, WeatherCard };
