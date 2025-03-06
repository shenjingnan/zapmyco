import React from 'react';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { HassEntity } from 'home-assistant-js-websocket';
import { cn } from '@/lib/utils';
import { Flame, Timer, Pizza, Sandwich, Cake, Loader2 } from 'lucide-react';
import { ServiceCard } from '@/components/devices/ServiceCard';
interface OvenCardProps {
  entity: HassEntity;
  onStart?: () => void;
  onStop?: () => void;
  onModeChange?: (mode: string) => void;
  onTemperatureChange?: (temp: number) => void;
  onTimerSet?: (minutes: number) => void;
}

const OvenCard: React.FC<OvenCardProps> = (props) => {
  const { entity, onStart, onStop, onModeChange, onTemperatureChange, onTimerSet } = props;

  // 从entity中提取状态数据
  const isOn = entity.state === 'on';
  const mode = entity.attributes.mode || 'bake';
  const currentTemp = entity.attributes.current_temperature || 25;
  const targetTemp = entity.attributes.target_temperature || 180;
  const remainingTime = entity.attributes.remaining_time || 0;
  const isPreheating = entity.attributes.preheating || false;

  // 烤箱模式选项
  const ovenModes = [
    { id: 'bake', name: '烘烤', icon: Flame },
    { id: 'pizza', name: '披萨', icon: Pizza },
    { id: 'toast', name: '烤面包', icon: Sandwich },
    { id: 'cake', name: '蛋糕', icon: Cake },
  ];

  return (
    <ServiceCard entity={entity}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5" />
            {entity.attributes.friendly_name || '智能烤箱'}
          </CardTitle>
          <Badge
            variant="default"
            className={cn(
              'font-normal transition-colors',
              isPreheating ? 'bg-orange-500' : isOn ? 'bg-green-500' : 'bg-slate-500'
            )}
          >
            {isPreheating ? '预热中' : isOn ? '运行中' : '已关闭'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* 温度显示和控制 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">温度控制</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">当前: {currentTemp}°C</span>
              <span className="text-xs text-slate-500">目标: {targetTemp}°C</span>
            </div>
          </div>
          <Slider
            value={[targetTemp]}
            min={50}
            max={250}
            step={5}
            onValueChange={(value) => onTemperatureChange?.(value[0])}
            className="py-2"
            disabled={!isOn}
          />
          <div className="flex justify-between text-xs text-slate-500">
            <span>50°C</span>
            <span>150°C</span>
            <span>250°C</span>
          </div>
        </div>

        {/* 模式选择 */}
        <div className="space-y-2">
          <span className="text-sm font-medium">烘烤模式</span>
          <div className="grid grid-cols-4 gap-2">
            {ovenModes.map(({ id, name, icon: Icon }) => (
              <Button
                key={id}
                variant={mode === id ? 'default' : 'outline'}
                size="sm"
                className="h-16 flex-col gap-1"
                onClick={() => onModeChange?.(id)}
                disabled={!isOn}
              >
                <Icon className="h-4 w-4" />
                <span className="text-xs">{name}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* 定时控制 */}
        {isOn && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">定时设置</span>
              {remainingTime > 0 && (
                <Badge variant="outline" className="font-normal">
                  剩余 {remainingTime} 分钟
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              {[15, 30, 45, 60].map((minutes) => (
                <Button
                  key={minutes}
                  variant="outline"
                  size="sm"
                  className={cn(
                    'flex-1',
                    remainingTime === minutes ? 'bg-blue-500 text-white hover:bg-blue-600' : ''
                  )}
                  onClick={() => onTimerSet?.(minutes)}
                >
                  <Timer className="mr-1 h-3 w-3" />
                  {minutes}分钟
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* 控制按钮 */}
        <div className="pt-2">
          <Button
            variant="default"
            className={cn(
              'w-full',
              isOn ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
            )}
            onClick={isOn ? onStop : onStart}
          >
            {isPreheating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                预热中
              </>
            ) : (
              <>
                <Flame className="mr-2 h-4 w-4" />
                {isOn ? '停止' : '开始'}
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </ServiceCard>
  );
};

export { type OvenCardProps, OvenCard };
