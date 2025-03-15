import { useState, useEffect } from 'react';
import { DeviceInfo, DeviceStatus } from '../utils/types';

/**
 * 设备状态钩子，用于监听和更新设备状态
 * @param deviceId 设备ID
 * @param initialStatus 初始状态
 * @param onStatusChange 状态变化回调
 * @returns 设备状态和更新函数
 */
export function useDeviceStatus(
  deviceId: string,
  initialStatus: DeviceStatus,
  onStatusChange?: (deviceId: string, status: DeviceStatus) => void
) {
  const [status, setStatus] = useState<DeviceStatus>(initialStatus);

  // 更新状态
  const updateStatus = (updates: Partial<DeviceStatus>) => {
    const newStatus = { ...status, ...updates };
    setStatus(newStatus);
    onStatusChange?.(deviceId, newStatus);
  };

  // 切换电源状态
  const togglePower = () => {
    updateStatus({ power: !status.power });
  };

  // 设置亮度
  const setBrightness = (value: number) => {
    updateStatus({ brightness: value });
  };

  // 设置温度
  const setTemperature = (value: number) => {
    updateStatus({ temperature: value });
  };

  return {
    status,
    updateStatus,
    togglePower,
    setBrightness,
    setTemperature,
  };
} 