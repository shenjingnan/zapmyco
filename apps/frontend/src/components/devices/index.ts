export { default as TempHumiditySensor } from './TempHumiditySensor';
export { default as DebugCard } from './DebugCard';
export { default as OneSwitchCard } from './OneSwitchCard';
export { default as OccupancySensorCard } from './OccupancySensorCard';
export * from './light-card';
export { default as ThermostatCard } from './ThermostatCard';
export { default as EnergyCard } from './EnergyCard';
export { default as SecurityCard } from './SecurityCard';
export { default as AirPurifierCard } from './AirPurifierCard';
export { default as HumidifierCard } from './HumidifierCard';
export { default as CurtainCard } from './CurtainCard';
export { default as SmartPlugCard } from './SmartPlugCard';
export { default as RefrigeratorCard } from './RefrigeratorCard';
export { default as WashingMachineCard } from './WashingMachineCard';
export { default as OvenCard } from './OvenCard';
export { default as SceneCard } from './SceneCard';
export { default as AutomationCard } from './AutomationCard';
export { default as WeatherCard } from './WeatherCard';
export { default as HealthCard } from './HealthCard';
export { default as DefaultCard } from './DefaultCard';

import { cardRegistry } from './card-registry';
import { definition as lightCardDefinition } from './light-card';

cardRegistry.register(lightCardDefinition);

export { cardRegistry };
