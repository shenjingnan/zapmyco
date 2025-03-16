import React from 'react';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ServiceCard, cn, type HassEntity } from '@zapmyco/ui';
import { Snowflake, ThermometerSnowflake, Beef, Wine } from 'lucide-react';

interface RefrigeratorCardProps {
  entity: HassEntity;
  onModeChange?: (mode: string) => void;
  onFridgeTemperatureChange?: (temp: number) => void;
  onFreezerTemperatureChange?: (temp: number) => void;
}

const RefrigeratorCard: React.FC<RefrigeratorCardProps> = (props) => {
  const { entity, onModeChange, onFridgeTemperatureChange, onFreezerTemperatureChange } = props;

  // 从entity中提取状态数据
  const mode = entity.attributes.mode || 'normal';
  const fridgeTemp = entity.attributes.fridge_temperature || 4;
  const freezerTemp = entity.attributes.freezer_temperature || -18;
  const doorOpen = entity.attributes.door_open || false;
  const filterStatus = entity.attributes.filter_status || 90;

  return (
    <ServiceCard entity={entity}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Snowflake className="h-5 w-5" />
            {entity.attributes.friendly_name || '智能冰箱'}
          </CardTitle>
          <Badge
            variant="default"
            className={cn(
              'font-normal transition-colors',
              doorOpen ? 'bg-red-500' : 'bg-green-500'
            )}
          >
            {doorOpen ? '门已打开' : '运行正常'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* 温度控制 */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">冷藏室温度</span>
              <span className="text-xs text-slate-500">{fridgeTemp}°C</span>
            </div>
            <Slider
              value={[fridgeTemp]}
              min={2}
              max={8}
              step={1}
              onValueChange={(value) => onFridgeTemperatureChange?.(value[0])}
              className="py-2"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">冷冻室温度</span>
              <span className="text-xs text-slate-500">{freezerTemp}°C</span>
            </div>
            <Slider
              value={[freezerTemp]}
              min={-24}
              max={-16}
              step={1}
              onValueChange={(value) => onFreezerTemperatureChange?.(value[0])}
              className="py-2"
            />
          </div>
        </div>

        {/* 模式选择 */}
        <div className="space-y-2">
          <span className="text-sm font-medium">模式选择</span>
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant={mode === 'normal' ? 'default' : 'outline'}
              size="sm"
              className="h-16 flex-col gap-1"
              onClick={() => onModeChange?.('normal')}
            >
              <ThermometerSnowflake className="h-4 w-4" />
              <span className="text-xs">标准模式</span>
            </Button>
            <Button
              variant={mode === 'quick_freeze' ? 'default' : 'outline'}
              size="sm"
              className="h-16 flex-col gap-1"
              onClick={() => onModeChange?.('quick_freeze')}
            >
              <Beef className="h-4 w-4" />
              <span className="text-xs">速冻模式</span>
            </Button>
            <Button
              variant={mode === 'vacation' ? 'default' : 'outline'}
              size="sm"
              className="h-16 flex-col gap-1"
              onClick={() => onModeChange?.('vacation')}
            >
              <Wine className="h-4 w-4" />
              <span className="text-xs">假日模式</span>
            </Button>
          </div>
        </div>

        {/* 过滤器状态 */}
        <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-sm">滤芯状态</span>
            <Badge
              variant="outline"
              className={cn('font-normal', filterStatus > 20 ? 'text-green-500' : 'text-red-500')}
            >
              剩余 {filterStatus}%
            </Badge>
          </div>
        </div>
      </CardContent>
    </ServiceCard>
  );
};

export { type RefrigeratorCardProps, RefrigeratorCard };
