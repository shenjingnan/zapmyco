import React from 'react';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { HassEntity } from 'home-assistant-js-websocket';
import { cn } from '@/lib/utils';
import {
  Zap,
  Clock,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  PlayCircle,
  History,
  Settings2,
} from 'lucide-react';
import { ServiceCard } from '@/components/devices/ServiceCard';

interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  type: 'time' | 'state' | 'schedule';
  time?: string;
  condition?: string;
  schedule?: string;
}

interface AutomationCardProps {
  entity: HassEntity;
  onToggleAutomation?: (id: string, enabled: boolean) => void;
  onTriggerAutomation?: (id: string) => void;
}

const AutomationCard: React.FC<AutomationCardProps> = (props) => {
  const { entity, onToggleAutomation, onTriggerAutomation } = props;

  // 从entity中提取状态数据
  const automations = (entity.attributes.automations || []) as AutomationRule[];
  const lastTriggered = entity.attributes.last_triggered || '';
  const activeCount = automations.filter((auto) => auto.enabled).length;

  return (
    <ServiceCard entity={entity}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            {entity.attributes.friendly_name || '自动化状态'}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-normal">
              {activeCount}/{automations.length} 个已启用
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* 自动化规则列表 */}
        <div className="space-y-2">
          {automations.map((auto) => (
            <div
              key={auto.id}
              className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full',
                    auto.enabled ? 'bg-green-500' : 'bg-slate-500'
                  )}
                >
                  {auto.type === 'time' ? (
                    <Clock className="h-4 w-4 text-white" />
                  ) : auto.type === 'state' ? (
                    <Settings2 className="h-4 w-4 text-white" />
                  ) : (
                    <Calendar className="h-4 w-4 text-white" />
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="font-medium">{auto.name}</span>
                  <span className="text-xs text-slate-500">
                    {auto.type === 'time'
                      ? `每天 ${auto.time}`
                      : auto.type === 'state'
                        ? `当 ${auto.condition}`
                        : auto.schedule}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onTriggerAutomation?.(auto.id)}
                >
                  <PlayCircle className="h-4 w-4" />
                </Button>
                <Switch
                  checked={auto.enabled}
                  onCheckedChange={(checked) => onToggleAutomation?.(auto.id, checked)}
                />
              </div>
            </div>
          ))}
        </div>

        {/* 执行状态统计 */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <CheckCircle2 className="mb-1 h-5 w-5 text-green-500" />
            <span className="text-lg font-semibold">{entity.attributes.success_count || 0}</span>
            <span className="text-xs text-slate-500">成功执行</span>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <XCircle className="mb-1 h-5 w-5 text-red-500" />
            <span className="text-lg font-semibold">{entity.attributes.failed_count || 0}</span>
            <span className="text-xs text-slate-500">执行失败</span>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
            <AlertTriangle className="mb-1 h-5 w-5 text-yellow-500" />
            <span className="text-lg font-semibold">{entity.attributes.warning_count || 0}</span>
            <span className="text-xs text-slate-500">警告次数</span>
          </div>
        </div>

        {/* 最近执行记录 */}
        {lastTriggered && (
          <div className="flex items-center justify-between rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-500" />
              <span className="text-sm">最近执行</span>
            </div>
            <span className="text-xs text-slate-500">
              {new Date(lastTriggered).toLocaleString()}
            </span>
          </div>
        )}
      </CardContent>
    </ServiceCard>
  );
};

export { type AutomationCardProps, AutomationCard };
