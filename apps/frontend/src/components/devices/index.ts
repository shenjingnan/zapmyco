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

const moduleFiles = import.meta.glob('./*/spec.ts', { eager: true });

interface ModuleWithExports {
  [key: string]: unknown;
}

Object.values(moduleFiles).forEach((module) => {
  const typedModule = module as ModuleWithExports;

  for (const key in typedModule) {
    const value = typedModule[key];
    if (
      value &&
      typeof value === 'object' &&
      'component' in value &&
      'meta' in value &&
      value.meta &&
      typeof value.meta === 'object' &&
      'matcher' in value.meta
    ) {
      cardRegistry.register(value as CardComponent<unknown>);
      break;
    }
  }
});

import { defaultCardSpec } from './default-card/spec';

cardRegistry.register(defaultCardSpec as unknown as CardComponent<unknown>);

export { cardRegistry };
export * from './matching-system';
