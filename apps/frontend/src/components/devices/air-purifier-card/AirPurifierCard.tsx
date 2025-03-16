import React from 'react';
import { CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Power, Droplet, RefreshCw, Gauge } from 'lucide-react';
import { ServiceCard, type HassEntity, cn } from '@zapmyco/ui';

interface AirPurifierCardProps {
  entity: HassEntity;
  onToggle?: () => void;
  onModeChange?: (mode: string) => void;
  onFanSpeedChange?: (speed: number) => void;
}

const AirPurifierCard: React.FC<AirPurifierCardProps> = (props) => {
  const { entity, onToggle, onModeChange, onFanSpeedChange } = props;

  // 从entity中提取状态数据
  const isOn = entity.state === 'on';
  const mode = entity.attributes.mode || 'auto';
  const fanSpeed = entity.attributes.fan_speed || 1;
  const filterLife = entity.attributes.filter_life || 90;
  const pm25 = entity.attributes.pm25 || 15;
  const humidity = entity.attributes.humidity || 45;

  // 判断空气质量
  const getAirQualityStatus = (pm25Value: number) => {
    if (pm25Value <= 15) return { label: '优', color: 'bg-green-400' };
    if (pm25Value <= 35) return { label: '良', color: 'bg-yellow-400' };
    if (pm25Value <= 75) return { label: '中', color: 'bg-orange-400' };
    return { label: '差', color: 'bg-red-400' };
  };

  const airQuality = getAirQualityStatus(pm25);

  return (
    <ServiceCard entity={entity}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>{entity.attributes.friendly_name || '空气净化器'}</CardTitle>
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
        {/* 空气质量指标 */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <Gauge className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-500">PM2.5</span>
            <div className="flex items-center gap-1">
              <span className="text-xl font-semibold">{pm25}</span>
              <span className="text-xs">μg/m³</span>
            </div>
            <Badge className={cn('mt-1 px-2 py-0', airQuality.color)}>{airQuality.label}</Badge>
          </div>

          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <Droplet className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-500">湿度</span>
            <div className="flex items-center">
              <span className="text-xl font-semibold">{humidity}</span>
              <span className="text-xs">%</span>
            </div>
          </div>

          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <RefreshCw className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-500">滤网</span>
            <div className="flex items-center">
              <span className="text-xl font-semibold">{filterLife}</span>
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
                variant={mode === 'favorite' ? 'default' : 'outline'}
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => onModeChange?.('favorite')}
              >
                收藏
              </Button>
            </div>
          </div>
        </div>

        {/* 风速控制 */}
        {isOn && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">风速</span>
              <span className="text-xs text-slate-500">
                {fanSpeed === 1 ? '低速' : fanSpeed === 2 ? '中速' : '高速'}
              </span>
            </div>
            <Slider
              value={[fanSpeed]}
              min={1}
              max={3}
              step={1}
              onValueChange={(value) => onFanSpeedChange?.(value[0])}
              className="py-2"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>低</span>
              <span>中</span>
              <span>高</span>
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

export { type AirPurifierCardProps, AirPurifierCard };
