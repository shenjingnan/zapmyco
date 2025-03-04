export * from './temp-humidity-sensor-card';
export * from './light-card';
export * from './occupancy-sensor-card';
export * from './one-switch-card';
export * from './thermostat-card';
export * from './energy-card';
export * from './air-purifier-card';
export * from './humidifier-card';
export * from './curtain-card';
export * from './smart-plug-card';
export * from './refrigerator-card';
export * from './washing-machine-card';
export * from './oven-card';
export * from './scene-card';
export * from './automation-card/AutomationCard';
export * from './weather-card';
export * from './health-card';
export * from './default-card';
export * from './security-card';
import { cardRegistry } from './card-registry';
import { CardComponent } from './types';

// 使用动态导入自动发现所有卡片
const moduleFiles = import.meta.glob('./*/spec.ts', { eager: true });

// 自动注册所有找到的卡片
Object.values(moduleFiles).forEach((module: any) => {
  // 遍历模块中的所有导出
  for (const key in module) {
    const value = module[key];
    // 检查是否是CardComponent类型对象
    if (
      value &&
      typeof value === 'object' &&
      'component' in value &&
      'meta' in value &&
      value.meta &&
      typeof value.meta === 'object' &&
      'matcher' in value.meta
    ) {
      cardRegistry.register(value as CardComponent<any>);
      break; // 假设每个模块只有一个卡片规格
    }
  }
});

// 确保默认卡片最后注册
import { defaultCardSpec } from './default-card/spec';
cardRegistry.register(defaultCardSpec);

export { cardRegistry };
export * from './matching-system';
