import React from 'react';
import { CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { HassEntity } from 'home-assistant-js-websocket';
import { cn } from '@/lib/utils';
import { Blinds, ChevronUp, ChevronDown, Pause, Sun, Moon } from 'lucide-react';
import { ServiceCard } from '@/components/devices/ServiceCard';

interface CurtainCardProps {
  entity: HassEntity;
  onOpen?: () => void;
  onClose?: () => void;
  onStop?: () => void;
  onPositionChange?: (position: number) => void;
  onPresetSelect?: (preset: string) => void;
}

const CurtainCard: React.FC<CurtainCardProps> = (props) => {
  const { entity, onOpen, onClose, onStop, onPositionChange, onPresetSelect } = props;

  // 从entity中提取状态数据
  const isMoving = entity.state === 'opening' || entity.state === 'closing';
  const position = entity.attributes.current_position || 0; // 0 表示完全关闭，100 表示完全打开
  const isFullyOpen = position === 100;
  const isFullyClosed = position === 0;

  // 获取窗帘状态描述
  const getStatusText = () => {
    if (isMoving) {
      return entity.state === 'opening' ? '正在打开' : '正在关闭';
    }
    if (isFullyOpen) return '已打开';
    if (isFullyClosed) return '已关闭';
    return '部分打开';
  };

  // 获取状态颜色
  const getStatusColor = () => {
    if (isMoving) return 'bg-blue-500 hover:bg-blue-600';
    if (isFullyOpen) return 'bg-green-500 hover:bg-green-600';
    if (isFullyClosed) return 'bg-slate-500 hover:bg-slate-600';
    return 'bg-orange-500 hover:bg-orange-600';
  };

  return (
    <ServiceCard entity={entity}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Blinds className="h-5 w-5" />
            {entity.attributes.friendly_name || '智能窗帘'}
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
        {/* 位置显示和控制 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">当前位置</span>
            <span className="text-xs text-slate-500">{position}%</span>
          </div>
          <Slider
            value={[position]}
            min={0}
            max={100}
            step={1}
            onValueChange={(value) => onPositionChange?.(value[0])}
            className="py-2"
          />
          <div className="flex justify-between text-xs text-slate-500">
            <span>关闭</span>
            <span>打开</span>
          </div>
        </div>

        {/* 快捷操作按钮 */}
        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onPresetSelect?.('morning')}
          >
            <Sun className="mr-1 h-4 w-4" />
            晨光
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onPresetSelect?.('night')}
          >
            <Moon className="mr-1 h-4 w-4" />
            夜晚
          </Button>
        </div>
      </CardContent>

      <CardFooter className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          className={cn(
            'transition-colors',
            isFullyOpen ? 'bg-green-500 text-white hover:bg-green-600' : ''
          )}
          onClick={onOpen}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          className={cn(
            'transition-colors',
            isMoving ? 'bg-orange-500 text-white hover:bg-orange-600' : ''
          )}
          onClick={onStop}
        >
          <Pause className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          className={cn(
            'transition-colors',
            isFullyClosed ? 'bg-slate-500 text-white hover:bg-slate-600' : ''
          )}
          onClick={onClose}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </CardFooter>
    </ServiceCard>
  );
};

export { type CurtainCardProps, CurtainCard };
