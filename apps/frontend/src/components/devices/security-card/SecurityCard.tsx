import React, { useMemo, useCallback } from 'react';
import { Shield, ShieldAlert, ShieldCheck, Camera, Bell, DoorOpen, Clock, Eye } from 'lucide-react';
import { CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HassEntity } from 'home-assistant-js-websocket';
import { callService } from 'home-assistant-js-websocket';
import { useHomeAssistant } from '@/use-home-assistant';
import { twMerge } from 'tailwind-merge';
import clsx from 'clsx';
import { ServiceCard } from '@/components/devices/ServiceCard';

// 安防系统状态类型
type SecurityState =
  | 'disarmed'
  | 'armed_home'
  | 'armed_away'
  | 'armed_night'
  | 'pending'
  | 'triggered'
  | 'unknown';

// 安防系统状态配置
const SECURITY_STATES: Record<
  SecurityState,
  { label: string; icon: React.ReactNode; color: string; bgColor: string; borderColor: string }
> = {
  disarmed: {
    label: '已撤防',
    icon: <Shield className="h-5 w-5" />,
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
  },
  armed_home: {
    label: '在家警戒',
    icon: <ShieldCheck className="h-5 w-5" />,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  armed_away: {
    label: '离家警戒',
    icon: <ShieldCheck className="h-5 w-5" />,
    color: 'text-orange-500',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
  },
  armed_night: {
    label: '夜间警戒',
    icon: <ShieldCheck className="h-5 w-5" />,
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
  },
  pending: {
    label: '警戒中',
    icon: <Shield className="h-5 w-5" />,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
  },
  triggered: {
    label: '警报触发',
    icon: <ShieldAlert className="h-5 w-5" />,
    color: 'text-red-500',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  unknown: {
    label: '未知',
    icon: <Shield className="h-5 w-5" />,
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
  },
};

// 默认状态配置，用于避免undefined错误
const DEFAULT_STATE_CONFIG = SECURITY_STATES.unknown;

interface SecurityCardProps {
  entity: HassEntity; // 安防系统实体
  camerasEntities?: HassEntity[]; // 摄像头实体列表
  doorsEntities?: HassEntity[]; // 门窗传感器实体列表
  motionEntities?: HassEntity[]; // 运动传感器实体列表
  lastEvents?: {
    // 最近事件
    type: string;
    time: string;
    device: string;
    entityId?: string;
  }[];
}

const SecurityCard: React.FC<SecurityCardProps> = ({
  entity,
  camerasEntities = [],
  doorsEntities = [],
  motionEntities = [],
  lastEvents = [],
}) => {
  const { connection } = useHomeAssistant();

  const securityState = useMemo((): SecurityState => {
    if (!entity) return 'unknown';

    // 验证state是否为有效的SecurityState
    const state = entity.state as string;
    return Object.keys(SECURITY_STATES).includes(state) ? (state as SecurityState) : 'unknown';
  }, [entity]);

  const stateConfig = useMemo(() => {
    // 确保securityState是有效的键，否则返回默认配置
    return SECURITY_STATES[securityState] || DEFAULT_STATE_CONFIG;
  }, [securityState]);

  const onlineCameras = useMemo(() => {
    return camerasEntities.filter((cam) => cam.state !== 'unavailable').length;
  }, [camerasEntities]);

  const openDoors = useMemo(() => {
    return doorsEntities.filter((door) => door.state === 'on' || door.state === 'open').length;
  }, [doorsEntities]);

  const activeMotions = useMemo(() => {
    return motionEntities.filter((motion) => motion.state === 'on' || motion.state === 'detected')
      .length;
  }, [motionEntities]);

  const formatEventTime = (timeStr: string) => {
    try {
      const eventTime = new Date(timeStr);
      const now = new Date();
      const diffMinutes = Math.floor((now.getTime() - eventTime.getTime()) / 60000);

      if (diffMinutes < 1) return '刚刚';
      if (diffMinutes < 60) return `${diffMinutes}分钟前`;

      const hours = eventTime.getHours().toString().padStart(2, '0');
      const minutes = eventTime.getMinutes().toString().padStart(2, '0');
      return `今天 ${hours}:${minutes}`;
    } catch {
      return timeStr;
    }
  };

  const setSecurityMode = useCallback(
    (mode: SecurityState) => {
      if (
        !connection ||
        !entity ||
        mode === 'unknown' ||
        mode === 'triggered' ||
        mode === 'pending'
      ) {
        return;
      }

      const domain = entity.entity_id.split('.')[0];
      const service = mode === 'disarmed' ? 'disarm' : 'arm';
      const serviceData: Record<string, string> = {
        entity_id: entity.entity_id,
      };

      // 如果是警戒模式，需要添加特定的模式参数
      if (service === 'arm') {
        if (mode === 'armed_home') {
          serviceData.arm_mode = 'home';
        } else if (mode === 'armed_away') {
          serviceData.arm_mode = 'away';
        } else if (mode === 'armed_night') {
          serviceData.arm_mode = 'night';
        }
      }

      callService(connection, domain, service, serviceData);
    },
    [connection, entity]
  );

  const latestEvent = useMemo(() => {
    if (lastEvents.length === 0) return null;
    return lastEvents[0];
  }, [lastEvents]);

  return (
    <ServiceCard entity={entity}>
      <CardContent className="p-4">
        {/* 标题和状态 */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <Badge variant="secondary" className="mb-1">
              安防系统
            </Badge>
            <h3 className="text-lg font-semibold">
              {entity?.attributes?.friendly_name || '家庭安防'}
            </h3>
          </div>

          <Badge
            className={twMerge(
              clsx('flex items-center gap-1 px-2 py-1', stateConfig.bgColor, stateConfig.color)
            )}
          >
            {stateConfig.icon}
            {stateConfig.label}
          </Badge>
        </div>

        {/* 安防系统状态总览 */}
        <div
          className={twMerge(
            clsx('mb-4 rounded-xl border p-3', stateConfig.borderColor, stateConfig.bgColor)
          )}
        >
          <div className="grid grid-cols-3 gap-2">
            {/* 摄像头状态 */}
            <div className="flex flex-col items-center justify-center">
              <Camera className="mb-1 h-6 w-6 text-blue-500" />
              <div className="text-center">
                <div className="text-sm font-medium">
                  {onlineCameras}/{camerasEntities.length}
                </div>
                <div className="text-xs text-gray-500">摄像头</div>
              </div>
            </div>

            {/* 门窗状态 */}
            <div className="flex flex-col items-center justify-center">
              <DoorOpen
                className={`mb-1 h-6 w-6 ${openDoors > 0 ? 'text-orange-500' : 'text-green-500'}`}
              />
              <div className="text-center">
                <div className="text-sm font-medium">
                  {openDoors}/{doorsEntities.length}
                </div>
                <div className="text-xs text-gray-500">门窗开启</div>
              </div>
            </div>

            {/* 活动状态 */}
            <div className="flex flex-col items-center justify-center">
              <Eye
                className={`mb-1 h-6 w-6 ${activeMotions > 0 ? 'text-purple-500' : 'text-gray-400'}`}
              />
              <div className="text-center">
                <div className="text-sm font-medium">
                  {activeMotions}/{motionEntities.length}
                </div>
                <div className="text-xs text-gray-500">活动检测</div>
              </div>
            </div>
          </div>
        </div>

        {/* 最近事件 */}
        <div className="mb-4">
          <div className="mb-2 flex items-center text-sm text-gray-600">
            <Bell className="mr-1 h-4 w-4" />
            <span>最近事件</span>
          </div>

          {latestEvent ? (
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{latestEvent.device}</div>
                  <div className="text-sm text-gray-500">{latestEvent.type}</div>
                </div>
                <div className="flex items-center text-xs text-gray-400">
                  <Clock className="mr-1 h-3 w-3" />
                  {formatEventTime(latestEvent.time)}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white p-3 text-center text-sm text-gray-500">
              暂无记录
            </div>
          )}
        </div>

        {/* 安防模式切换按钮 */}
        <div>
          <div className="mb-2 text-sm text-gray-600">安防模式</div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setSecurityMode('disarmed')}
              className={`flex flex-col items-center justify-center rounded-xl border p-2 transition-colors ${
                securityState === 'disarmed'
                  ? 'border-gray-300 bg-gray-100'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
              disabled={securityState === 'pending' || securityState === 'triggered'}
            >
              <Shield className="mb-1 h-5 w-5 text-gray-500" />
              <span className="text-xs">撤防</span>
            </button>

            <button
              onClick={() => setSecurityMode('armed_home')}
              className={`flex flex-col items-center justify-center rounded-xl border p-2 transition-colors ${
                securityState === 'armed_home'
                  ? 'border-blue-300 bg-blue-100'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
              disabled={securityState === 'pending' || securityState === 'triggered'}
            >
              <ShieldCheck className="mb-1 h-5 w-5 text-blue-500" />
              <span className="text-xs">在家</span>
            </button>

            <button
              onClick={() => setSecurityMode('armed_away')}
              className={`flex flex-col items-center justify-center rounded-xl border p-2 transition-colors ${
                securityState === 'armed_away'
                  ? 'border-orange-300 bg-orange-100'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
              disabled={securityState === 'pending' || securityState === 'triggered'}
            >
              <ShieldCheck className="mb-1 h-5 w-5 text-orange-500" />
              <span className="text-xs">离家</span>
            </button>
          </div>
        </div>

        {/* 查看所有安防设备按钮 */}
        <button className="mt-3 flex w-full items-center justify-center rounded-lg border border-gray-200 bg-white py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50">
          <Camera className="mr-1 h-4 w-4" />
          查看所有设备
        </button>
      </CardContent>
    </ServiceCard>
  );
};

export { type SecurityCardProps, SecurityCard };
