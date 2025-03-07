import React, { useCallback, useMemo } from 'react';
import { ChevronUp, ChevronDown, Power } from 'lucide-react';
import { CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider-ios';
import { Badge } from '@/components/ui/badge';
import { callService } from 'home-assistant-js-websocket';
import { HassEntity } from 'home-assistant-js-websocket';
import { useHomeAssistant } from '@/use-home-assistant';
import { ServiceCard } from '@/components/devices/ServiceCard';

interface ThermostatCardProps {
  entity: HassEntity;
  roomName?: string;
}

// 温度模式类型
type HvacMode = 'off' | 'heat' | 'cool' | 'heat_cool' | 'auto' | 'dry' | 'fan_only';

// 温度模式名称映射
const HVAC_MODE_NAMES: Record<HvacMode, string> = {
  off: '关闭',
  heat: '制热',
  cool: '制冷',
  heat_cool: '自动',
  auto: '自动',
  dry: '除湿',
  fan_only: '风扇',
};

// 温度模式颜色映射
const HVAC_MODE_COLORS: Record<HvacMode, { bg: string; text: string; border: string }> = {
  off: { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200' },
  heat: { bg: 'bg-red-50', text: 'text-red-500', border: 'border-red-100' },
  cool: { bg: 'bg-blue-50', text: 'text-blue-500', border: 'border-blue-100' },
  heat_cool: { bg: 'bg-purple-50', text: 'text-purple-500', border: 'border-purple-100' },
  auto: { bg: 'bg-purple-50', text: 'text-purple-500', border: 'border-purple-100' },
  dry: { bg: 'bg-teal-50', text: 'text-teal-500', border: 'border-teal-100' },
  fan_only: { bg: 'bg-cyan-50', text: 'text-cyan-500', border: 'border-cyan-100' },
};

const ThermostatCard: React.FC<ThermostatCardProps> = ({ entity, roomName }) => {
  const { connection } = useHomeAssistant();

  // 获取恒温器的当前状态
  const hvacMode = useMemo(
    (): HvacMode => (entity?.attributes?.hvac_mode as HvacMode) || 'off',
    [entity]
  );

  // 获取恒温器的当前温度
  const currentTemp = useMemo(() => entity?.attributes?.current_temperature || 25, [entity]);

  // 获取恒温器的目标温度
  const targetTemp = useMemo(() => entity?.attributes?.temperature || 25, [entity]);

  // 获取恒温器支持的温度范围
  const tempRange = useMemo(() => {
    return {
      min: entity?.attributes?.min_temp || 16,
      max: entity?.attributes?.max_temp || 30,
      step: entity?.attributes?.target_temp_step || 0.5,
    };
  }, [entity]);

  // 获取恒温器支持的操作模式
  const supportedModes = useMemo(
    (): HvacMode[] => entity?.attributes?.hvac_modes || ['off', 'heat', 'cool'],
    [entity]
  );

  // 获取设备是否可用
  const isAvailable = useMemo(() => entity?.state !== 'unavailable', [entity]);

  // 获取设备是否已开启（不是 off 模式）
  const isOn = useMemo(() => hvacMode !== 'off', [hvacMode]);

  // 处理温度调节
  const handleTemperatureChange = useCallback(
    (value: number[]) => {
      if (!connection || !isAvailable) return;

      callService(connection, 'climate', 'set_temperature', {
        entity_id: entity.entity_id,
        temperature: value[0],
      });
    },
    [connection, entity, isAvailable]
  );

  // 处理模式切换
  const handleModeChange = useCallback(
    (mode: HvacMode) => {
      if (!connection || !isAvailable) return;

      callService(connection, 'climate', 'set_hvac_mode', {
        entity_id: entity.entity_id,
        hvac_mode: mode,
      });
    },
    [connection, entity, isAvailable]
  );

  // 切换开关状态
  const togglePower = useCallback(() => {
    if (!connection || !isAvailable) return;

    const newMode = isOn
      ? 'off'
      : supportedModes.includes('heat')
        ? 'heat'
        : supportedModes.includes('cool')
          ? 'cool'
          : 'auto';

    handleModeChange(newMode);
  }, [connection, isAvailable, isOn, supportedModes, handleModeChange]);

  // 增加/减少温度的快捷按钮
  const adjustTemperature = useCallback(
    (amount: number) => {
      if (!connection || !isAvailable || !isOn) return;

      const newTemp = Math.min(Math.max(targetTemp + amount, tempRange.min), tempRange.max);

      callService(connection, 'climate', 'set_temperature', {
        entity_id: entity.entity_id,
        temperature: newTemp,
      });
    },
    [connection, entity, isAvailable, isOn, targetTemp, tempRange]
  );

  // 获取显示的温度差值
  const tempDifference = useMemo(() => {
    if (!isOn) return 0;
    return targetTemp - currentTemp;
  }, [isOn, targetTemp, currentTemp]);

  // 获取当前模式的主题颜色
  const modeColors = useMemo(() => HVAC_MODE_COLORS[hvacMode], [hvacMode]);

  return (
    <ServiceCard entity={entity}>
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Badge variant="secondary" className="mb-1">
              {roomName || '起居室'}
            </Badge>
            <h3 className="text-lg font-semibold">
              {entity?.attributes?.friendly_name || '恒温器'}
            </h3>
          </div>
          <button
            onClick={togglePower}
            className={`flex size-10 items-center justify-center rounded-full transition-colors ${
              isOn
                ? modeColors.bg + ' ' + modeColors.text
                : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
            }`}
            disabled={!isAvailable}
          >
            <Power size={18} />
          </button>
        </div>

        <div
          className={`mb-6 mt-3 grid grid-cols-2 gap-2 rounded-xl border p-3 ${modeColors.border} ${modeColors.bg}`}
        >
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-medium text-gray-500">当前温度</span>
            <div className="flex items-baseline">
              <span className={`text-2xl font-bold ${modeColors.text}`}>
                {currentTemp.toFixed(1)}
              </span>
              <span className="ml-0.5 text-sm">°C</span>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-medium text-gray-500">目标温度</span>
            <div className="flex items-baseline">
              <span className={`text-2xl font-bold ${modeColors.text}`}>
                {targetTemp.toFixed(1)}
              </span>
              <span className="ml-0.5 text-sm">°C</span>
            </div>
            {tempDifference !== 0 && (
              <span className={`text-xs ${tempDifference > 0 ? 'text-red-400' : 'text-blue-400'}`}>
                {tempDifference > 0 ? '升温中' : '降温中'} {Math.abs(tempDifference).toFixed(1)}°C
              </span>
            )}
          </div>
        </div>

        {isOn && (
          <>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-gray-600">温度调节</span>
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => adjustTemperature(-tempRange.step)}
                  className={`rounded p-1 text-gray-500 hover:bg-gray-100 ${
                    !isAvailable || targetTemp <= tempRange.min
                      ? 'cursor-not-allowed opacity-50'
                      : ''
                  }`}
                  disabled={!isAvailable || targetTemp <= tempRange.min}
                >
                  <ChevronDown size={16} />
                </button>
                <span className="text-sm font-medium">{targetTemp.toFixed(1)}°C</span>
                <button
                  onClick={() => adjustTemperature(tempRange.step)}
                  className={`rounded p-1 text-gray-500 hover:bg-gray-100 ${
                    !isAvailable || targetTemp >= tempRange.max
                      ? 'cursor-not-allowed opacity-50'
                      : ''
                  }`}
                  disabled={!isAvailable || targetTemp >= tempRange.max}
                >
                  <ChevronUp size={16} />
                </button>
              </div>
            </div>

            <Slider
              defaultValue={[targetTemp]}
              min={tempRange.min}
              max={tempRange.max}
              step={tempRange.step}
              value={[targetTemp]}
              onValueChange={handleTemperatureChange}
              disabled={!isAvailable || !isOn}
              className={`mb-4 w-full ${!isAvailable || !isOn ? 'cursor-not-allowed opacity-50' : ''}`}
            />
          </>
        )}

        <div>
          <div className="mb-2 text-sm text-gray-600">模式选择</div>
          <div className="grid grid-cols-3 gap-2">
            {supportedModes.map((mode) => (
              <button
                key={mode}
                onClick={() => handleModeChange(mode)}
                className={`rounded-lg p-2 text-xs transition-colors ${
                  mode === hvacMode
                    ? HVAC_MODE_COLORS[mode].bg +
                      ' ' +
                      HVAC_MODE_COLORS[mode].text +
                      ' font-medium' +
                      HVAC_MODE_COLORS[mode].border +
                      ' border'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                } ${!isAvailable ? 'cursor-not-allowed opacity-50' : ''}`}
                disabled={!isAvailable}
              >
                {HVAC_MODE_NAMES[mode]}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </ServiceCard>
  );
};

export { type ThermostatCardProps, ThermostatCard };
