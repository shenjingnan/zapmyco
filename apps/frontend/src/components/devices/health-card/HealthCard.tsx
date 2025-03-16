import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ServiceCard, type HassEntity } from '@zapmyco/ui';
import { Heart, Activity, Moon, Footprints, Timer, Flame } from 'lucide-react';

interface HealthMetric {
  value: number;
  unit: string;
  status: 'normal' | 'warning' | 'alert';
}

interface HealthCardProps {
  entity: HassEntity;
}

const HealthCard: React.FC<HealthCardProps> = (props) => {
  const { entity } = props;

  // 从entity中提取状态数据
  const heartRate = entity.attributes.heart_rate || 0;
  const bloodPressure = {
    systolic: entity.attributes.blood_pressure_systolic || 0,
    diastolic: entity.attributes.blood_pressure_diastolic || 0,
  };
  const sleepHours = entity.attributes.sleep_hours || 0;
  const sleepQuality = entity.attributes.sleep_quality || 0;
  const steps = entity.attributes.steps || 0;
  const stepsGoal = entity.attributes.steps_goal || 10000;
  const activeMinutes = entity.attributes.active_minutes || 0;
  const calories = entity.attributes.calories_burned || 0;

  // 健康指标数据
  const metrics: { [key: string]: HealthMetric } = {
    heartRate: {
      value: heartRate,
      unit: 'bpm',
      status: heartRate > 100 || heartRate < 60 ? 'warning' : 'normal',
    },
    bloodPressure: {
      value: bloodPressure.systolic,
      unit: 'mmHg',
      status: bloodPressure.systolic > 140 || bloodPressure.diastolic > 90 ? 'warning' : 'normal',
    },
    sleepQuality: {
      value: sleepQuality,
      unit: '%',
      status: sleepQuality < 70 ? 'warning' : 'normal',
    },
  };

  return (
    <ServiceCard entity={entity}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            {entity.attributes.friendly_name || '健康监测'}
          </CardTitle>
          <Badge
            variant="outline"
            className={`font-normal ${
              Object.values(metrics).some((m) => m.status !== 'normal')
                ? 'text-yellow-500'
                : 'text-green-500'
            }`}
          >
            {Object.values(metrics).some((m) => m.status !== 'normal') ? '需要关注' : '状态良好'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* 主要健康指标 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            <Heart className="mb-1 h-5 w-5 text-red-500" />
            <div className="flex items-center gap-1">
              <span className="text-xl font-bold">{heartRate}</span>
              <span className="text-xs text-slate-500">bpm</span>
            </div>
            <span className="text-xs text-slate-500">心率</span>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            <Activity className="mb-1 h-5 w-5 text-blue-500" />
            <div className="flex items-center gap-1">
              <span className="text-xl font-bold">
                {bloodPressure.systolic}/{bloodPressure.diastolic}
              </span>
            </div>
            <span className="text-xs text-slate-500">血压</span>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            <Moon className="mb-1 h-5 w-5 text-purple-500" />
            <div className="flex items-center gap-1">
              <span className="text-xl font-bold">{sleepHours}</span>
              <span className="text-xs text-slate-500">小时</span>
            </div>
            <span className="text-xs text-slate-500">睡眠时长</span>
          </div>
        </div>

        {/* 运动数据 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Footprints className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium">今日步数</span>
            </div>
            <span className="text-sm text-slate-500">
              {steps}/{stepsGoal}
            </span>
          </div>
          <Progress value={(steps / stepsGoal) * 100} className="h-2" />
        </div>

        {/* 活动统计 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-green-500" />
              <span className="text-sm">活动时间</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-medium">{activeMinutes}</span>
              <span className="text-xs text-slate-500">分钟</span>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" />
              <span className="text-sm">消耗热量</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-medium">{calories}</span>
              <span className="text-xs text-slate-500">千卡</span>
            </div>
          </div>
        </div>

        {/* 睡眠质量 */}
        <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-purple-500" />
              <span className="text-sm font-medium">睡眠质量</span>
            </div>
            <Badge
              variant="outline"
              className={`font-normal ${sleepQuality >= 80 ? 'text-green-500' : 'text-yellow-500'}`}
            >
              {sleepQuality}%
            </Badge>
          </div>
          <Progress value={sleepQuality} className="h-2" />
          <div className="mt-2 text-xs text-slate-500">
            {sleepQuality >= 80
              ? '睡眠质量良好'
              : sleepQuality >= 60
                ? '睡眠质量一般'
                : '睡眠质量欠佳'}
          </div>
        </div>
      </CardContent>
    </ServiceCard>
  );
};

export { type HealthCardProps, HealthCard };
