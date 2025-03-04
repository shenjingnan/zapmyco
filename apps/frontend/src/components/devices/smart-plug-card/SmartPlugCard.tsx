import React from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HassEntity } from 'home-assistant-js-websocket';
import { cn } from '@/lib/utils';
import { Power, Zap, Clock, Timer } from 'lucide-react';

interface SmartPlugCardProps {
  entity: HassEntity;
  onToggle?: () => void;
  onTimerSet?: (minutes: number) => void;
}

const SmartPlugCard: React.FC<SmartPlugCardProps> = (props) => {
  const { entity, onToggle, onTimerSet } = props;

  // 从entity中提取状态数据
  const isOn = entity.state === 'on';
  const power = entity.attributes.current_power_w || 0;
  const energy = entity.attributes.today_energy_kwh || 0;
  const hasTimer = entity.attributes.timer_active || false;
  const timeLeft = entity.attributes.timer_remaining_minutes || 0;

  // 快速定时选项（分钟）
  const timerOptions = [30, 60, 120, 240];

  // 获取功率状态描述
  const getPowerStatus = () => {
    if (power === 0) return { text: '待机', color: 'bg-slate-500' };
    if (power < 10) return { text: '低功率', color: 'bg-green-500' };
    if (power < 100) return { text: '中功率', color: 'bg-yellow-500' };
    return { text: '高功率', color: 'bg-red-500' };
  };

  const powerStatus = getPowerStatus();

  return (
    <Card className="w-full shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Power className="h-5 w-5" />
            {entity.attributes.friendly_name || '智能插座'}
          </CardTitle>
          <Badge
            variant="default"
            className={cn(
              'font-normal transition-colors',
              isOn ? 'bg-green-500 hover:bg-green-600' : 'bg-slate-500 hover:bg-slate-600'
            )}
          >
            {isOn ? '已开启' : '已关闭'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {/* 电量监控 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <Zap className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-500">当前功率</span>
            <div className="flex items-center gap-1">
              <span className="text-xl font-semibold">{power}</span>
              <span className="text-xs">W</span>
            </div>
            <Badge className={cn('mt-1 px-2 py-0', powerStatus.color)}>{powerStatus.text}</Badge>
          </div>

          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <Clock className="mb-1 h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-500">今日用电</span>
            <div className="flex items-center gap-1">
              <span className="text-xl font-semibold">{energy.toFixed(2)}</span>
              <span className="text-xs">kWh</span>
            </div>
          </div>
        </div>

        {/* 定时控制 */}
        {isOn && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">定时关闭</span>
              {hasTimer && (
                <Badge variant="outline" className="font-normal">
                  剩余 {timeLeft} 分钟
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              {timerOptions.map((minutes) => (
                <Button
                  key={minutes}
                  variant="outline"
                  size="sm"
                  className={cn(
                    'flex-1 text-xs',
                    timeLeft === minutes ? 'bg-blue-500 text-white hover:bg-blue-600' : ''
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
    </Card>
  );
};

export { type SmartPlugCardProps, SmartPlugCard };
