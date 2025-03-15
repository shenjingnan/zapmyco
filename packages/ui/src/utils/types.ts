import { ReactNode } from 'react';

/**
 * 设备类型枚举
 */
export enum DeviceType {
  LIGHT = 'light',
  SWITCH = 'switch',
  THERMOSTAT = 'thermostat',
  CAMERA = 'camera',
  LOCK = 'lock',
  SENSOR = 'sensor',
  CUSTOM = 'custom',
}

/**
 * 设备状态接口
 */
export interface DeviceStatus {
  online: boolean;
  power?: boolean;
  brightness?: number;
  temperature?: number;
  humidity?: number;
  batteryLevel?: number;
  [key: string]: any;
}

/**
 * 设备基本信息接口
 */
export interface DeviceInfo {
  id: string;
  name: string;
  type: DeviceType | string;
  room?: string;
  icon?: string;
  status: DeviceStatus;
}

/**
 * 设备卡片属性接口
 */
export interface DeviceCardProps {
  device: DeviceInfo;
  onClick?: (device: DeviceInfo) => void;
  onToggle?: (device: DeviceInfo, value: boolean) => void;
  className?: string;
  children?: ReactNode;
}

/**
 * 设备控制属性接口
 */
export interface DeviceControlProps {
  device: DeviceInfo;
  onUpdate?: (device: DeviceInfo, updates: Partial<DeviceStatus>) => void;
  className?: string;
  children?: ReactNode;
} 