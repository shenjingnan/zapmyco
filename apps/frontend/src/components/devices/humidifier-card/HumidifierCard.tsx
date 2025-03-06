import React from 'react';
import { CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { HassEntity } from 'home-assistant-js-websocket';
import { cn } from '@/lib/utils';
import { Power, Droplet, Waves, ThermometerSun } from 'lucide-react';
import { ServiceCard } from '@/components/devices/ServiceCard';
interface HumidifierCardProps {
  entity: HassEntity;
  onToggle?: () => void;
  onModeChange?: (mode: string) => void;
  onHumidityTargetChange?: (target: number) => void;
}

const HumidifierCard: React.FC<HumidifierCardProps> = (props) => {
  const { entity, onToggle, onModeChange, onHumidityTargetChange } = props;

  // 从entity中提取状态数据
  const isOn = entity.state === 'on';
  const mode = entity.attributes.mode || 'auto';
  const currentHumidity = entity.attributes.current_humidity || 45;
  const targetHumidity = entity.attributes.target_humidity || 50;
  const temperature = entity.attributes.temperature || 25;
  const waterLevel = entity.attributes.water_level || 80;

  // 判断湿度状态
  const getHumidityStatus = (humidity: number) => {
    if (humidity < 30) return { label: '干燥', color: 'bg-orange-400' };
    if (humidity <= 60) return { label: '舒适', color: 'bg-green-400' };
    return { label: '潮湿', color: 'bg-blue-400' };
  };

  const humidityStatus = getHumidityStatus(currentHumidity);

  return (
    <ServiceCard entity={entity}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>{entity.attributes.friendly_name || '加湿器'}</CardTitle>
          <Badge
            variant={isOn ? 'default' : 'outline'}
            className={cn(
              'font-normal transition-colors',
              isOn ? 'bg-green-500 hover:bg-green-600' : ''
            )}
          >
            {isOn ? '运行中' : '已关闭'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* 湿度指标 */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <Droplet className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-500">当前湿度</span>
            <div className="flex items-center gap-1">
              <span className="text-xl font-semibold">{currentHumidity}</span>
              <span className="text-xs">%</span>
            </div>
            <Badge className={cn('mt-1 px-2 py-0', humidityStatus.color)}>
              {humidityStatus.label}
            </Badge>
          </div>

          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <ThermometerSun className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-500">温度</span>
            <div className="flex items-center">
              <span className="text-xl font-semibold">{temperature}</span>
              <span className="text-xs">°C</span>
            </div>
          </div>

          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <Waves className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-500">水位</span>
            <div className="flex items-center">
              <span className="text-xl font-semibold">{waterLevel}</span>
              <span className="text-xs">%</span>
            </div>
          </div>
        </div>

        {/* 模式选择 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">工作模式</span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={mode === 'auto' ? 'default' : 'outline'}
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => onModeChange?.('auto')}
              >
                自动
              </Button>
              <Button
                size="sm"
                variant={mode === 'sleep' ? 'default' : 'outline'}
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => onModeChange?.('sleep')}
              >
                睡眠
              </Button>
              <Button
                size="sm"
                variant={mode === 'continuous' ? 'default' : 'outline'}
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => onModeChange?.('continuous')}
              >
                持续
              </Button>
            </div>
          </div>
        </div>

        {/* 目标湿度控制 */}
        {isOn && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">目标湿度</span>
              <span className="text-xs text-slate-500">{targetHumidity}%</span>
            </div>
            <Slider
              value={[targetHumidity]}
              min={30}
              max={80}
              step={5}
              onValueChange={(value) => onHumidityTargetChange?.(value[0])}
              className="py-2"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>30%</span>
              <span>55%</span>
              <span>80%</span>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter>
        <Button
          variant={isOn ? 'default' : 'outline'}
          className={cn('w-full', isOn ? 'bg-green-500 hover:bg-green-600' : '')}
          onClick={onToggle}
        >
          <Power className={cn('mr-2 h-4 w-4', isOn ? 'text-green-100' : '')} />
          {isOn ? '关闭' : '开启'}
        </Button>
      </CardFooter>
    </ServiceCard>
  );
};

export { type HumidifierCardProps, HumidifierCard };
