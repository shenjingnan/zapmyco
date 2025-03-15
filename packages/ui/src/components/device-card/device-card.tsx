import React from 'react';
import { Card } from '../card';
import { cn } from '../../utils/cn';
import { DeviceCardProps, DeviceType } from '../../utils/types';

/**
 * 设备卡片组件
 * 用于显示智能家居设备的基本信息和状态
 */
export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  onClick,
  onToggle,
  className,
  children,
}) => {
  const { id, name, type, status, icon } = device;
  const { online, power } = status;

  // 处理点击事件
  const handleClick = () => {
    onClick?.(device);
  };

  // 处理开关切换
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle?.(device, !power);
  };

  // 获取设备图标
  const getDeviceIcon = () => {
    // 这里可以根据设备类型返回不同的图标
    switch (type) {
      case DeviceType.LIGHT:
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        );
      case DeviceType.SWITCH:
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        );
      case DeviceType.THERMOSTAT:
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
            />
          </svg>
        );
      default:
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
            />
          </svg>
        );
    }
  };

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md',
        !online && 'opacity-60',
        className
      )}
      onClick={handleClick}
    >
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full',
                power
                  ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              )}
            >
              {icon || getDeviceIcon()}
            </div>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">{name}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {online ? '在线' : '离线'}
                {online && power !== undefined && ` · ${power ? '开启' : '关闭'}`}
              </p>
            </div>
          </div>
          {online && power !== undefined && (
            <button
              onClick={handleToggle}
              className={cn(
                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                power ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                  power ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          )}
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </Card>
  );
}; 