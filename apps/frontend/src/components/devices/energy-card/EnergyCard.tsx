import React, { useMemo } from 'react';
import { BarChart, Zap, TrendingDown, TrendingUp, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HassEntity } from 'home-assistant-js-websocket';
import { twMerge } from 'tailwind-merge';
import clsx from 'clsx';
import { ServiceCard } from '@/components/devices/ServiceCard';
import { CardContent } from '@/components/ui/card';

interface EnergyCardProps {
  entity: HassEntity;
  dailyEntity?: HassEntity; // 日消耗量实体
  monthlyEntity?: HassEntity; // 月消耗量实体
  costEntity?: HassEntity; // 费用实体
  roomName?: string;
}

const EnergyCard: React.FC<EnergyCardProps> = ({
  entity,
  dailyEntity,
  monthlyEntity,
  costEntity,
  roomName,
}) => {
  // 获取当前功率
  const currentPower = useMemo(() => {
    // 假设entity是功率传感器
    const value = parseFloat(entity?.state || '0');
    return isNaN(value) ? 0 : value;
  }, [entity]);

  // 获取日能耗
  const dailyEnergy = useMemo(() => {
    const value = parseFloat(dailyEntity?.state || '0');
    return isNaN(value) ? 0 : value;
  }, [dailyEntity]);

  // 获取月能耗
  const monthlyEnergy = useMemo(() => {
    const value = parseFloat(monthlyEntity?.state || '0');
    return isNaN(value) ? 0 : value;
  }, [monthlyEntity]);

  // 获取电费
  const energyCost = useMemo(() => {
    const value = parseFloat(costEntity?.state || '0');
    return isNaN(value) ? 0 : value;
  }, [costEntity]);

  // 判断功率等级
  const getPowerLevel = (power: number) => {
    if (power < 500)
      return {
        label: '低负载',
        color: 'text-green-500',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-100',
      };
    if (power < 2000)
      return {
        label: '中负载',
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-100',
      };
    return {
      label: '高负载',
      color: 'text-red-500',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-100',
    };
  };

  // 格式化功率显示
  const formatPower = (power: number) => {
    if (power >= 1000) {
      return `${(power / 1000).toFixed(2)} kW`;
    }
    return `${power.toFixed(0)} W`;
  };

  // 格式化能耗显示
  const formatEnergy = (energy: number) => {
    if (energy >= 1) {
      return `${energy.toFixed(2)} kWh`;
    }
    return `${(energy * 1000).toFixed(0)} Wh`;
  };

  // 获取设备最后更新时间
  const lastUpdated = useMemo(() => {
    if (!entity?.last_updated) return '未知';
    const lastUpdateTime = new Date(entity.last_updated);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - lastUpdateTime.getTime()) / 60000);

    if (diffMinutes < 1) return '刚刚';
    if (diffMinutes < 60) return `${diffMinutes}分钟前`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}小时前`;

    return `${Math.floor(diffHours / 24)}天前`;
  }, [entity]);

  // 判断设备是否可用
  const isAvailable = useMemo(() => entity?.state !== 'unavailable', [entity]);

  // 获取功率状态信息
  const powerStatus = getPowerLevel(currentPower);

  // 获取今日能耗与昨日的比较趋势（模拟数据，实际应从历史数据获取）
  const energyTrend = useMemo(() => {
    // 这里假设：如果日能耗大于月能耗除以当月天数的1.2倍，则判定为上升趋势
    const avgDailyInMonth = monthlyEnergy / new Date().getDate();
    if (dailyEnergy > avgDailyInMonth * 1.2) {
      return { trend: 'up', percent: 20 };
    } else if (dailyEnergy < avgDailyInMonth * 0.8) {
      return { trend: 'down', percent: 20 };
    }
    return { trend: 'same', percent: 0 };
  }, [dailyEnergy, monthlyEnergy]);

  return (
    <ServiceCard entity={entity}>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Badge variant="secondary" className="mb-1">
              {roomName || '全屋'}
            </Badge>
            <h3 className="text-lg font-semibold">
              {entity?.attributes?.friendly_name || '能源监测'}
            </h3>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <div
              className={`h-2 w-2 rounded-full ${isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
            ></div>
            {lastUpdated}
          </div>
        </div>

        {/* 当前功率 */}
        <div
          className={twMerge(
            clsx(
              'mb-4 flex items-center justify-between rounded-xl border p-3',
              powerStatus.bgColor,
              powerStatus.borderColor
            )
          )}
        >
          <div className="flex items-center gap-2">
            <Zap className={`h-6 w-6 ${powerStatus.color}`} />
            <div>
              <div className="text-sm text-gray-500">当前功率</div>
              <div className="flex items-baseline">
                <span className={`text-2xl font-bold ${powerStatus.color}`}>
                  {formatPower(currentPower)}
                </span>
              </div>
            </div>
          </div>
          <Badge className={twMerge(clsx('px-2 py-1', powerStatus.bgColor, powerStatus.color))}>
            {powerStatus.label}
          </Badge>
        </div>

        {/* 能耗统计格子 */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          {/* 日能耗 */}
          <div className="flex flex-col rounded-xl border border-blue-100 bg-blue-50 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-gray-500">今日用电</span>
              {energyTrend.trend !== 'same' && (
                <div className="flex items-center text-xs">
                  {energyTrend.trend === 'up' ? (
                    <>
                      <TrendingUp className="mr-0.5 h-3 w-3 text-red-500" />
                      <span className="text-red-500">{energyTrend.percent}%</span>
                    </>
                  ) : (
                    <>
                      <TrendingDown className="mr-0.5 h-3 w-3 text-green-500" />
                      <span className="text-green-500">{energyTrend.percent}%</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-baseline">
              <span className="text-lg font-bold text-blue-500">{formatEnergy(dailyEnergy)}</span>
            </div>
          </div>

          {/* 月能耗 */}
          <div className="flex flex-col rounded-xl border border-purple-100 bg-purple-50 p-3">
            <div className="mb-1 text-xs text-gray-500">本月用电</div>
            <div className="flex items-baseline">
              <span className="text-lg font-bold text-purple-500">
                {formatEnergy(monthlyEnergy)}
              </span>
            </div>
          </div>
        </div>

        {/* 电费和用电时间统计 */}
        <div className="grid grid-cols-2 gap-2">
          {/* 电费 */}
          <div className="flex flex-col rounded-xl border border-amber-100 bg-amber-50 p-3">
            <div className="mb-1 text-xs text-gray-500">电费预估</div>
            <div className="flex items-baseline">
              <span className="text-lg font-bold text-amber-500">¥ {energyCost.toFixed(2)}</span>
            </div>
          </div>

          {/* 用电时段 */}
          <div className="flex flex-col rounded-xl border border-teal-100 bg-teal-50 p-3">
            <div className="mb-1 flex items-center text-xs text-gray-500">
              <Clock className="mr-1 h-3 w-3" />
              <span>用电高峰</span>
            </div>
            <div className="text-sm font-medium text-teal-600">18:00 - 22:00</div>
          </div>
        </div>

        {/* 历史数据按钮 */}
        <button className="mt-3 flex w-full items-center justify-center rounded-lg border border-gray-200 bg-white py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50">
          <BarChart className="mr-1 h-4 w-4" />
          查看历史数据
        </button>
      </CardContent>
    </ServiceCard>
  );
};

export { type EnergyCardProps, EnergyCard };
