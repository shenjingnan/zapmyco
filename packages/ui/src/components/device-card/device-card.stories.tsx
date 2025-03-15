import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { DeviceCard } from './device-card';
import { DeviceType } from '../../utils/types';

const meta: Meta<typeof DeviceCard> = {
  title: 'Components/DeviceCard',
  component: DeviceCard,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof DeviceCard>;

// 灯光设备示例
export const Light: Story = {
  args: {
    device: {
      id: 'light-1',
      name: '客厅灯',
      type: DeviceType.LIGHT,
      room: '客厅',
      status: {
        online: true,
        power: true,
        brightness: 80,
      },
    },
    onClick: (device) => console.log('点击设备:', device),
    onToggle: (device, value) => console.log(`切换设备 ${device.name} 状态为: ${value}`),
  },
};

// 开关设备示例
export const Switch: Story = {
  args: {
    device: {
      id: 'switch-1',
      name: '卧室开关',
      type: DeviceType.SWITCH,
      room: '卧室',
      status: {
        online: true,
        power: false,
      },
    },
    onClick: (device) => console.log('点击设备:', device),
    onToggle: (device, value) => console.log(`切换设备 ${device.name} 状态为: ${value}`),
  },
};

// 恒温器设备示例
export const Thermostat: Story = {
  args: {
    device: {
      id: 'thermostat-1',
      name: '客厅恒温器',
      type: DeviceType.THERMOSTAT,
      room: '客厅',
      status: {
        online: true,
        power: true,
        temperature: 24,
        humidity: 45,
      },
    },
    onClick: (device) => console.log('点击设备:', device),
    onToggle: (device, value) => console.log(`切换设备 ${device.name} 状态为: ${value}`),
  },
  render: (args) => (
    <DeviceCard {...args}>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-blue-50 p-2 text-center dark:bg-blue-900">
          <div className="text-xs text-gray-500 dark:text-gray-400">温度</div>
          <div className="text-lg font-medium text-blue-600 dark:text-blue-300">
            {args.device.status.temperature}°C
          </div>
        </div>
        <div className="rounded-md bg-blue-50 p-2 text-center dark:bg-blue-900">
          <div className="text-xs text-gray-500 dark:text-gray-400">湿度</div>
          <div className="text-lg font-medium text-blue-600 dark:text-blue-300">
            {args.device.status.humidity}%
          </div>
        </div>
      </div>
    </DeviceCard>
  ),
};

// 离线设备示例
export const Offline: Story = {
  args: {
    device: {
      id: 'camera-1',
      name: '门口摄像头',
      type: DeviceType.CAMERA,
      room: '门厅',
      status: {
        online: false,
        power: false,
      },
    },
    onClick: (device) => console.log('点击设备:', device),
    onToggle: (device, value) => console.log(`切换设备 ${device.name} 状态为: ${value}`),
  },
}; 