import React from 'react';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ServiceCard, type HassEntity, cn } from '@zapmyco/ui';
import { Waves, Timer, RotateCcw, Shirt, Loader2 } from 'lucide-react';
interface WashingMachineCardProps {
  entity: HassEntity;
  onStart?: () => void;
  onPause?: () => void;
  onModeChange?: (mode: string) => void;
}

const WashingMachineCard: React.FC<WashingMachineCardProps> = (props) => {
  const { entity, onStart, onPause, onModeChange } = props;

  // 从entity中提取状态数据
  const status = entity.state; // idle, running, paused, completed
  const mode = entity.attributes.mode || 'normal';
  const remainingTime = entity.attributes.remaining_time || 0;
  const progress = entity.attributes.progress || 0;
  const waterTemp = entity.attributes.water_temperature || 30;
  const spinSpeed = entity.attributes.spin_speed || 800;

  // 获取状态描述
  const getStatusText = () => {
    switch (status) {
      case 'running':
        return '运行中';
      case 'paused':
        return '已暂停';
      case 'completed':
        return '已完成';
      default:
        return '待机中';
    }
  };

  // 获取状态颜色
  const getStatusColor = () => {
    switch (status) {
      case 'running':
        return 'bg-blue-500 hover:bg-blue-600';
      case 'paused':
        return 'bg-orange-500 hover:bg-orange-600';
      case 'completed':
        return 'bg-green-500 hover:bg-green-600';
      default:
        return 'bg-slate-500 hover:bg-slate-600';
    }
  };

  // 洗涤模式选项
  const washModes = [
    { id: 'normal', name: '标准', icon: Shirt },
    { id: 'quick', name: '快洗', icon: Timer },
    { id: 'intensive', name: '强力', icon: Waves },
    { id: 'delicate', name: '轻柔', icon: RotateCcw },
  ];

  return (
    <ServiceCard entity={entity}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Waves className="h-5 w-5" />
            {entity.attributes.friendly_name || '智能洗衣机'}
          </CardTitle>
          <Badge
            variant="default"
            className={cn('font-normal transition-colors', getStatusColor())}
          >
            {getStatusText()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* 进度和剩余时间 */}
        {status === 'running' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">洗涤进度</span>
              <span className="text-xs text-slate-500">剩余 {remainingTime} 分钟</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* 当前设置 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <span className="text-xs text-slate-500">水温</span>
            <div className="flex items-center gap-1">
              <span className="text-xl font-semibold">{waterTemp}</span>
              <span className="text-xs">°C</span>
            </div>
          </div>

          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <span className="text-xs text-slate-500">转速</span>
            <div className="flex items-center gap-1">
              <span className="text-xl font-semibold">{spinSpeed}</span>
              <span className="text-xs">RPM</span>
            </div>
          </div>
        </div>

        {/* 模式选择 */}
        <div className="space-y-2">
          <span className="text-sm font-medium">洗涤模式</span>
          <div className="grid grid-cols-4 gap-2">
            {washModes.map(({ id, name, icon: Icon }) => (
              <Button
                key={id}
                variant={mode === id ? 'default' : 'outline'}
                size="sm"
                className="h-16 flex-col gap-1"
                onClick={() => onModeChange?.(id)}
                disabled={status === 'running'}
              >
                <Icon className="h-4 w-4" />
                <span className="text-xs">{name}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* 控制按钮 */}
        <div className="pt-2">
          <Button
            variant="default"
            className={cn(
              'w-full',
              status === 'running'
                ? 'bg-orange-500 hover:bg-orange-600'
                : 'bg-blue-500 hover:bg-blue-600'
            )}
            onClick={status === 'running' ? onPause : onStart}
          >
            {status === 'running' ? (
              '暂停'
            ) : (
              <>
                {status === 'paused' ? (
                  '继续'
                ) : (
                  <>
                    <Loader2 className="mr-2 h-4 w-4" />
                    开始洗涤
                  </>
                )}
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </ServiceCard>
  );
};

export { type WashingMachineCardProps, WashingMachineCard };
