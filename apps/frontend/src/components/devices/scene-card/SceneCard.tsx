import React from 'react';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HassEntity } from 'home-assistant-js-websocket';
import { cn } from '@/lib/utils';
import {
  Home,
  Moon,
  Sun,
  DoorClosed,
  Sofa,
  Coffee,
  Utensils,
  PartyPopper,
  Calendar,
  Clock,
} from 'lucide-react';
import { ServiceCard } from '@/components/devices/ServiceCard';
interface SceneCardProps {
  entity: HassEntity;
  onSceneActivate?: (scene: string) => void;
  onScheduleChange?: (schedule: { scene: string; time: string; days: string[] }) => void;
}

const SceneCard: React.FC<SceneCardProps> = (props) => {
  const { entity, onSceneActivate } = props;

  // 从entity中提取状态数据
  const activeScene = entity.state;
  const lastActivated = entity.attributes.last_activated || '';
  const nextSchedule = entity.attributes.next_schedule || null;
  const automationEnabled = entity.attributes.automation_enabled || false;

  // 场景定义
  const scenes = [
    { id: 'home', name: '回家', icon: Home, color: 'bg-green-500' },
    { id: 'sleep', name: '睡眠', icon: Moon, color: 'bg-blue-500' },
    { id: 'away', name: '离家', icon: DoorClosed, color: 'bg-slate-500' },
    { id: 'movie', name: '影院', icon: Sofa, color: 'bg-purple-500' },
    { id: 'morning', name: '早晨', icon: Coffee, color: 'bg-yellow-500' },
    { id: 'dinner', name: '晚餐', icon: Utensils, color: 'bg-orange-500' },
    { id: 'party', name: '派对', icon: PartyPopper, color: 'bg-pink-500' },
    { id: 'work', name: '工作', icon: Sun, color: 'bg-cyan-500' },
  ];

  // 获取场景图标和颜色
  const getSceneInfo = (sceneId: string) => {
    return scenes.find((scene) => scene.id === sceneId) || scenes[0];
  };

  const currentScene = getSceneInfo(activeScene);

  return (
    <ServiceCard entity={entity}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {entity.attributes.friendly_name || '场景模式'}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn('font-normal', automationEnabled ? 'text-green-500' : 'text-slate-500')}
            >
              {automationEnabled ? '自动' : '手动'}
            </Badge>
            <Badge variant="default" className={cn('font-normal', currentScene.color)}>
              {currentScene.name}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* 场景网格 */}
        <div className="grid grid-cols-4 gap-2">
          {scenes.map(({ id, name, icon: Icon, color }) => (
            <Button
              key={id}
              variant={activeScene === id ? 'default' : 'outline'}
              size="sm"
              className={cn('h-20 flex-col gap-1', activeScene === id && color)}
              onClick={() => onSceneActivate?.(id)}
            >
              <Icon className="h-6 w-6" />
              <span className="text-xs">{name}</span>
            </Button>
          ))}
        </div>

        {/* 下一个预定场景 */}
        {nextSchedule && (
          <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">下一个预定场景</span>
              <Badge variant="outline" className="font-normal">
                <Clock className="mr-1 h-3 w-3" />
                {nextSchedule.time}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  getSceneInfo(nextSchedule.scene).color
                )}
              >
                {React.createElement(getSceneInfo(nextSchedule.scene).icon, {
                  className: 'h-4 w-4 text-white',
                })}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{getSceneInfo(nextSchedule.scene).name}</span>
                <span className="text-xs text-slate-500">{nextSchedule.days.join(', ')}</span>
              </div>
            </div>
          </div>
        )}

        {/* 最近激活记录 */}
        {lastActivated && (
          <div className="text-center text-xs text-slate-500">
            上次切换时间: {new Date(lastActivated).toLocaleString()}
          </div>
        )}
      </CardContent>
    </ServiceCard>
  );
};

export { type SceneCardProps, SceneCard };
